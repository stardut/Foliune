use super::*;
use crate::work_directory::{
    active,
    queue::JobStatus,
    runtime::path_stamp,
    scan,
    tests::{photo, Fixture},
};
use std::fs;

fn discover(fixture: &Fixture, cache: &mut Cache) {
    discover_for(&fixture.store, cache);
}

fn discover_for(store: &Store, cache: &mut Cache) {
    let conn = store.connection.lock().unwrap();
    let root = active(&conn).unwrap().unwrap();
    cache
        .update(
            store,
            &conn,
            db::library_root(&conn).unwrap(),
            Some(root.clone()),
            Some((scan(Some(&root)), path_stamp(&root.path))),
        )
        .unwrap();
}

fn setup_queue(fixture: &Fixture) -> Mutex<Cache> {
    fixture.binding(&fixture.store.connection.lock().unwrap());
    let mut cache = Cache::default();
    discover(fixture, &mut cache);
    let mut conn = fixture.store.connection.lock().unwrap();
    cache
        .enqueue(&mut conn, cache.state.candidates.clone())
        .unwrap();
    Mutex::new(cache)
}

#[test]
fn failure_isolated_from_next_album_and_retry_reuses_the_same_job_and_album() {
    let fixture = Fixture::new();
    let preserved = fixture.works.join("a-broken/a.png");
    photo(&preserved, 10);
    fs::write(fixture.works.join("a-broken/b.jpg"), b"invalid image").unwrap();
    photo(&fixture.works.join("b-good/a.png"), 20);
    let bytes = fs::read(&preserved).unwrap();
    let cache = setup_queue(&fixture);
    let queued = cache.lock().unwrap().view();
    assert_eq!(queued.jobs.len(), 2);
    assert!(queued
        .jobs
        .iter()
        .all(|job| job.status == JobStatus::Queued && job.processed == 0));
    assert!(queued.candidates.is_empty());
    assert!(db::snapshot(&fixture.store.connection.lock().unwrap())
        .unwrap()
        .photos
        .is_empty());

    let mut deltas = Vec::new();
    assert!(process_next(&fixture.store, &cache, |_, delta| deltas.extend(delta)).unwrap());
    let failed = cache.lock().unwrap().view().jobs;
    assert_eq!(failed[0].status, JobStatus::Failed);
    assert_eq!(failed[0].processed, 1);
    assert!(failed[0].error.as_deref().unwrap().contains("b.jpg"));
    assert_eq!(failed[1].status, JobStatus::Queued);
    assert!(deltas.is_empty());
    assert!(db::snapshot(&fixture.store.connection.lock().unwrap())
        .unwrap()
        .photos
        .is_empty());

    assert!(process_next(&fixture.store, &cache, |_, delta| deltas.extend(delta)).unwrap());
    assert_eq!(deltas[0].job_id, queued.jobs[1].id);
    assert_eq!(deltas[0].album.id, queued.jobs[1].album_id);
    assert_eq!(deltas[0].photos.len(), 1);
    assert!(deltas[0].created_album);
    assert!(!process_next(&fixture.store, &cache, |_, _| unreachable!()).unwrap());
    {
        let mut cache = cache.lock().unwrap();
        discover(&fixture, &mut cache);
        assert!(cache.view().candidates.is_empty());
        photo(&fixture.works.join("a-broken/b.jpg"), 30);
        let stamp = cache.stamp;
        let conn = fixture.store.connection.lock().unwrap();
        cache.queue.retry(&conn, &queued.jobs[0].id, stamp).unwrap();
        let retried = &cache.view().jobs[0];
        assert_eq!(retried.status, JobStatus::Queued);
        assert_eq!(retried.processed, 0);
        assert!(retried.error.is_none());
    }
    assert!(process_next(&fixture.store, &cache, |_, delta| deltas.extend(delta)).unwrap());
    assert_eq!(deltas[1].job_id, queued.jobs[0].id);
    assert_eq!(deltas[1].album.id, queued.jobs[0].album_id);
    assert_eq!(deltas[1].photos.len(), 2);
    assert!(cache.lock().unwrap().view().jobs.is_empty());
    assert_eq!(fs::read(&preserved).unwrap(), bytes);
    assert_eq!(
        fs::read_dir(fixture.store.root.join("originals"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        fs::read_dir(fixture.store.root.join("staging/work-directory"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn preparation_releases_connection_and_commit_rechecks_changed_capacity() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("album/first.png"), 10);
    let cache = setup_queue(&fixture);
    let album = cache.lock().unwrap().view().jobs[0].album_id.clone();
    process_next(&fixture.store, &cache, |_, _| {}).unwrap();
    photo(&fixture.works.join("album/second.png"), 20);
    photo(&fixture.works.join("album/third.png"), 30);
    {
        let mut cache = cache.lock().unwrap();
        discover(&fixture, &mut cache);
        let candidates = cache.state.candidates.clone();
        let mut conn = fixture.store.connection.lock().unwrap();
        cache.enqueue(&mut conn, candidates).unwrap();
    }
    let mut edited = false;
    process_next(&fixture.store, &cache, |_, delta| {
        assert!(delta.is_none());
        if let (Ok(conn), Ok(cache)) = (fixture.store.connection.try_lock(), cache.try_lock()) {
            let job = &cache.view().jobs[0];
            assert_eq!(job.status, JobStatus::Running);
            assert!(job.processed > 0);
            let snapshot = db::snapshot(&conn).unwrap();
            assert_eq!(snapshot.photos.len(), 1);
            assert_eq!(snapshot.memberships.len(), 1);
            conn.execute("UPDATE groups SET capacity=1 WHERE id=?1", [&album])
                .unwrap();
            edited = true;
        }
    })
    .unwrap();
    assert!(edited);
    let jobs = cache.lock().unwrap().view().jobs;
    assert_eq!(jobs[0].status, JobStatus::Failed);
    assert_eq!(jobs[0].processed, 2);
    assert!(jobs[0].error.as_deref().unwrap().contains("容量"));
    let snapshot = db::snapshot(&fixture.store.connection.lock().unwrap()).unwrap();
    assert_eq!(snapshot.photos.len(), 1);
    assert_eq!(snapshot.memberships.len(), 1);
    assert_eq!(snapshot.groups[0].capacity, Some(1));
    assert_eq!(
        fs::read_dir(fixture.store.root.join("thumbnails"))
            .unwrap()
            .count(),
        1
    );
    assert_eq!(
        fs::read_dir(fixture.store.root.join("staging/work-directory"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn switching_libraries_after_preparation_cancels_commit_and_cleans_stage() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("album/first.png"), 10);
    let cache = setup_queue(&fixture);
    let replacement = Store::open_direct(fixture.works.with_file_name("replacement")).unwrap();
    let mut replacement = replacement.connection.into_inner().unwrap();
    let mut switched = false;
    process_next(&fixture.store, &cache, |_, delta| {
        assert!(delta.is_none());
        if let (Ok(mut conn), Ok(mut cache)) =
            (fixture.store.connection.try_lock(), cache.try_lock())
        {
            std::mem::swap(&mut *conn, &mut replacement);
            *cache = Cache::default();
            switched = true;
        }
    })
    .unwrap();
    assert!(switched);
    assert!(cache.lock().unwrap().view().jobs.is_empty());
    assert!(db::snapshot(&replacement).unwrap().photos.is_empty());
    assert!(db::snapshot(&fixture.store.connection.lock().unwrap())
        .unwrap()
        .photos
        .is_empty());
    assert_eq!(
        fs::read_dir(fixture.store.root.join("thumbnails"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        fs::read_dir(fixture.store.root.join("staging/work-directory"))
            .unwrap()
            .count(),
        0
    );
    let mut cache = cache.into_inner().unwrap();
    let original = Store::open(fixture.store.root.clone()).unwrap();
    discover_for(&original, &mut cache);
    assert_eq!(cache.view().jobs[0].status, JobStatus::Queued);
    assert!(process_next(&original, &Mutex::new(cache), |_, _| {}).unwrap());
    assert_eq!(
        db::snapshot(&original.connection.lock().unwrap())
            .unwrap()
            .photos
            .len(),
        1
    );
}

#[test]
fn switching_away_and_back_does_not_allow_previous_attempt_to_commit() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("album/first.png"), 10);
    let cache = setup_queue(&fixture);
    let jobs = cache.lock().unwrap().view().jobs;
    let replacement = Store::open_direct(fixture.works.with_file_name("replacement")).unwrap();
    let mut replacement = replacement.connection.into_inner().unwrap();
    let mut switched = false;
    process_next(&fixture.store, &cache, |_, delta| {
        assert!(delta.is_none());
        if !switched {
            if let (Ok(mut conn), Ok(mut cache)) =
                (fixture.store.connection.try_lock(), cache.try_lock())
            {
                std::mem::swap(&mut *conn, &mut replacement);
                *cache = Cache::default();
                std::mem::swap(&mut *conn, &mut replacement);
                *cache = Cache::default();
                let root = active(&conn).unwrap().unwrap();
                cache
                    .update(
                        &fixture.store,
                        &conn,
                        fixture.store.root.clone(),
                        Some(root.clone()),
                        Some(crate::work_directory::observe_path(&root.path)),
                    )
                    .unwrap();
                assert_eq!(cache.view().jobs, jobs);
                switched = true;
            }
        }
    })
    .unwrap();
    assert!(switched);
    assert!(db::snapshot(&fixture.store.connection.lock().unwrap())
        .unwrap()
        .photos
        .is_empty());
    assert_eq!(cache.lock().unwrap().view().jobs, jobs);
    let mut deltas = Vec::new();
    assert!(process_next(&fixture.store, &cache, |_, delta| deltas.extend(delta)).unwrap());
    assert_eq!(deltas.len(), 1);
    assert_eq!(deltas[0].job_id, jobs[0].id);
}

#[test]
fn reopened_queue_continues_first_unfinished_album_with_only_confirmed_files() {
    let fixture = Fixture::new();
    for (folder, color) in [("a", 10), ("b", 20), ("c", 30)] {
        photo(&fixture.works.join(folder).join("confirmed.png"), color);
    }
    let old_cache = setup_queue(&fixture);
    let jobs = old_cache.lock().unwrap().view().jobs;
    process_next(&fixture.store, &old_cache, |_, _| {}).unwrap();
    let committed_id = db::snapshot(&fixture.store.connection.lock().unwrap())
        .unwrap()
        .photos
        .remove(0)
        .id;
    {
        let mut old_cache = old_cache.lock().unwrap();
        let job = old_cache.queue.take_next().unwrap();
        assert_eq!(job.state.id, jobs[1].id);
        old_cache.queue.progress(&job.state.id, 1);
    }
    photo(&fixture.works.join("b/added-after-confirmation.png"), 40);
    let reopened = Store::open(fixture.store.root.clone()).unwrap();
    let mut recovered = Cache::default();
    discover_for(&reopened, &mut recovered);
    assert_eq!(recovered.view().jobs, jobs[1..]);
    assert!(recovered.view().candidates.is_empty());
    let recovered = Mutex::new(recovered);
    let mut deltas = Vec::new();
    while process_next(&reopened, &recovered, |_, delta| deltas.extend(delta)).unwrap() {}
    assert_eq!(deltas.len(), 2);
    for (delta, job) in deltas.iter().zip(&jobs[1..]) {
        assert_eq!(delta.job_id, job.id);
        assert_eq!(delta.album.id, job.album_id);
        assert_eq!(delta.photos.len(), 1);
        assert_eq!(delta.photos[0].original_name, "confirmed.png");
    }
    let snapshot = db::snapshot(&reopened.connection.lock().unwrap()).unwrap();
    assert_eq!(snapshot.groups.len(), 3);
    assert_eq!(snapshot.photos.len(), 3);
    assert!(snapshot.photos.iter().any(|photo| photo.id == committed_id));
    let mut cache = Cache::default();
    discover_for(&reopened, &mut cache);
    let state = cache.view();
    assert!(state.jobs.is_empty());
    assert_eq!(state.candidates.len(), 1);
    assert_eq!(
        state.candidates[0].album_id.as_ref(),
        Some(&jobs[1].album_id)
    );
    assert_eq!(
        state.candidates[0].file_names,
        ["added-after-confirmation.png"]
    );
}

#[test]
fn persisted_failure_waits_for_retry_and_persisted_retry_runs_on_reopen() {
    let fixture = Fixture::new();
    let bad_file = fixture.works.join("album/b.jpg");
    photo(&fixture.works.join("album/a.png"), 10);
    fs::write(&bad_file, b"invalid image").unwrap();
    let cache = setup_queue(&fixture);
    let job = cache.lock().unwrap().view().jobs.remove(0);
    process_next(&fixture.store, &cache, |_, _| {}).unwrap();
    let failure = cache.lock().unwrap().view().jobs.remove(0);
    assert_eq!(failure.status, JobStatus::Failed);
    assert_eq!(failure.processed, 1);
    assert!(failure.error.as_deref().unwrap().contains("b.jpg"));
    photo(&bad_file, 20);
    {
        let reopened = Store::open(fixture.store.root.clone()).unwrap();
        let mut cache = Cache::default();
        discover_for(&reopened, &mut cache);
        assert_eq!(cache.view().jobs, [failure]);
        let cache = Mutex::new(cache);
        assert!(!process_next(&reopened, &cache, |_, _| unreachable!()).unwrap());
        let mut cache = cache.into_inner().unwrap();
        let stamp = cache.stamp;
        cache
            .queue
            .retry(&reopened.connection.lock().unwrap(), &job.id, stamp)
            .unwrap();
    }
    let reopened = Store::open(fixture.store.root.clone()).unwrap();
    let mut cache = Cache::default();
    discover_for(&reopened, &mut cache);
    assert_eq!(cache.view().jobs, [job.clone()]);
    let mut deltas = Vec::new();
    assert!(
        process_next(&reopened, &Mutex::new(cache), |_, delta| deltas
            .extend(delta))
        .unwrap()
    );
    assert_eq!(deltas[0].job_id, job.id);
    assert_eq!(deltas[0].album.id, job.album_id);
    assert_eq!(deltas[0].photos.len(), 2);
}

#[test]
fn disconnected_job_returns_to_waiting_and_resumes_after_reopen_and_reconnect() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("album/a.png"), 10);
    let cache = setup_queue(&fixture);
    let jobs = cache.lock().unwrap().view().jobs;
    let unplugged = fixture.works.with_file_name("unplugged");
    let mut removed = false;
    assert!(!process_next(&fixture.store, &cache, |_, delta| {
        assert!(delta.is_none());
        if !removed && cache.try_lock().is_ok() {
            fs::rename(&fixture.works, &unplugged).unwrap();
            removed = true;
        }
    })
    .unwrap());
    assert!(removed);
    assert_eq!(cache.lock().unwrap().view().jobs, jobs);
    let reopened = Store::open(fixture.store.root.clone()).unwrap();
    let mut cache = Cache::default();
    discover_for(&reopened, &mut cache);
    assert_eq!(cache.view().jobs, jobs);
    let cache = Mutex::new(cache);
    assert!(!process_next(&reopened, &cache, |_, _| unreachable!()).unwrap());
    fs::rename(&unplugged, &fixture.works).unwrap();
    discover_for(&reopened, &mut cache.lock().unwrap());
    let mut deltas = Vec::new();
    assert!(process_next(&reopened, &cache, |_, delta| deltas.extend(delta)).unwrap());
    assert_eq!(deltas[0].job_id, jobs[0].id);
    assert_eq!(deltas[0].album.id, jobs[0].album_id);
    assert!(cache.lock().unwrap().view().jobs.is_empty());
}

#[cfg(target_os = "macos")]
#[test]
fn a_replacement_directory_at_the_same_path_does_not_inherit_confirmation() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("album/a.png"), 10);
    let cache = setup_queue(&fixture);
    assert!(cache.lock().unwrap().stamp.unwrap().durable().is_some());
    fs::rename(&fixture.works, fixture.works.with_file_name("original")).unwrap();
    photo(&fixture.works.join("album/a.png"), 20);
    let reopened = Store::open(fixture.store.root.clone()).unwrap();
    let mut cache = Cache::default();
    discover_for(&reopened, &mut cache);
    let cache = Mutex::new(cache);
    assert!(process_next(&reopened, &cache, |_, delta| assert!(delta.is_none())).unwrap());
    let job = cache.lock().unwrap().view().jobs.remove(0);
    assert_eq!(job.status, JobStatus::Failed);
    assert!(job.error.as_deref().unwrap().contains("来源已变化"));
    {
        let conn = reopened.connection.lock().unwrap();
        assert!(db::snapshot(&conn).unwrap().photos.is_empty());
        crate::work_directory::relink(&conn, &fixture.works).unwrap();
    }
    let mut cache = Cache::default();
    discover_for(&reopened, &mut cache);
    assert!(cache.view().jobs.is_empty());
    assert_eq!(cache.view().candidates[0].file_names, ["a.png"]);
}
