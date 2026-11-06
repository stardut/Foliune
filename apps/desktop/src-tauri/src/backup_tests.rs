use crate::{
    backup,
    books::{self, BookChapter, CreateBookInput},
    curation::{self, CurationStore},
    db::{self, Store},
    groups,
    models::GroupInput,
    photos,
};
use image::{Rgb, RgbImage};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

fn setup() -> (tempfile::TempDir, Store, String) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("managed")).unwrap();
    let image = dir.path().join("photo.png");
    RgbImage::from_pixel(64, 48, Rgb([100, 140, 180]))
        .save(&image)
        .unwrap();
    let id = photos::import(
        &store,
        vec![image.to_string_lossy().into()],
        "collection",
        None,
    )
    .unwrap()
    .imported_ids[0]
        .clone();
    (dir, store, id)
}

#[test]
fn backup_restore_adds_to_current_library_and_keeps_stable_photo_and_book_refs() {
    let (dir, store, id) = setup();
    let book = books::create(
        &mut store.connection.lock().unwrap(),
        CreateBookInput {
            title: "留存".into(),
            template: "white".into(),
            page_width: 1200,
            page_height: 900,
            chapters: vec![BookChapter {
                id: "chapter".into(),
                title: "第一章".into(),
                photo_ids: vec![id.clone()],
            }],
        },
    )
    .unwrap();
    let path = dir.path().join("backup.zip");
    let exported = backup::create(&store, &path).unwrap();
    assert_eq!(exported.photo_count, 1);
    let mut archive = ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
    let names: Vec<_> = (0..archive.len())
        .map(|index| archive.by_index(index).unwrap().name().to_string())
        .collect();
    assert!(names.iter().all(|name| !name.contains("key")
        && !name.contains("selection")
        && !name.contains("staging")));
    let target = Store::open(dir.path().join("target")).unwrap();
    let other_id = photos::import(
        &target,
        vec![dir.path().join("photo.png").to_string_lossy().into()],
        "work",
        None,
    )
    .unwrap()
    .imported_ids[0]
        .clone();
    let restored = backup::restore(&target, &path).unwrap();
    assert_eq!(restored.photo_count, 1);
    assert_eq!(restored.skipped_membership_count, 0);
    assert_eq!(restored.snapshot.photos.len(), 2);
    assert!(restored
        .snapshot
        .photos
        .iter()
        .any(|photo| photo.id == other_id));
    let photo = restored
        .snapshot
        .photos
        .iter()
        .find(|photo| photo.id == id)
        .unwrap();
    assert!(photo.original_available && photo.thumbnail_available);
    assert!(std::path::Path::new(&photo.original_path).starts_with(&target.root));
    let restored_book = books::get(&target.connection.lock().unwrap(), &book.book.id).unwrap();
    assert_eq!(
        restored_book.versions[0].input.chapters[0].photo_ids,
        vec![id.clone()]
    );
    photos::update(
        &mut target.connection.lock().unwrap(),
        &id,
        json!({"title":"当前标题"}),
    )
    .unwrap();
    let repeated = backup::restore(&target, &path).unwrap();
    assert_eq!(repeated.photo_count, 0);
    let current = repeated
        .snapshot
        .photos
        .iter()
        .find(|photo| photo.id == id)
        .unwrap();
    assert_eq!(current.title, "当前标题");
    assert_eq!(current.original_path, photo.original_path);
    assert_eq!(current.thumbnail_path, photo.thumbnail_path);
    assert_eq!(
        fs::read_dir(target.root.join("originals")).unwrap().count(),
        2
    );
    assert!(!target.root.join("libraries").exists());

    drop(target);
    let reopened = Store::open(dir.path().join("target")).unwrap();
    let snapshot = db::snapshot(&reopened.connection.lock().unwrap()).unwrap();
    assert_eq!(
        snapshot
            .photos
            .iter()
            .find(|photo| photo.id == id)
            .unwrap()
            .title,
        "当前标题"
    );
    assert_eq!(
        db::snapshot(&store.connection.lock().unwrap())
            .unwrap()
            .photos[0]
            .title,
        "photo"
    );
}

#[test]
fn backup_preserves_local_photo_index_and_thumbnail_without_authorizing_its_path() {
    let (dir, store, managed_id) = setup();
    let source = dir.path().join("photo.png");
    let (imported, _) =
        photos::import_local(&store, vec![source.to_str().unwrap().into()], "work", None).unwrap();
    let local_id = &imported.imported_ids[0];
    let archive_path = dir.path().join("mixed.zip");
    backup::create(&store, &archive_path).unwrap();
    let archive = ZipArchive::new(fs::File::open(&archive_path).unwrap()).unwrap();
    assert_eq!(
        archive
            .file_names()
            .filter(|name| name.starts_with("originals/"))
            .count(),
        1
    );
    assert_eq!(
        archive
            .file_names()
            .filter(|name| name.starts_with("thumbnails/"))
            .count(),
        2
    );
    let target = Store::open(dir.path().join("target")).unwrap();
    let restored = backup::restore(&target, &archive_path).unwrap();
    let snapshot = &restored.snapshot;
    let repeated = backup::restore(&store, &archive_path).unwrap();
    assert_eq!(repeated.photo_count, 0);
    let current = repeated
        .snapshot
        .photos
        .iter()
        .find(|photo| &photo.id == local_id)
        .unwrap();
    assert!(current.original_available);
    let local = snapshot
        .photos
        .iter()
        .find(|photo| &photo.id == local_id)
        .unwrap();
    assert_eq!(local.original_path, crate::local_photo::PREFIX);
    assert!(!local.original_available && local.thumbnail_available);
    assert!(source.is_file());
    let managed = snapshot
        .photos
        .iter()
        .find(|photo| photo.id == managed_id)
        .unwrap();
    assert!(managed.original_available && managed.thumbnail_available);
    assert_eq!(
        fs::read_dir(target.root.join("originals")).unwrap().count(),
        1
    );
}

#[test]
fn metadata_backup_omits_even_available_managed_originals_and_restores_thumbnails() {
    let (dir, store, managed_id) = setup();
    let source = dir.path().join("photo.png");
    let (imported, _) =
        photos::import_local(&store, vec![source.to_str().unwrap().into()], "work", None).unwrap();
    let local_id = &imported.imported_ids[0];
    let originals = db::snapshot(&store.connection.lock().unwrap())
        .unwrap()
        .photos;
    fs::remove_file(&source).unwrap();
    let full_path = dir.path().join("full.zip");
    assert!(matches!(
        backup::create_with_mode(&store, &full_path, backup::BackupMode::Full),
        Err(error) if error.contains("照片原件缺失")
    ));
    assert!(!full_path.exists());
    let path = dir.path().join("metadata.zip");
    assert_eq!(
        backup::create_with_mode(&store, &path, backup::BackupMode::Metadata)
            .unwrap()
            .photo_count,
        2
    );
    let archive = ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
    assert!(!archive
        .file_names()
        .any(|name| name.starts_with("originals/")));
    assert_eq!(archive.len(), 4);

    let target = Store::open(dir.path().join("target")).unwrap();
    let result = backup::restore(&target, &path).unwrap();
    assert_eq!(result.photo_count, 2);
    assert!(result
        .snapshot
        .photos
        .iter()
        .any(|photo| &photo.id == local_id));
    assert!(result
        .snapshot
        .photos
        .iter()
        .any(|photo| photo.id == managed_id));
    for photo in result.snapshot.photos {
        assert_eq!(photo.original_path, crate::local_photo::PREFIX);
        assert!(!photo.original_available && photo.thumbnail_available);
    }
    let live = db::snapshot(&store.connection.lock().unwrap()).unwrap();
    for (photo, original) in live.photos.iter().zip(originals) {
        assert_eq!(photo.original_path, original.original_path);
        assert_eq!(photo.original_available, photo.id == managed_id);
    }
}

#[test]
fn album_deletion_backups_keep_hidden_managed_files_and_local_index() {
    let (dir, store, managed_id) = setup();
    let source = dir.path().join("photo.png");
    let source_bytes = fs::read(&source).unwrap();
    let (imported, _) = photos::import_local(
        &store,
        vec![source.to_str().unwrap().into()],
        "collection",
        None,
    )
    .unwrap();
    let local_id = imported.imported_ids[0].clone();
    let thumbnail_bytes = {
        let mut conn = store.connection.lock().unwrap();
        let group_id = crate::groups::create(
            &conn,
            crate::models::GroupInput {
                library: "collection".into(),
                name: "待删除".into(),
                description: String::new(),
                capacity: None,
            },
        )
        .unwrap()
        .groups[0]
            .id
            .clone();
        crate::groups::add(
            &mut conn,
            &group_id,
            &[managed_id.clone(), local_id.clone()],
        )
        .unwrap();
        crate::groups::set_status(&mut conn, &group_id, &local_id, "discarded").unwrap();
        let deleted = crate::work_directory::runtime::delete_album(&mut conn, &group_id).unwrap();
        assert!(deleted.photos.is_empty());
        assert_eq!(deleted.hidden_photo_ids.len(), 2);
        db::snapshot_with_hidden(&conn)
            .unwrap()
            .photos
            .into_iter()
            .map(|photo| (photo.id, fs::read(photo.thumbnail_path).unwrap()))
            .collect::<std::collections::HashMap<_, _>>()
    };

    let path = dir.path().join("hidden.zip");
    assert_eq!(backup::create(&store, &path).unwrap().photo_count, 0);
    let target = Store::open(dir.path().join("target")).unwrap();
    let restored = backup::restore(&target, &path).unwrap();
    assert_eq!(restored.photo_count, 0);
    let state = &restored.snapshot;
    assert!(state.photos.is_empty());
    assert!(state.hidden_photo_ids.contains(&managed_id));
    assert!(state.hidden_photo_ids.contains(&local_id));
    for photo in db::snapshot_with_hidden(&target.connection.lock().unwrap())
        .unwrap()
        .photos
    {
        assert!(std::path::Path::new(&photo.thumbnail_path).starts_with(&target.root));
        assert_eq!(
            fs::read(photo.thumbnail_path).unwrap(),
            thumbnail_bytes[&photo.id]
        );
        if photo.id == managed_id {
            assert!(std::path::Path::new(&photo.original_path).starts_with(&target.root));
            assert_eq!(fs::read(photo.original_path).unwrap(), source_bytes);
        } else {
            assert_eq!(photo.original_path, crate::local_photo::PREFIX);
        }
    }
    assert_eq!(fs::read(source).unwrap(), source_bytes);
}

#[test]
fn archive_tamper_and_traversal_never_modify_current_library() {
    let (dir, store, id) = setup();
    let path = dir.path().join("backup.zip");
    backup::create(&store, &path).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
    let tampered = dir.path().join("tampered.zip");
    let mut output = ZipWriter::new(fs::File::create(&tampered).unwrap());
    let options = SimpleFileOptions::default();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        if entry.name().starts_with("originals/") {
            bytes[0] ^= 0xff;
        }
        output.start_file(entry.name(), options).unwrap();
        output.write_all(&bytes).unwrap();
    }
    output.finish().unwrap();
    assert!(backup::restore(&store, &tampered).is_err());
    assert_eq!(
        db::snapshot(&store.connection.lock().unwrap())
            .unwrap()
            .photos[0]
            .id,
        id
    );
    assert!(!store.root.join("libraries").exists());
    let malicious = dir.path().join("unsafe.zip");
    let mut output = ZipWriter::new(fs::File::create(&malicious).unwrap());
    output.start_file("manifest.json", options).unwrap();
    output.write_all(json!({"format":"foliune-library","version":1,"files":[{"path":"../escape","size":1,"sha256":"0".repeat(64)}]}).to_string().as_bytes()).unwrap();
    output.start_file("../escape", options).unwrap();
    output.write_all(b"x").unwrap();
    output.finish().unwrap();
    assert!(backup::restore(&store, &malicious).is_err());
    assert!(!dir.path().join("managed/escape").exists());
}

#[test]
fn restoring_keeps_staged_drafts_and_future_imports_use_current_library() {
    let (dir, store, _) = setup();
    let path = dir.path().join("backup.zip");
    backup::create(&store, &path).unwrap();
    let target = Store::open(dir.path().join("target")).unwrap();
    let drafts = CurationStore::default();
    let source = dir.path().join("photo.png").to_string_lossy().into_owned();
    let draft =
        curation::prepare_import_files(&target, &drafts, vec![source], "work", None).unwrap();
    backup::restore(&target, &path).unwrap();
    assert!(target.root.join("staging").join(&draft.id).exists());
    let imported = curation::commit(&target, &drafts, &draft.id, draft.pending_ids).unwrap();
    assert_eq!(imported.photos.len(), 2);
    let new = imported
        .photos
        .iter()
        .find(|photo| photo.library == "work")
        .unwrap();
    assert!(crate::local_photo::is_locator(&new.original_path));
    assert!(new.original_available);
    assert!(std::path::Path::new(&new.thumbnail_path).starts_with(&target.root));
}

#[test]
fn windows_style_database_paths_restore_on_macos() {
    let (dir, store, id) = setup();
    let path = dir.path().join("backup.zip");
    backup::create(&store, &path).unwrap();
    let mut archive = ZipArchive::new(fs::File::open(&path).unwrap()).unwrap();
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).unwrap();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        entries.push((file.name().to_string(), bytes));
    }
    let database = dir.path().join("windows.sqlite");
    fs::write(
        &database,
        &entries
            .iter()
            .find(|(name, _)| name == "library.sqlite")
            .unwrap()
            .1,
    )
    .unwrap();
    let conn = rusqlite::Connection::open(&database).unwrap();
    let (original, thumbnail): (String, String) = conn
        .query_row(
            "SELECT original_path,thumbnail_path FROM photos WHERE id=?1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let filename = std::path::Path::new(&original)
        .file_name()
        .unwrap()
        .to_str()
        .unwrap();
    let thumbname = std::path::Path::new(&thumbnail)
        .file_name()
        .unwrap()
        .to_str()
        .unwrap();
    conn.execute(
        "UPDATE photos SET original_path=?1,thumbnail_path=?2 WHERE id=?3",
        rusqlite::params![
            format!("C:\\Users\\Foliune\\originals\\{filename}"),
            format!("C:\\Users\\Foliune\\thumbnails\\{thumbname}"),
            id
        ],
    )
    .unwrap();
    drop(conn);
    let bytes = fs::read(&database).unwrap();
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let mut manifest: serde_json::Value = serde_json::from_slice(
        &entries
            .iter()
            .find(|(name, _)| name == "manifest.json")
            .unwrap()
            .1,
    )
    .unwrap();
    for file in manifest["files"].as_array_mut().unwrap() {
        if file["path"] == "library.sqlite" {
            file["size"] = json!(bytes.len());
            file["sha256"] = json!(digest);
        }
    }
    for (name, data) in &mut entries {
        if name == "library.sqlite" {
            *data = bytes.clone();
        } else if name == "manifest.json" {
            *data = serde_json::to_vec(&manifest).unwrap();
        }
    }
    let windows = dir.path().join("windows.zip");
    let mut output = ZipWriter::new(fs::File::create(&windows).unwrap());
    for (name, bytes) in entries {
        output
            .start_file(name, SimpleFileOptions::default())
            .unwrap();
        output.write_all(&bytes).unwrap();
    }
    output.finish().unwrap();
    let target = Store::open(dir.path().join("target")).unwrap();
    let state = backup::restore(&target, &windows).unwrap().snapshot;
    assert_eq!(state.photos[0].id, id);
    assert!(state.photos[0].original_available && state.photos[0].thumbnail_available);
}

fn album(store: &Store, name: &str) -> String {
    let conn = store.connection.lock().unwrap();
    let state = groups::create(
        &conn,
        GroupInput {
            library: "collection".into(),
            name: name.into(),
            description: String::new(),
            capacity: None,
        },
    )
    .unwrap();
    state
        .groups
        .into_iter()
        .find(|group| group.name == name)
        .unwrap()
        .id
}

#[test]
fn album_cover_backup_preserves_new_albums_and_respects_current_library() {
    let (dir, source, photo_id) = setup();
    let source_path = dir.path().join("photo.png").to_string_lossy().into_owned();
    let hidden_id = photos::import(&source, vec![source_path], "collection", None)
        .unwrap()
        .imported_ids
        .remove(0);
    let shared_id = album(&source, "共享相簿");
    let cover = json!({"photoId": photo_id, "offsetX": 0.2, "offsetY": 0.8, "zoom": 2.5});
    {
        let mut conn = source.connection.lock().unwrap();
        groups::add(&mut conn, &shared_id, std::slice::from_ref(&photo_id)).unwrap();
        groups::update(&mut conn, &shared_id, json!({"cover": cover})).unwrap();
    }
    let initial = dir.path().join("initial.zip");
    backup::create_with_mode(&source, &initial, backup::BackupMode::Metadata).unwrap();
    let target = Store::open(dir.path().join("target")).unwrap();
    let restored = backup::restore(&target, &initial).unwrap();
    assert_eq!(
        serde_json::to_value(&restored.snapshot.groups[0].cover).unwrap(),
        cover
    );
    let current_cover = json!({"photoId": photo_id, "offsetX": 1.0, "offsetY": 0.0, "zoom": 1.0});
    let removed_id = album(&target, "已删除相簿");
    {
        let mut conn = target.connection.lock().unwrap();
        groups::update(&mut conn, &shared_id, json!({"cover": current_cover})).unwrap();
        groups::add(&mut conn, &removed_id, std::slice::from_ref(&hidden_id)).unwrap();
        crate::work_directory::runtime::delete_album(&mut conn, &removed_id).unwrap();
    }

    let new_id = album(&source, "新相簿");
    let skipped_id = album(&source, "封面成员冲突");
    {
        let mut conn = source.connection.lock().unwrap();
        groups::add(&mut conn, &new_id, std::slice::from_ref(&photo_id)).unwrap();
        groups::update(&mut conn, &new_id, json!({"cover": cover})).unwrap();
        groups::set_status(&mut conn, &new_id, &photo_id, "discarded").unwrap();
        groups::add(
            &mut conn,
            &skipped_id,
            &[hidden_id.clone(), photo_id.clone()],
        )
        .unwrap();
        let mut skipped_cover = cover.clone();
        skipped_cover["photoId"] = json!(hidden_id);
        groups::update(&mut conn, &skipped_id, json!({"cover": skipped_cover})).unwrap();
    }
    let incoming = dir.path().join("incoming.zip");
    backup::create_with_mode(&source, &incoming, backup::BackupMode::Full).unwrap();
    for _ in 0..2 {
        let restored = backup::restore(&target, &incoming).unwrap();
        let restored_cover = |id: &str| {
            let group = restored
                .snapshot
                .groups
                .iter()
                .find(|group| group.id == id)
                .unwrap();
            serde_json::to_value(&group.cover).unwrap()
        };
        assert_eq!(restored_cover(&shared_id), current_cover);
        assert_eq!(restored_cover(&new_id), cover);
        assert!(restored_cover(&skipped_id).is_null());
        assert_eq!(restored.skipped_membership_count, 1);
        assert!(restored
            .snapshot
            .memberships
            .iter()
            .any(|member| member.group_id == new_id
                && member.photo_id == photo_id
                && member.status == "discarded"));
    }

    source
        .connection
        .lock()
        .unwrap()
        .execute_batch("DROP TABLE album_covers;")
        .unwrap();
    let legacy = dir.path().join("legacy.zip");
    backup::create(&source, &legacy).unwrap();
    let target = Store::open(dir.path().join("legacy-target")).unwrap();
    let snapshot = backup::restore(&target, &legacy).unwrap().snapshot;
    assert_eq!(snapshot.groups.len(), 3);
    assert!(snapshot.groups.iter().all(|group| group.cover.is_none()));
    drop(source);
    let reopened = Store::open(dir.path().join("managed")).unwrap();
    assert_eq!(
        db::snapshot(&reopened.connection.lock().unwrap())
            .unwrap()
            .groups
            .len(),
        3
    );
}

#[test]
fn restore_keeps_current_membership_state_and_reports_conflicting_relationships() {
    let (dir, source, first) = setup();
    let source_path = dir.path().join("photo.png").to_string_lossy().into_owned();
    let hidden = photos::import(&source, vec![source_path.clone()], "collection", None)
        .unwrap()
        .imported_ids
        .remove(0);
    let shared = album(&source, "共享相簿");
    groups::add(
        &mut source.connection.lock().unwrap(),
        &shared,
        &[first.clone()],
    )
    .unwrap();
    let path = dir.path().join("initial.zip");
    backup::create(&source, &path).unwrap();
    let target = Store::open(dir.path().join("target")).unwrap();
    backup::restore(&target, &path).unwrap();

    let removed = album(&target, "已删除相簿");
    {
        let mut conn = target.connection.lock().unwrap();
        groups::add(&mut conn, &removed, &[hidden.clone()]).unwrap();
        crate::work_directory::runtime::delete_album(&mut conn, &removed).unwrap();
        groups::set_status(&mut conn, &shared, &first, "discarded").unwrap();
        groups::update(&mut conn, &shared, json!({"name":"当前相簿","capacity":1})).unwrap();
    }

    let additions = photos::import(&source, vec![source_path; 3], "collection", None)
        .unwrap()
        .imported_ids;
    {
        let mut conn = source.connection.lock().unwrap();
        let mut incoming = vec![hidden.clone()];
        incoming.extend(additions.iter().cloned());
        groups::add(&mut conn, &shared, &incoming).unwrap();
        groups::set_status(&mut conn, &shared, &additions[2], "discarded").unwrap();
        books::create(
            &mut conn,
            CreateBookInput {
                title: "引用当前已隐藏的照片".into(),
                template: "white".into(),
                page_width: 1200,
                page_height: 900,
                chapters: vec![BookChapter {
                    id: "chapter".into(),
                    title: String::new(),
                    photo_ids: vec![hidden.clone()],
                }],
            },
        )
        .unwrap();
    }
    let path = dir.path().join("incoming.zip");
    backup::create(&source, &path).unwrap();
    for added_count in [3, 0] {
        let restored = backup::restore(&target, &path).unwrap();
        assert_eq!(restored.photo_count, added_count);
        assert_eq!(restored.skipped_membership_count, 2);
        assert_eq!(restored.skipped_document_count, 1);
        assert_eq!(restored.snapshot.hidden_photo_ids, [hidden.clone()]);
        assert_eq!(restored.snapshot.groups[0].name, "当前相簿");
        assert_eq!(restored.snapshot.groups[0].capacity, Some(1));
        assert_eq!(
            restored
                .snapshot
                .memberships
                .iter()
                .map(|member| (
                    member.photo_id.as_str(),
                    member.status.as_str(),
                    member.position
                ))
                .collect::<Vec<_>>(),
            [
                (first.as_str(), "discarded", 0),
                (additions[0].as_str(), "active", 1),
                (additions[2].as_str(), "discarded", 2),
            ]
        );
    }
    let conn = target.connection.lock().unwrap();
    assert!(books::list(&conn).unwrap().is_empty());
    assert_eq!(
        conn.query_row("SELECT count(*) FROM book_versions", [], |row| row
            .get::<_, usize>(0))
            .unwrap(),
        0
    );
}

#[test]
fn restore_rolls_back_copied_files_and_database_when_live_write_fails() {
    let (dir, source, _) = setup();
    album(&source, "备份相簿");
    let path = dir.path().join("backup.zip");
    backup::create(&source, &path).unwrap();
    let target = Store::open(dir.path().join("target")).unwrap();
    let current = photos::import(
        &target,
        vec![dir.path().join("photo.png").to_string_lossy().into()],
        "work",
        None,
    )
    .unwrap()
    .snapshot
    .photos
    .remove(0);
    let bytes = fs::read(&current.original_path).unwrap();
    target
        .connection
        .lock()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER inject_restore_failure BEFORE INSERT ON groups
         BEGIN SELECT RAISE(ABORT,'injected restore failure'); END;",
        )
        .unwrap();

    let error = backup::restore(&target, &path).err().unwrap();
    assert!(error.contains("injected restore failure"), "{error}");
    let state = db::snapshot(&target.connection.lock().unwrap()).unwrap();
    assert_eq!(state.photos.len(), 1);
    assert_eq!(state.photos[0].id, current.id);
    assert!(state.groups.is_empty());
    assert_eq!(fs::read(&current.original_path).unwrap(), bytes);
    for folder in ["originals", "thumbnails"] {
        assert_eq!(fs::read_dir(target.root.join(folder)).unwrap().count(), 1);
    }
    assert!(fs::read_dir(&target.root).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".restoring-")));
}
