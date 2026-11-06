use super::{emit, path_stamp, RootStamp, WorkDirectoryMonitor};
use crate::{
    db::{self, Store},
    work_directory::{active, observe_path, valid_component, Root, Scan},
};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::Connection;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};

const HEALTH_INTERVAL: Duration = Duration::from_secs(2);
const EVENT_SETTLE: Duration = Duration::from_millis(200);

pub(super) fn run(app: AppHandle, receiver: Receiver<()>, signal: SyncSender<()>) {
    let file_change = Arc::new(AtomicBool::new(false));
    let notify_change = file_change.clone();
    let notify_signal = signal.clone();
    let mut watcher = RecommendedWatcher::new(
        move |event: notify::Result<notify::Event>| {
            if event.is_ok_and(|event| matches!(event.kind, notify::EventKind::Access(_))) {
                return;
            }
            notify_change.store(true, Ordering::Release);
            let _ = notify_signal.try_send(());
        },
        notify::Config::default(),
    )
    .ok();
    let mut watched: BTreeMap<PathBuf, RootStamp> = BTreeMap::new();
    let mut detached_folders = BTreeMap::new();
    let mut detached_stamps = BTreeMap::new();
    let mut incomplete_watcher = watcher.is_none();
    let mut catch_up = false;
    let mut initial = true;
    loop {
        let from_signal = if initial {
            initial = false;
            true
        } else {
            match receiver.recv_timeout(HEALTH_INTERVAL) {
                Ok(()) => true,
                Err(mpsc::RecvTimeoutError::Timeout) => false,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        };
        if from_signal && file_change.load(Ordering::Acquire) {
            // File copies produce bursts; batch them without delaying indefinitely.
            std::thread::sleep(EVENT_SETTLE);
            while receiver.try_recv().is_ok() {}
        }
        let from_files = file_change.swap(false, Ordering::AcqRel);
        let refresh = (|| -> Result<_, String> {
            let store = app.state::<Store>();
            let manager = app.state::<WorkDirectoryMonitor>();
            let (library, root, context_id) = {
                let conn = store.connection.lock().map_err(|e| e.to_string())?;
                let library = db::library_root(&conn)?;
                let root = active(&conn)?;
                let cache = manager.cache.lock().map_err(|e| e.to_string())?;
                if from_signal || cache.library != library || cache.root != root {
                    detached_folders = inactive_folders(&conn)?;
                }
                (library, root, cache.context_id)
            };
            // Enumerate external storage without holding the SQLite connection lock.
            let stamp = root_stamp(root.as_ref());
            let (switched, identity_changed, reconnecting) = {
                let cache = manager.cache.lock().map_err(|e| e.to_string())?;
                let switched = cache.library != library || cache.root != root;
                let identity_changed = cache.stamp != stamp;
                let reconnecting = root.as_ref().is_some_and(|root| root.authorized)
                    && (stamp.is_some() != cache.scan.connected
                        || identity_changed
                        || (from_signal && !cache.scan.connected));
                (switched, identity_changed, reconnecting)
            };
            let observed =
                (switched || from_files || reconnecting || incomplete_watcher || catch_up).then(
                    || {
                        root.as_ref()
                            .filter(|root| root.authorized)
                            .map_or_else(Default::default, |root| observe_path(&root.path))
                    },
                );
            let detached_now = detached_folders
                .keys()
                .map(|path| (path.clone(), path_stamp(path)))
                .collect();
            let detached_changed = detached_stamps != detached_now;
            detached_stamps = detached_now;
            let (mut targets, changed, refresh_snapshot, library_id) = {
                let conn = store.connection.lock().map_err(|e| e.to_string())?;
                if db::library_root(&conn)? != library || active(&conn)? != root {
                    return Err("图库或作品目录已切换".into());
                }
                let mut cache = manager.cache.lock().map_err(|e| e.to_string())?;
                if cache.context_id != context_id {
                    return Err("图库或作品目录已切换".into());
                }
                let old = cache.state.clone();
                let old_scan = cache.scan.clone();
                if from_signal || observed.is_some() {
                    cache.update(&store, &conn, library, root, observed)?;
                }
                let source_changed = old_scan != cache.scan
                    || old.path != cache.state.path
                    || identity_changed
                    || detached_changed;
                let observed_change =
                    from_files && (cache.scan.connected || !detached_folders.is_empty());
                let changed = old != cache.state || source_changed || observed_change;
                if cache.scan.connected && cache.queue.has_waiting() {
                    let _ = manager.work.try_send(());
                }
                (
                    watch_targets(cache.root.as_ref(), &cache.scan),
                    changed,
                    source_changed || observed_change,
                    cache.state.library_id.clone(),
                )
            };
            for (path, folders) in &detached_folders {
                if detached_stamps.get(path).is_some_and(Option::is_some) {
                    targets.insert(path.clone());
                    targets.extend(folders.iter().map(|folder| path.join(folder)));
                }
            }
            let targets: BTreeMap<_, _> = targets
                .into_iter()
                .filter_map(|path| path_stamp(&path).map(|stamp| (path, stamp)))
                .collect();
            Ok((targets, changed, refresh_snapshot, library_id))
        })();
        let Ok((targets, changed, refresh_snapshot, library_id)) = refresh else {
            continue;
        };
        catch_up = false;
        if let Some(watcher) = watcher.as_mut() {
            let remove = watched
                .iter()
                .filter(|(path, stamp)| targets.get(*path) != Some(*stamp))
                .map(|(path, _)| path.clone())
                .collect::<Vec<_>>();
            for path in remove {
                let _ = watcher.unwatch(&path);
                watched.remove(&path);
            }
            incomplete_watcher = false;
            for (path, stamp) in targets {
                if !watched.contains_key(&path) {
                    if watcher.watch(&path, RecursiveMode::NonRecursive).is_ok() {
                        watched.insert(path, stamp);
                        catch_up = true;
                    } else {
                        incomplete_watcher = true;
                    }
                }
            }
            if catch_up {
                // Close the gap between scanning and registering the new directories.
                let _ = signal.try_send(());
            }
        }
        if changed {
            emit(&app, &library_id, refresh_snapshot, None);
        }
    }
}

fn watch_targets(root: Option<&Root>, scan: &Scan) -> BTreeSet<PathBuf> {
    let Some(root) = root.filter(|root| root.authorized && scan.connected) else {
        return BTreeSet::new();
    };
    std::iter::once(root.path.clone())
        .chain(scan.folders.keys().map(|folder| root.path.join(folder)))
        .collect()
}

fn inactive_folders(conn: &Connection) -> Result<BTreeMap<PathBuf, BTreeSet<String>>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT r.path,p.folder FROM work_directory_roots r
         JOIN work_directory_photos p ON p.root_id=r.id WHERE r.active=0 AND r.authorized=1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut folders = BTreeMap::<_, BTreeSet<_>>::new();
    for row in rows {
        let (path, folder) = row.map_err(|e| e.to_string())?;
        if valid_component(&folder) {
            folders
                .entry(PathBuf::from(path))
                .or_default()
                .insert(folder);
        }
    }
    Ok(folders)
}

fn root_stamp(root: Option<&Root>) -> Option<RootStamp> {
    let root = root.filter(|root| root.authorized)?;
    path_stamp(&root.path)
}
