use super::*;
use crate::{backup, db::Store, groups, models::GroupInput, photos};
use image::{Rgb, RgbImage};

const CITY: &str = "CHN:city-130100";
const OTHER_CITY: &str = "CHN:city-130200";

fn setup() -> (tempfile::TempDir, Store, String, String) {
    let root = tempfile::tempdir().unwrap();
    let store = Store::open(root.path().join("source")).unwrap();
    let image = root.path().join("photo.png");
    RgbImage::from_pixel(64, 48, Rgb([55, 100, 150]))
        .save(&image)
        .unwrap();
    let album = groups::insert(
        &store.connection.lock().unwrap(),
        GroupInput {
            library: "work".into(),
            name: "作品".into(),
            description: String::new(),
            capacity: None,
        },
    )
    .unwrap();
    let photo = photos::import(
        &store,
        vec![image.to_string_lossy().into_owned()],
        "work",
        Some(&album),
    )
    .unwrap()
    .imported_ids
    .remove(0);
    (root, store, album, photo)
}

#[test]
fn works_map_cover_is_sparse_persistent_and_independent_per_region() {
    let (root, store, _, photo) = setup();
    let mut conn = store.connection.lock().unwrap();
    assert!(db::snapshot(&conn)
        .unwrap()
        .works_map_region_covers
        .is_empty());
    save(&mut conn, CITY, Some(&photo)).unwrap();
    let state = db::snapshot(&conn).unwrap();
    assert_eq!(state.works_map_region_covers.get(CITY), Some(&photo));
    assert_eq!(
        serde_json::to_value(state).unwrap()["worksMapRegionCovers"][CITY],
        photo
    );
    let province = "CHN:CHN-1811";
    assert!(region_ids().unwrap().contains(province));
    save(&mut conn, province, Some(&photo)).unwrap();
    drop(conn);
    drop(store);
    let reopened = Store::open(root.path().join("source")).unwrap();
    let mut conn = reopened.connection.lock().unwrap();
    save(&mut conn, CITY, None).unwrap();
    let state = db::snapshot(&conn).unwrap();
    assert!(!state.works_map_region_covers.contains_key(CITY));
    assert_eq!(state.works_map_region_covers.get(province), Some(&photo));
    assert_eq!(read(&conn).unwrap().len(), 1);
    save(&mut conn, CITY, None).unwrap();
}

#[test]
fn works_map_cover_rejects_unknown_regions_and_inactive_or_foreign_photos() {
    let (root, store, album, photo) = setup();
    let collection = photos::import(
        &store,
        vec![root.path().join("photo.png").to_string_lossy().into_owned()],
        "collection",
        None,
    )
    .unwrap()
    .imported_ids
    .remove(0);
    let mut conn = store.connection.lock().unwrap();
    save(&mut conn, CITY, Some(&photo)).unwrap();
    assert!(save(&mut conn, "CHN:not-a-real-region", Some(&photo)).is_err());
    assert!(save(&mut conn, "CHN:not-a-real-region", None).is_err());
    assert!(save(&mut conn, CITY, Some("missing-photo")).is_err());
    assert!(save(&mut conn, CITY, Some(&collection)).is_err());
    groups::set_status(&mut conn, &album, &photo, "discarded").unwrap();
    assert!(save(&mut conn, CITY, Some(&photo)).is_err());
    assert_eq!(read(&conn).unwrap().get(CITY), Some(&photo));
    validate_archive(&conn).unwrap();
    groups::set_status(&mut conn, &album, &photo, "active").unwrap();
    conn.execute(
        "UPDATE photos SET hidden_after_album_delete=1 WHERE id=?1",
        [&photo],
    )
    .unwrap();
    assert!(save(&mut conn, CITY, Some(&photo)).is_err());
    assert_eq!(read(&conn).unwrap().get(CITY), Some(&photo));
}

#[test]
fn works_map_cover_never_keeps_deleted_album_photos_visible_or_blocks_photo_deletion() {
    let (_, store, album, photo) = setup();
    let mut conn = store.connection.lock().unwrap();
    save(&mut conn, CITY, Some(&photo)).unwrap();
    crate::work_directory::runtime::delete_album(&mut conn, &album).unwrap();
    let state = db::snapshot(&conn).unwrap();
    assert!(state.photos.is_empty());
    assert_eq!(state.hidden_photo_ids, [photo.clone()]);
    conn.execute("DELETE FROM photos WHERE id=?1", [&photo])
        .unwrap();
    assert!(read(&conn).unwrap().is_empty());
}

#[test]
fn works_map_cover_backup_restores_stable_ids_and_keeps_current_region_choice() {
    let (root, source, album, photo) = setup();
    save(&mut source.connection.lock().unwrap(), CITY, Some(&photo)).unwrap();
    for (name, mode) in [
        ("metadata", backup::BackupMode::Metadata),
        ("full", backup::BackupMode::Full),
    ] {
        let path = root.path().join(format!("{name}.zip"));
        backup::create_with_mode(&source, &path, mode).unwrap();
        let target = Store::open(root.path().join(name)).unwrap();
        let restored = backup::restore(&target, &path).unwrap();
        assert_eq!(
            restored.snapshot.works_map_region_covers.get(CITY),
            Some(&photo)
        );
        let other = photos::import(
            &target,
            vec![root.path().join("photo.png").to_string_lossy().into_owned()],
            "work",
            Some(&album),
        )
        .unwrap()
        .imported_ids
        .remove(0);
        save(&mut target.connection.lock().unwrap(), CITY, Some(&other)).unwrap();
        let repeated = backup::restore(&target, &path).unwrap();
        assert_eq!(
            repeated.snapshot.works_map_region_covers.get(CITY),
            Some(&other)
        );
        // Existing hidden photos must not be revived by an incoming cover.
        let mut conn = target.connection.lock().unwrap();
        save(&mut conn, CITY, None).unwrap();
        groups::set_status(&mut conn, &album, &photo, "discarded").unwrap();
        drop(conn);
        assert!(!backup::restore(&target, &path)
            .unwrap()
            .snapshot
            .works_map_region_covers
            .contains_key(CITY));
    }
}

#[test]
fn works_map_cover_migration_accepts_old_backups_and_validates_new_references() {
    let (root, source, _, photo) = setup();
    let conn = source.connection.lock().unwrap();
    conn.execute(
        "INSERT INTO works_map_region_covers(region_id,photo_id) VALUES(?1,?2)",
        params!["invalid-region", photo],
    )
    .unwrap();
    assert!(validate_archive(&conn).is_err());
    conn.execute_batch("DROP TABLE works_map_region_covers;")
        .unwrap();
    drop(conn);
    let path = root.path().join("legacy.zip");
    backup::create_with_mode(&source, &path, backup::BackupMode::Metadata).unwrap();
    let target = Store::open(root.path().join("target")).unwrap();
    assert!(backup::restore(&target, &path)
        .unwrap()
        .snapshot
        .works_map_region_covers
        .is_empty());
    drop(source);
    let reopened = Store::open(root.path().join("source")).unwrap();
    save(
        &mut reopened.connection.lock().unwrap(),
        OTHER_CITY,
        Some(&photo),
    )
    .unwrap();
}

#[test]
fn works_map_cover_historical_region_ids_do_not_block_backup_restore() {
    let (root, source, _, photo) = setup();
    let historical = "CHN:historical-region";
    let mut conn = source.connection.lock().unwrap();
    assert!(save(&mut conn, historical, Some(&photo)).is_err());
    conn.execute(
        "INSERT INTO works_map_region_covers(region_id,photo_id) VALUES(?1,?2)",
        params![historical, photo],
    )
    .unwrap();
    drop(conn);
    let path = root.path().join("historical.zip");
    backup::create_with_mode(&source, &path, backup::BackupMode::Metadata).unwrap();
    let target = Store::open(root.path().join("target")).unwrap();
    for _ in 0..2 {
        // Both the incoming archive and the merged current library may contain
        // a region no longer included in this app version's atlas.
        let restored = backup::restore(&target, &path).unwrap();
        assert_eq!(
            restored.snapshot.works_map_region_covers.get(historical),
            Some(&photo)
        );
    }
}
