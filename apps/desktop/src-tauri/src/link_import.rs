//! Link requests own only temporary files. A completed result remains a curation draft.
use crate::{
    curation::{self, CurationDraft, CurationStore},
    db::{self, Store},
    models::Photo,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex, MutexGuard},
};
use tauri::{ipc::Channel, Manager};
#[path = "link_import_download.rs"]
mod download;
#[path = "link_import_input.rs"]
mod input;
#[path = "link_import_source.rs"]
mod source;
#[path = "link_import_webview.rs"]
mod webview;

#[derive(Default)]
struct Progress {
    cancelled: bool,
    handed_off: bool,
}
pub(super) struct Session {
    id: String,
    root: PathBuf,
    directory: PathBuf,
    label: String,
    progress: Mutex<Progress>,
}
impl Session {
    fn check(&self) -> Result<(), String> {
        self.active().map(|_| ())
    }
    fn active(&self) -> Result<MutexGuard<'_, Progress>, String> {
        let progress = self.progress.lock().map_err(|e| e.to_string())?;
        if progress.cancelled {
            return Err("链接导入已取消。".into());
        }
        Ok(progress)
    }
    fn remove_staging(&self) -> Result<(), String> {
        match fs::remove_dir_all(&self.directory) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("清理链接暂存失败：{error}")),
        }
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        if self
            .progress
            .get_mut()
            .is_ok_and(|progress| !progress.handed_off)
        {
            let _ = self.remove_staging();
        }
    }
}

/// None is a cancellation tombstone: cancellation may arrive before the prepare IPC.
#[derive(Default)]
pub struct LinkImportStore(Mutex<HashMap<String, Option<Arc<Session>>>>);
impl LinkImportStore {
    fn begin(&self, root: PathBuf, request: &str) -> Result<Arc<Session>, String> {
        uuid::Uuid::parse_str(request).map_err(|_| "链接请求标识无效")?;
        let mut entries = self.0.lock().map_err(|e| e.to_string())?;
        if entries.contains_key(request) {
            return Err("链接请求已取消或已经使用，请重新开始。".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let directory = root.join("staging").join(&id);
        fs::create_dir_all(&directory).map_err(|e| format!("无法创建链接暂存：{e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(error) = fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)) {
                let _ = fs::remove_dir_all(&directory);
                return Err(format!("无法设置链接暂存权限：{error}"));
            }
        }
        let session = Arc::new(Session {
            label: format!("link-import-{id}"),
            id,
            root,
            directory,
            progress: Mutex::new(Progress::default()),
        });
        for folder in ["originals", "thumbnails"] {
            fs::create_dir(session.directory.join(folder))
                .map_err(|e| format!("无法创建链接候选目录：{e}"))?;
        }
        entries.insert(request.into(), Some(session.clone()));
        Ok(session)
    }
    fn cancel(&self, request: &str) -> Result<Option<String>, String> {
        uuid::Uuid::parse_str(request).map_err(|_| "链接请求标识无效")?;
        let mut entries = self.0.lock().map_err(|e| e.to_string())?;
        let Some(Some(session)) = entries.get(request) else {
            entries.insert(request.into(), None);
            return Ok(None);
        };
        let mut progress = session.progress.lock().map_err(|e| e.to_string())?;
        progress.cancelled = true;
        if progress.handed_off {
            // Curation owns the files now and may already be committing them.
            return Ok(Some(session.id.clone()));
        }
        session.remove_staging()?;
        Ok(None)
    }
    #[cfg(test)]
    pub(crate) fn cancel_all(&self) -> Result<(), String> {
        for session in self.0.lock().map_err(|e| e.to_string())?.values().flatten() {
            let mut progress = session.progress.lock().map_err(|e| e.to_string())?;
            progress.cancelled = true;
            if !progress.handed_off {
                session.remove_staging()?;
            }
        }
        Ok(())
    }
    fn finish_preparation(
        &self,
        request: &str,
        session: &Session,
        result: Result<CurationDraft, String>,
    ) -> Result<CurationDraft, String> {
        let Err(message) = result else {
            return result;
        };
        let cleanup = session
            .progress
            .lock()
            .map_err(|e| e.to_string())
            .and_then(|_progress| session.remove_staging());
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(request.into(), None);
        match cleanup {
            Ok(()) => Err(message),
            Err(cleanup) => Err(format!("{message}；{cleanup}")),
        }
    }
}
impl Drop for LinkImportStore {
    fn drop(&mut self) {
        if let Ok(entries) = self.0.get_mut() {
            for session in entries.values().flatten() {
                if let Ok(mut progress) = session.progress.lock() {
                    progress.cancelled = true;
                    if !progress.handed_off {
                        let _ = session.remove_staging();
                    }
                }
            }
        }
    }
}

#[derive(Serialize)]
pub struct LinkImportProgress {
    total: usize,
    photo: Option<Photo>,
}

fn check_library(conn: &rusqlite::Connection, session: &Session) -> Result<(), String> {
    if db::library_root(conn)? != session.root {
        return Err("图库已切换，本次链接候选已取消。".into());
    }
    Ok(())
}

fn finish_candidates(
    store: &Store,
    drafts: &CurationStore,
    session: &Session,
    photos: Vec<Photo>,
    library: &str,
    group_id: Option<&str>,
) -> Result<CurationDraft, String> {
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    check_library(&conn, session)?;
    session.check()?;
    let prepared =
        curation::prepare_link_import_draft(&conn, &session.id, library, group_id, photos)?;
    let mut progress = session.active()?;
    let draft = prepared.register(drafts)?;
    progress.handed_off = true;
    Ok(draft)
}

fn send_progress(
    store: &Store,
    session: &Session,
    progress: &Channel<LinkImportProgress>,
    total: usize,
    photo: Option<Photo>,
) -> Result<(), String> {
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    check_library(&conn, session)?;
    let _active = session.active()?;
    progress
        .send(LinkImportProgress { total, photo })
        .map_err(|e| format!("无法传递链接导入进度：{e}"))
}

#[tauri::command]
pub async fn prepare_link_import(
    app: tauri::AppHandle,
    input: String,
    library: String,
    group_id: Option<String>,
    request_id: String,
    progress: Channel<LinkImportProgress>,
) -> Result<CurationDraft, String> {
    // Validate cheap input and category before creating files or visiting a website.
    input::input_url(&input)?;
    crate::models::library(&library)?;
    let session = {
        let store = app.state::<Store>();
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        app.state::<LinkImportStore>()
            .begin(db::library_root(&conn)?, &request_id)?
    };
    let result = async {
        let target = input::resolve(&input).await?;
        session.check()?;
        let canonical = target.canonical.clone();
        let platform = target.platform;
        let images = webview::extract(&app, target, &session).await?;
        let mut download = download::Download::new(images, platform)?;
        let total = download.count();
        send_progress(&app.state::<Store>(), &session, &progress, total, None)?;
        let mut photos = Vec::with_capacity(total);
        while let Some(bytes) = download.next(&session).await? {
            let index = photos.len();
            let handle = app.clone();
            let worker_session = session.clone();
            let progress = progress.clone();
            let library = library.clone();
            let source = canonical.clone();
            let photo = tauri::async_runtime::spawn_blocking(move || {
                let photo =
                    source::prepare_photo(&worker_session, bytes, index, &library, &source)?;
                send_progress(
                    &handle.state::<Store>(),
                    &worker_session,
                    &progress,
                    total,
                    Some(photo.clone()),
                )?;
                Ok::<_, String>(photo)
            })
            .await
            .map_err(|_| "准备链接图片任务失败")??;
            photos.push(photo);
        }
        let handle = app.clone();
        let worker_session = session.clone();
        tauri::async_runtime::spawn_blocking(move || {
            finish_candidates(
                &handle.state::<Store>(),
                &handle.state::<CurationStore>(),
                &worker_session,
                photos,
                &library,
                group_id.as_deref(),
            )
        })
        .await
        .map_err(|_| "准备链接候选任务失败".to_string())?
    }
    .await;
    app.state::<LinkImportStore>()
        .finish_preparation(&request_id, &session, result)
}

#[tauri::command]
pub async fn cancel_link_import(app: tauri::AppHandle, request_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let draft = app.state::<LinkImportStore>().cancel(&request_id)?;
        if let Some(id) = draft {
            curation::cancel(&app.state::<Store>(), &app.state::<CurationStore>(), &id)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
#[path = "link_import_tests.rs"]
mod tests;
