//! Link requests own only temporary files. A completed result remains a curation draft.
use crate::{
    curation::{self, CurationDraft, CurationStore},
    db::{self, Store},
};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Manager;
#[path = "link_import_download.rs"]
mod download;
#[path = "link_import_input.rs"]
mod input;
#[path = "link_import_webview.rs"]
mod webview;

#[derive(Default)]
struct Progress {
    cancelled: bool,
    draft: Option<String>,
}
pub(super) struct Session {
    root: PathBuf,
    directory: PathBuf,
    label: String,
    progress: Mutex<Progress>,
}
impl Session {
    fn check(&self) -> Result<(), String> {
        if self.progress.lock().map_err(|e| e.to_string())?.cancelled {
            Err("链接导入已取消。".into())
        } else {
            Ok(())
        }
    }
    fn remove_downloads(&self) -> Result<(), String> {
        match fs::remove_dir_all(&self.directory) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("清理链接暂存失败：{error}")),
        }
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.remove_downloads();
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
        let id = uuid::Uuid::new_v4();
        let directory = root.join("staging").join(format!("link-{id}"));
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
            root,
            directory,
            label: format!("link-import-{id}"),
            progress: Mutex::new(Progress::default()),
        });
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
        session.remove_downloads()?;
        Ok(progress.draft.take())
    }
    #[cfg(test)]
    pub(crate) fn cancel_all(&self) -> Result<(), String> {
        for session in self.0.lock().map_err(|e| e.to_string())?.values().flatten() {
            let mut progress = session.progress.lock().map_err(|e| e.to_string())?;
            progress.cancelled = true;
            session.remove_downloads()?;
        }
        Ok(())
    }
    fn release(&self, request: &str, retain: bool) -> Result<(), String> {
        if !retain {
            self.0
                .lock()
                .map_err(|e| e.to_string())?
                .insert(request.into(), None);
        }
        Ok(())
    }
}
impl Drop for LinkImportStore {
    fn drop(&mut self) {
        if let Ok(entries) = self.0.get_mut() {
            for session in entries.values().flatten() {
                if let Ok(mut progress) = session.progress.lock() {
                    progress.cancelled = true;
                    let _ = session.remove_downloads();
                }
            }
        }
    }
}

fn finish_candidates(
    store: &Store,
    drafts: &CurationStore,
    session: &Session,
    paths: Vec<String>,
    library: &str,
    group_id: Option<&str>,
    source: &str,
) -> Result<CurationDraft, String> {
    session.check()?;
    let draft = curation::prepare_link_import_files(
        store,
        drafts,
        paths,
        library,
        group_id,
        &session.root,
    )?;
    let result = (|| {
        // Same lock order as library switching: connection -> request -> curation.
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        let mut progress = session.progress.lock().map_err(|e| e.to_string())?;
        if progress.cancelled || db::library_root(&conn)? != session.root {
            return Err("链接导入已取消或图库已切换。".into());
        }
        if !draft.failures.is_empty() || draft.pending_ids.is_empty() {
            return Err("部分帖子图片无法准备，已取消整篇导入。".into());
        }
        let view = curation::set_pending_source(drafts, &draft.id, &session.root, source)?;
        // Remove downloads before handing off. Curation now owns its own managed copies.
        session.remove_downloads()?;
        progress.draft = Some(draft.id.clone());
        Ok(view)
    })();
    if result.is_err() {
        curation::cancel(store, drafts, &draft.id)?;
    }
    result
}

#[tauri::command]
pub async fn prepare_link_import(
    app: tauri::AppHandle,
    input: String,
    library: String,
    group_id: Option<String>,
    request_id: String,
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
        let paths = download::download(images, platform, &session).await?;
        let handle = app.clone();
        let worker_session = session.clone();
        tauri::async_runtime::spawn_blocking(move || {
            finish_candidates(
                &handle.state::<Store>(),
                &handle.state::<CurationStore>(),
                &worker_session,
                paths,
                &library,
                group_id.as_deref(),
                &canonical,
            )
        })
        .await
        .map_err(|_| "准备链接候选任务失败".to_string())?
    }
    .await;
    if result.is_err() {
        session.remove_downloads()?;
    }
    app.state::<LinkImportStore>()
        .release(&request_id, result.is_ok())?;
    result
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
