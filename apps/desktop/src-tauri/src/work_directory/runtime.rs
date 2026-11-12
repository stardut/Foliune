use super::{
    active, bind, choose_path, observe_path,
    queue::{self, JobState, Queue},
    relink,
    source::{RootDirectory, RootStamp},
    sync::{self, Candidate, Decision, SyncDelta},
    unbind, verification, Original, Root, Scan,
};
use crate::{
    db::{self, Store},
    groups, local_photo,
    models::Snapshot,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashSet, VecDeque},
    path::{Path, PathBuf},
    sync::{
        mpsc::{self, SyncSender},
        Mutex,
    },
};
use tauri::{http, AppHandle, Emitter, Manager, UriSchemeContext, UriSchemeResponder};

const CHANGE_EVENT: &str = "work-directory-changed";
const RECENT_BATCHES: usize = 8;
#[path = "monitor.rs"]
mod monitor;
#[path = "worker.rs"]
mod worker;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkDirectoryState {
    library_id: String,
    path: Option<String>,
    status: Status,
    candidates: Vec<Candidate>,
    jobs: Vec<JobState>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Status {
    #[default]
    Unbound,
    Connected,
    Unavailable,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Change {
    library_id: String,
    refresh_snapshot: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    synced: Option<SyncDelta>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ResolveInput {
    candidate_ids: Vec<String>,
    decision: Decision,
}

#[derive(Default)]
struct Cache {
    context_id: uuid::Uuid,
    library: PathBuf,
    root: Option<Root>,
    stamp: Option<RootStamp>,
    offline_epoch: u64,
    scan: Scan,
    state: WorkDirectoryState,
    recent: VecDeque<Vec<Candidate>>,
    queue: Queue,
}

impl Cache {
    fn ensure_context(&mut self, store: &Store, conn: &Connection) -> Result<(), String> {
        let library = db::library_root(conn)?;
        let root = active(conn)?;
        if self.library != library || self.root != root {
            self.update(store, conn, library, root, None)?;
        }
        Ok(())
    }

    fn view(&self) -> WorkDirectoryState {
        WorkDirectoryState {
            jobs: self.queue.states(),
            ..self.state.clone()
        }
    }

    fn update(
        &mut self,
        store: &Store,
        conn: &Connection,
        library: PathBuf,
        root: Option<Root>,
        observed: Option<(Scan, Option<RootStamp>)>,
    ) -> Result<(), String> {
        if self.library != library || self.root != root {
            let queue = root
                .as_ref()
                .filter(|root| root.authorized)
                .map(|root| Queue::load(conn, root))
                .transpose()?
                .unwrap_or_default();
            self.state.library_id = library_id(&store.root, &library)
                .ok_or("图库路径无效")?
                .into();
            self.context_id = uuid::Uuid::new_v4();
            self.queue = queue;
            self.library = library;
            self.root = root;
            self.recent.clear();
            self.scan = Scan::default();
            self.stamp = None;
        }
        if let Some((scan, stamp)) = observed {
            if stamp != self.stamp {
                self.recent.clear();
            }
            if self.scan.connected && !scan.connected {
                self.offline_epoch += 1;
                self.queue.clear_live_stamps();
            }
            self.scan = scan;
            self.stamp = stamp;
        }
        let Some(root) = &self.root else {
            self.state.path = None;
            self.state.status = Status::Unbound;
            self.state.candidates.clear();
            return Ok(());
        };
        let (status, mut candidates) = if self.scan.connected {
            (Status::Connected, sync::candidates(conn, root, &self.scan)?)
        } else {
            (Status::Unavailable, Vec::new())
        };
        candidates.retain(|candidate| !self.queue.reserves_folder(&candidate.folder_name));
        if candidates != self.state.candidates || (self.recent.is_empty() && !candidates.is_empty())
        {
            self.recent.push_front(candidates.clone());
            self.recent.truncate(RECENT_BATCHES);
        }
        self.state.path = Some(root.path.to_string_lossy().into_owned());
        self.state.status = status;
        self.state.candidates = candidates;
        Ok(())
    }

    fn selected(&self, input: &ResolveInput) -> Result<Vec<Candidate>, String> {
        if input.candidate_ids.is_empty() {
            return Err("请选择待同步内容".into());
        }
        let mut seen = HashSet::new();
        input
            .candidate_ids
            .iter()
            .map(|id| {
                let candidate = self
                    .recent
                    .iter()
                    .flatten()
                    .find(|candidate| {
                        &candidate.id == id && !self.queue.reserves_folder(&candidate.folder_name)
                    })
                    .ok_or("待同步内容已变化，请重新查看后确认")?;
                if !seen.insert(&candidate.folder_name) {
                    return Err("待同步内容重复".into());
                }
                Ok(candidate.clone())
            })
            .collect()
    }

    fn enqueue(&mut self, conn: &mut Connection, selected: Vec<Candidate>) -> Result<(), String> {
        let root = self.root.as_ref().ok_or("当前图库未绑定作品目录")?;
        self.queue.enqueue(conn, root, selected, self.stamp)?;
        let visible = |candidate: &Candidate| !self.queue.reserves_folder(&candidate.folder_name);
        self.state.candidates.retain(visible);
        for batch in &mut self.recent {
            batch.retain(visible);
        }
        Ok(())
    }

    fn source_locked(&self) -> bool {
        self.queue.has_running() || (self.scan.connected && self.queue.has_waiting())
    }
}

pub(crate) struct WorkDirectoryMonitor {
    cache: Mutex<Cache>,
    signal: SyncSender<()>,
    work: SyncSender<()>,
    verify: SyncSender<()>,
}

pub(crate) fn start_monitor(app: &AppHandle) -> Result<(), String> {
    let library = {
        let store = app.state::<Store>();
        let conn = store.connection.lock().map_err(|error| error.to_string())?;
        db::library_root(&conn)?
    };
    if let Err(error) = super::staging::clean_abandoned_staging(&library) {
        eprintln!("{error}");
    }
    let (signal, receiver) = mpsc::sync_channel(1);
    let (work, pending) = mpsc::sync_channel(1);
    let (verify, checks) = mpsc::sync_channel(1);
    let _ = verify.try_send(());
    app.manage(WorkDirectoryMonitor {
        cache: Mutex::new(Cache::default()),
        signal: signal.clone(),
        work,
        verify,
    });
    let worker_app = app.clone();
    // A single sync worker serializes preparation of confirmed albums.
    std::thread::Builder::new()
        .name("work-directory-sync".into())
        .spawn(move || worker::run_jobs(worker_app, pending))
        .map_err(|e| format!("无法启动作品目录同步：{e}"))?;
    let verify_app = app.clone();
    std::thread::Builder::new()
        .name("work-directory-verify".into())
        .spawn(move || {
            let store = verify_app.state::<Store>();
            verification::run(&store, checks, |library| {
                if let Some(library_id) = library_id(&store.root, library) {
                    emit(&verify_app, library_id, true, None);
                }
            });
        })
        .map_err(|e| format!("无法启动作品目录原件校验：{e}"))?;
    let app = app.clone();
    std::thread::Builder::new()
        .name("work-directory-monitor".into())
        .spawn(move || monitor::run(app, receiver, signal))
        .map_err(|e| format!("无法启动作品目录监听：{e}"))?;
    Ok(())
}

fn library_id<'a>(base: &Path, library: &'a Path) -> Option<&'a str> {
    if library == base {
        Some("default")
    } else {
        library.file_name().and_then(|id| id.to_str())
    }
}

pub(crate) fn wake_monitor(app: &AppHandle) {
    let _ = app.state::<WorkDirectoryMonitor>().signal.try_send(());
}

fn emit(app: &AppHandle, library_id: &str, refresh_snapshot: bool, synced: Option<SyncDelta>) {
    let _ = app.emit_to(
        "main",
        CHANGE_EVENT,
        Change {
            library_id: library_id.into(),
            refresh_snapshot,
            synced,
        },
    );
}

fn path_stamp(path: &Path) -> Option<RootStamp> {
    RootDirectory::open(path).ok()?.identity()
}

async fn inspect_path(app: AppHandle, path: String) -> Result<LocatedPath, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let manager = app.state::<WorkDirectoryMonitor>();
        let context_id = {
            let conn = store.connection.lock().map_err(|e| e.to_string())?;
            let mut cache = manager.cache.lock().map_err(|e| e.to_string())?;
            cache.ensure_context(&store, &conn)?;
            cache.context_id
        };
        let path = choose_path(&store.root, &path)?;
        let observed = observe_path(&path);
        Ok(LocatedPath {
            context_id,
            path,
            observed,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

struct LocatedPath {
    context_id: uuid::Uuid,
    path: PathBuf,
    observed: (Scan, Option<RootStamp>),
}

impl LocatedPath {
    fn apply(
        self,
        store: &Store,
        conn: &Connection,
        cache: &mut Cache,
        update: fn(&Connection, &Path) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.context_id != cache.context_id {
            return Err("图库或作品目录已切换".into());
        }
        update(conn, &self.path)?;
        // A relink can clear jobs even when the chosen path has not changed.
        *cache = Cache::default();
        cache.update(
            store,
            conn,
            db::library_root(conn)?,
            active(conn)?,
            Some(self.observed),
        )
    }
}

type Operation = Box<dyn FnOnce(&Store, &mut Connection, &mut Cache) -> Result<(), String> + Send>;

async fn operate(
    app: AppHandle,
    refresh_snapshot: bool,
    operation: Operation,
) -> Result<WorkDirectoryState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let manager = app.state::<WorkDirectoryMonitor>();
        let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
        let mut cache = manager.cache.lock().map_err(|e| e.to_string())?;
        cache.ensure_context(&store, &conn)?;
        operation(&store, &mut conn, &mut cache)?;
        emit(&app, &cache.state.library_id, refresh_snapshot, None);
        wake_monitor(&app);
        let _ = manager.work.try_send(());
        Ok(cache.view())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn get_work_directory(app: AppHandle) -> Result<WorkDirectoryState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<WorkDirectoryMonitor>();
        {
            let cache = manager.cache.lock().map_err(|e| e.to_string())?;
            if !cache.state.library_id.is_empty() {
                return Ok(cache.view());
            }
        }
        // First read after launch or a library switch initializes the cache.
        let store = app.state::<Store>();
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        let mut cache = manager.cache.lock().map_err(|e| e.to_string())?;
        cache.ensure_context(&store, &conn)?;
        Ok(cache.view())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub(crate) async fn bind_work_directory(
    app: AppHandle,
    path: String,
) -> Result<WorkDirectoryState, String> {
    let selected = inspect_path(app.clone(), path).await?;
    operate(
        app,
        true,
        Box::new(move |store, conn, cache| selected.apply(store, conn, cache, bind)),
    )
    .await
}

#[tauri::command]
pub(crate) async fn relink_work_directory(
    app: AppHandle,
    path: String,
) -> Result<WorkDirectoryState, String> {
    let selected = inspect_path(app.clone(), path).await?;
    operate(
        app,
        true,
        Box::new(move |store, conn, cache| {
            if cache.source_locked() {
                return Err("请等待作品目录同步完成后再重新定位".into());
            }
            selected.apply(store, conn, cache, relink)
        }),
    )
    .await
}

#[tauri::command]
pub(crate) async fn unbind_work_directory(app: AppHandle) -> Result<WorkDirectoryState, String> {
    operate(
        app,
        true,
        Box::new(|store, conn, cache| {
            if cache.source_locked() {
                return Err("请等待作品目录同步完成后再解绑".into());
            }
            unbind(conn)?;
            cache.ensure_context(store, conn)
        }),
    )
    .await
}

#[tauri::command]
pub(crate) async fn resolve_work_directory(
    app: AppHandle,
    input: ResolveInput,
) -> Result<WorkDirectoryState, String> {
    operate(
        app,
        false,
        Box::new(move |store, conn, cache| {
            let root = cache.root.as_ref().ok_or("当前图库未绑定作品目录")?;
            let selected = cache.selected(&input)?;
            match input.decision {
                Decision::Sync => {
                    if !root.authorized || cache.state.status != Status::Connected {
                        return Err("作品目录当前不可用".into());
                    }
                    cache.enqueue(conn, selected)
                }
                Decision::Ignore => {
                    sync::ignore(conn, root, &selected)?;
                    cache.update(store, conn, cache.library.clone(), cache.root.clone(), None)
                }
            }
        }),
    )
    .await
}

#[tauri::command]
pub(crate) async fn retry_work_directory_job(
    app: AppHandle,
    job_id: String,
) -> Result<WorkDirectoryState, String> {
    operate(
        app,
        false,
        Box::new(move |_, conn, cache| cache.queue.retry(conn, &job_id, cache.stamp)),
    )
    .await
}

pub(crate) async fn delete_group(app: AppHandle, id: String) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let manager = app.state::<WorkDirectoryMonitor>();
        let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
        let mut cache = manager.cache.lock().map_err(|e| e.to_string())?;
        cache.ensure_context(&store, &conn)?;
        if cache.queue.has_active(Some(&id)) {
            return Err("请等待该相簿同步完成后再删除".into());
        }
        drop(cache);
        let snapshot = delete_album(&mut conn, &id)?;
        let mut cache = manager.cache.lock().map_err(|e| e.to_string())?;
        cache.queue.remove_album(&id);
        emit(&app, &cache.state.library_id, false, None);
        wake_monitor(&app);
        Ok(snapshot)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn delete_album(conn: &mut Connection, id: &str) -> Result<Snapshot, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    queue::remove_album(&tx, id)?;
    let snapshot = groups::delete(&tx, id)?;
    tx.commit().map_err(|e| e.to_string())?;
    crate::album_cover::remove_cached(conn, id);
    Ok(snapshot)
}

fn protocol_source(conn: &Connection, id: &str) -> Result<Original, String> {
    let locator: String = conn
        .query_row(
            "SELECT original_path FROM photos WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("照片原件不存在")?;
    if !super::is_locator(&locator) && !local_photo::is_locator(&locator) {
        return Err("外部原件引用无效".into());
    }
    super::original(conn, id, &locator)
}

pub(crate) fn serve(
    context: UriSchemeContext<'_, tauri::Wry>,
    request: http::Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = context.app_handle().clone();
    let id = request
        .uri()
        .path()
        .strip_prefix('/')
        .and_then(|id| uuid::Uuid::parse_str(id).ok())
        .map(|id| id.to_string());
    let origin = request.headers().get(http::header::ORIGIN).cloned();
    let origin_allowed = origin.as_ref().is_none_or(|origin| {
        [
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ]
        .iter()
        .any(|allowed| origin == *allowed)
            || (cfg!(debug_assertions)
                && app
                    .config()
                    .build
                    .dev_url
                    .as_ref()
                    .is_some_and(|url| origin == url.origin().ascii_serialization().as_str()))
    });
    let method_allowed = request.method() == http::Method::GET;
    let host_allowed = matches!(
        request.uri().host(),
        Some("localhost" | "work-photo.localhost")
    );
    if context.webview_label() != "main"
        || !origin_allowed
        || !method_allowed
        || !host_allowed
        || id.is_none()
    {
        responder.respond(
            http::Response::builder()
                .status(403)
                .body(Vec::<u8>::new())
                .unwrap(),
        );
        return;
    }
    let id = id.unwrap();
    tauri::async_runtime::spawn_blocking(move || {
        let loaded = (|| -> Result<_, String> {
            let store = app.state::<Store>();
            let (library, source) = {
                let conn = store.connection.lock().map_err(|e| e.to_string())?;
                (db::library_root(&conn)?, protocol_source(&conn, &id)?)
            };
            let bytes = source.read()?;
            let mime = local_photo::image_content_type(&bytes).ok_or("不支持的照片原件格式")?;
            // A switch or relink during a read must not serve pixels from the previous library.
            let conn = store.connection.lock().map_err(|e| e.to_string())?;
            if db::library_root(&conn)? != library || protocol_source(&conn, &id)? != source {
                return Err("图库或照片原件已变化".into());
            }
            Ok((mime, bytes))
        })();
        let mut response = http::Response::builder()
            .header(http::header::CACHE_CONTROL, "no-store")
            .header(http::header::X_CONTENT_TYPE_OPTIONS, "nosniff");
        if let Some(origin) = origin {
            response = response.header(http::header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        }
        responder.respond(
            match loaded {
                Ok((mime, bytes)) => response
                    .header(http::header::CONTENT_TYPE, mime)
                    .body(bytes),
                Err(_) => response.status(404).body(Vec::new()),
            }
            .unwrap(),
        );
    });
}
