use crate::{
    backup,
    books::{self, BookChapter, CreateBookInput},
    curation::{self, CurationStore},
    db::{self, Store},
    libraries, photos,
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
fn backup_restore_builds_new_library_with_stable_photo_and_book_refs() {
    let (dir, store, id) = setup();
    let drafts = CurationStore::default();
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
    let restored = backup::restore(&store, &path).unwrap();
    assert_eq!(restored.photo_count, 1);
    assert_eq!(libraries::list(&store).unwrap().current_id, "default");
    let state = libraries::switch(&store, &drafts, &restored.library.id).unwrap();
    assert_eq!(state.photos[0].id, id);
    assert!(state.photos[0].original_available && state.photos[0].thumbnail_available);
    assert!(state.photos[0]
        .original_path
        .starts_with(&restored.library.path));
    let restored_book = books::get(&store.connection.lock().unwrap(), &book.book.id).unwrap();
    assert_eq!(
        restored_book.versions[0].input.chapters[0].photo_ids,
        vec![id.clone()]
    );
    photos::update(
        &mut store.connection.lock().unwrap(),
        &id,
        json!({"title":"新库标题"}),
    )
    .unwrap();
    drop(store);
    let reopened = Store::open(dir.path().join("managed")).unwrap();
    assert_eq!(
        db::snapshot(&reopened.connection.lock().unwrap())
            .unwrap()
            .photos[0]
            .title,
        "新库标题"
    );
    let old = libraries::switch(&reopened, &CurationStore::default(), "default").unwrap();
    assert_eq!(old.photos[0].title, "photo");
    assert!(old.photos[0].original_available);
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
    assert_eq!(libraries::list(&store).unwrap().libraries.len(), 1);
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
fn switching_cancels_staged_drafts_and_future_imports_use_current_library() {
    let (dir, store, _) = setup();
    let path = dir.path().join("backup.zip");
    backup::create(&store, &path).unwrap();
    let restored = backup::restore(&store, &path).unwrap();
    let drafts = CurationStore::default();
    let source = dir.path().join("photo.png").to_string_lossy().into_owned();
    let draft = curation::prepare_import_files(&store, &drafts, vec![source.clone()], "work", None)
        .unwrap();
    libraries::switch(&store, &drafts, &restored.library.id).unwrap();
    assert!(!store.root.join("staging").join(&draft.id).exists());
    assert!(curation::commit(&store, &drafts, &draft.id, draft.pending_ids).is_err());
    let imported = photos::import(&store, vec![source], "work", None).unwrap();
    let new = imported
        .snapshot
        .photos
        .iter()
        .find(|photo| photo.library == "work")
        .unwrap();
    assert!(new.original_path.starts_with(&restored.library.path));
    let old = libraries::switch(&store, &drafts, "default").unwrap();
    assert_eq!(old.photos.len(), 1);
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
    let restored = backup::restore(&store, &windows).unwrap();
    let state = libraries::switch(&store, &CurationStore::default(), &restored.library.id).unwrap();
    assert_eq!(state.photos[0].id, id);
    assert!(state.photos[0].original_available && state.photos[0].thumbnail_available);
}
