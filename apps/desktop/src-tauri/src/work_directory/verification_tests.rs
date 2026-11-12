use super::*;
use crate::{
    backup,
    work_directory::{
        original, scan, sync,
        tests::{photo, sync_now, Fixture},
        unbind,
    },
};
use std::{fs, path::PathBuf};

fn indexed_fixture() -> (Fixture, PathBuf) {
    let fixture = Fixture::new();
    let path = fixture.works.join("活动/原件.png");
    photo(&path, 10);
    let mut conn = fixture.store.connection.lock().unwrap();
    let root = fixture.binding(&conn);
    let pending = sync::candidates(&conn, &root, &scan(Some(&root))).unwrap();
    sync_now(&mut conn, &root, &pending).unwrap();
    drop(conn);
    (fixture, path)
}

fn set_signature(conn: &Connection, signature: Option<&str>) {
    conn.execute(
        "UPDATE work_directory_photos SET stat_signature=?1",
        [signature],
    )
    .unwrap();
}

#[test]
fn verifies_legacy_and_remounted_originals_off_lock_and_reuses_the_new_signature() {
    let (fixture, path) = indexed_fixture();
    let actual = stat_signature(&File::open(&path).unwrap()).unwrap();
    let stale = format!("other:{}:1:1", fs::metadata(&path).unwrap().len());
    for signature in [Some(stale.as_str()), None] {
        let conn = fixture.store.connection.lock().unwrap();
        set_signature(&conn, signature);
        let photo = db::snapshot(&conn).unwrap().photos.remove(0);
        let source_before = original(&conn, &photo.id, &photo.original_path).unwrap();
        assert!(photo.original_available && photo.thumbnail_available);
        drop(conn);

        let mut hashes = 0;
        verify_all(
            &fixture.store,
            |_| panic!("availability stayed the same"),
            |file| {
                assert!(fixture.store.connection.try_lock().is_ok());
                hashes += 1;
                fingerprint(file)
            },
        )
        .unwrap();
        assert_eq!(hashes, 1);

        let conn = fixture.store.connection.lock().unwrap();
        assert_eq!(
            indexed_photos(&conn).unwrap()[0]
                .source
                .stat_signature
                .as_deref(),
            Some(actual.as_str())
        );
        assert_eq!(
            original(&conn, &photo.id, &photo.original_path).unwrap(),
            source_before
        );
        drop(conn);
        verify_all(
            &fixture.store,
            |_| panic!("availability stayed the same"),
            |_| panic!("the verified stat signature must skip hashing"),
        )
        .unwrap();
    }
    let reopened = Store::open(fixture.store.root.clone()).unwrap();
    verify_all(
        &reopened,
        |_| {},
        |_| panic!("the verified signature must survive restart"),
    )
    .unwrap();
}

#[test]
fn rejects_same_size_changed_contents_and_preserves_status_in_restore() {
    let (fixture, path) = indexed_fixture();
    let bytes = fs::read(&path).unwrap();
    let mut changed_bytes = bytes.clone();
    changed_bytes[0] ^= 1;
    fs::write(&path, changed_bytes).unwrap();
    let conn = fixture.store.connection.lock().unwrap();
    unbind(&conn).unwrap();
    let indexed = indexed_photos(&conn).unwrap().remove(0);
    let photo = db::snapshot(&conn).unwrap().photos.remove(0);
    assert!(photo.original_available);
    assert!(original(&conn, &photo.id, &photo.original_path)
        .unwrap()
        .read()
        .is_err());
    drop(conn);

    let mut refreshes = 0;
    verify_all(&fixture.store, |_| refreshes += 1, fingerprint).unwrap();
    assert_eq!(refreshes, 1);
    let conn = fixture.store.connection.lock().unwrap();
    let current = indexed_photos(&conn).unwrap().remove(0);
    assert_eq!(current.source.stat_signature, indexed.source.stat_signature);
    assert_eq!(
        db::snapshot(&conn).unwrap().photos[0].availability,
        Some(BoundAvailability::Missing)
    );
    drop(conn);

    let archive = fixture.store.root.with_file_name("restore.zip");
    backup::create_with_mode(&fixture.store, &archive, backup::BackupMode::Metadata).unwrap();
    let restored = backup::restore(&fixture.store, &archive).unwrap();
    assert_eq!(
        restored.snapshot.photos[0].availability,
        Some(BoundAvailability::Missing)
    );

    fs::write(&path, bytes).unwrap();
    verify_all(&fixture.store, |_| refreshes += 1, fingerprint).unwrap();
    assert_eq!(refreshes, 2);
    let conn = fixture.store.connection.lock().unwrap();
    assert_eq!(
        db::snapshot(&conn).unwrap().photos[0].availability,
        Some(BoundAvailability::Available)
    );
}

#[test]
fn rejects_hash_writeback_after_the_index_changes() {
    let (fixture, path) = indexed_fixture();
    let conn = fixture.store.connection.lock().unwrap();
    set_signature(&conn, None);
    let photo = indexed_photos(&conn).unwrap().remove(0);
    drop(conn);
    let signature = stat_signature(&File::open(&path).unwrap()).unwrap();
    let observed = photo.hash(signature, fingerprint).unwrap();
    let conn = fixture.store.connection.lock().unwrap();
    let concurrent = "other:1:1:1";
    set_signature(&conn, Some(concurrent));
    assert!(!photo.record(&conn, observed).unwrap());
    assert_eq!(
        indexed_photos(&conn).unwrap()[0]
            .source
            .stat_signature
            .as_deref(),
        Some(concurrent)
    );
}

#[test]
fn rejects_the_hash_when_the_path_changes_during_the_read() {
    let (fixture, path) = indexed_fixture();
    let conn = fixture.store.connection.lock().unwrap();
    set_signature(&conn, None);
    let photo = indexed_photos(&conn).unwrap().remove(0);
    drop(conn);
    let signature = stat_signature(&File::open(&path).unwrap()).unwrap();
    let moved = path.with_file_name("原件已移动.png");
    let observed = photo.hash(signature, |file| {
        let hash = fingerprint(file)?;
        fs::rename(&path, &moved).unwrap();
        fs::copy(&moved, &path).unwrap();
        Ok(hash)
    });
    assert!(observed.is_none());
    let conn = fixture.store.connection.lock().unwrap();
    assert!(indexed_photos(&conn).unwrap()[0]
        .source
        .stat_signature
        .is_none());
}

#[test]
fn reconnect_publishes_reachable_originals_before_hashing() {
    let (fixture, path) = indexed_fixture();
    let moved = fixture.works.with_file_name("离线目录");
    let conn = fixture.store.connection.lock().unwrap();
    set_signature(&conn, None);
    drop(conn);
    fs::rename(&fixture.works, &moved).unwrap();
    verify_all(
        &fixture.store,
        |_| {},
        |_| panic!("offline files cannot be hashed"),
    )
    .unwrap();
    let conn = fixture.store.connection.lock().unwrap();
    assert_eq!(
        db::snapshot(&conn).unwrap().photos[0].availability,
        Some(BoundAvailability::Offline)
    );
    drop(conn);

    fs::rename(&moved, &fixture.works).unwrap();
    let refreshes = std::cell::Cell::new(0);
    verify_all(
        &fixture.store,
        |_| refreshes.set(refreshes.get() + 1),
        |file| {
            assert_eq!(refreshes.get(), 1);
            let conn = fixture.store.connection.try_lock().unwrap();
            let photo = db::snapshot(&conn).unwrap().photos.remove(0);
            assert!(photo.original_available && photo.thumbnail_available);
            drop(conn);
            fingerprint(file)
        },
    )
    .unwrap();
    assert_eq!(refreshes.get(), 1);
    let conn = fixture.store.connection.lock().unwrap();
    assert_eq!(
        indexed_photos(&conn).unwrap()[0].source.stat_signature,
        stat_signature(&File::open(path).unwrap())
    );
}
