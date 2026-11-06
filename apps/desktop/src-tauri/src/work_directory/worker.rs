use super::{emit, wake_monitor, Cache, RootDirectory, RootStamp, WorkDirectoryMonitor};
use crate::{
    db::{self, Store},
    work_directory::sync::{self, SyncDelta},
};
use std::{
    io,
    sync::{mpsc::Receiver, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

#[cfg(test)]
#[path = "worker_tests.rs"]
mod tests;

pub(super) fn run_jobs(app: AppHandle, pending: Receiver<()>) {
    let store = app.state::<Store>();
    let manager = app.state::<WorkDirectoryMonitor>();
    while pending.recv().is_ok() {
        loop {
            match process_next(&store, &manager.cache, |library_id, synced| {
                let refresh = synced.is_some();
                emit(&app, library_id, refresh, synced);
                if refresh {
                    wake_monitor(&app);
                }
            }) {
                Ok(true) => {}
                Ok(false) => break,
                Err(error) => {
                    eprintln!("作品目录同步队列不可用：{error}");
                    break;
                }
            }
        }
    }
}

fn process_next(
    store: &Store,
    cache: &Mutex<Cache>,
    mut notify: impl FnMut(&str, Option<SyncDelta>),
) -> Result<bool, String> {
    let (job, root, library, library_id, context_id, offline_epoch, stamp, validated) = {
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        cache.ensure_context(store, &conn)?;
        let Some(root) = cache.root.clone() else {
            return Ok(false);
        };
        if !cache.scan.connected {
            return Ok(false);
        }
        let Some(job) = cache.queue.take_next() else {
            return Ok(false);
        };
        let library_id = cache.state.library_id.clone();
        notify(&library_id, None);
        let observed_source = cache.stamp.and_then(RootStamp::durable);
        let validated = if job.source.is_some() && job.source != observed_source {
            Err("作品目录来源已变化，请重新定位后查看待同步内容".into())
        } else {
            sync::validate_job(&conn, &root, &job.candidate)
        };
        let stamp = if job.source.is_some() {
            cache.stamp
        } else {
            job.stamp.or(cache.stamp)
        };
        (
            job,
            root,
            cache.library.clone(),
            library_id,
            cache.context_id,
            cache.offline_epoch,
            stamp,
            validated,
        )
    };
    let id = &job.state.id;
    let result = (|| {
        validated?;
        let mut last = Instant::now();
        let mut prepared = sync::prepare(&root, &job.candidate, &library, stamp, |processed| {
            {
                let mut cache = cache.lock().map_err(|e| e.to_string())?;
                if cache.context_id != context_id
                    || cache.offline_epoch != offline_epoch
                    || !cache.queue.progress(id, processed)
                {
                    return Err("图库或作品目录已变化".into());
                }
            }
            if last.elapsed() >= PROGRESS_INTERVAL || processed == job.state.file_count {
                notify(&library_id, None);
                last = Instant::now();
            }
            Ok(())
        })?;
        let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        if db::library_root(&conn)? != library
            || cache.context_id != context_id
            || !cache.queue.is_running(id)
        {
            return Err("图库或作品目录已切换".into());
        }
        if !cache.scan.connected
            || cache.stamp != prepared.identity
            || cache.offline_epoch != offline_epoch
        {
            return Err("作品目录已变化，请确认连接后重试".into());
        }
        let delta = sync::commit(
            &mut conn,
            &root,
            &job.candidate,
            &job.state.album_id,
            id,
            &library_id,
            &mut prepared,
        )?;
        cache.queue.complete(id);
        // Send the commit before readers can observe the successful job disappear.
        notify(&library_id, Some(delta));
        Ok(())
    })();
    if let Err(error) = result {
        let observed = RootDirectory::open(&root.path);
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        let mut cache = cache.lock().map_err(|e| e.to_string())?;
        if cache.context_id != context_id || !cache.queue.is_running(id) {
            return Ok(true);
        }
        let interrupted = match observed {
            Ok(directory) => {
                let current = directory.identity();
                let same_durable =
                    job.source.is_some() && job.source == current.and_then(RootStamp::durable);
                (cache.offline_epoch != offline_epoch && (job.source.is_none() || same_durable))
                    || (same_durable && current != stamp)
            }
            Err(error) => unavailable(&error),
        };
        if interrupted {
            cache.queue.pause(id);
            notify(&library_id, None);
            return Ok(false);
        }
        if let Err(error) = cache.queue.fail(&conn, id, error) {
            cache.queue.pause(id);
            return Err(error);
        }
        notify(&library_id, None);
    }
    Ok(true)
}

fn unavailable(error: &io::Error) -> bool {
    if matches!(
        error.kind(),
        io::ErrorKind::NotFound | io::ErrorKind::NotConnected
    ) {
        return true;
    }
    #[cfg(unix)]
    if matches!(
        error.raw_os_error(),
        Some(libc::ENODEV | libc::ENXIO | libc::ESTALE)
    ) {
        return true;
    }
    false
}
