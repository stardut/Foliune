use crate::{
    book_export,
    books::{self, BookChapter, CreateBookInput},
    db::Store,
    groups,
    models::GroupInput,
    photos,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{Rgb, RgbImage};

fn store() -> (tempfile::TempDir, Store) {
    let root = tempfile::tempdir().unwrap();
    let store = Store::open(root.path().join("managed")).unwrap();
    books::init(&store.connection.lock().unwrap()).unwrap();
    (root, store)
}
fn photo(root: &tempfile::TempDir, store: &Store, name: &str, library: &str) -> String {
    let path = root.path().join(name);
    RgbImage::from_pixel(80, 60, Rgb([12, 48, 96]))
        .save(&path)
        .unwrap();
    photos::import(store, vec![path.to_str().unwrap().into()], library, None)
        .unwrap()
        .imported_ids[0]
        .clone()
}
pub(crate) fn input(ids: Vec<String>) -> CreateBookInput {
    CreateBookInput {
        title: "海岸 <script> & 旅途".into(),
        template: "white".into(),
        page_width: 1200,
        page_height: 900,
        chapters: vec![BookChapter {
            id: "chapter-1".into(),
            title: "第一章".into(),
            photo_ids: ids,
        }],
    }
}

#[test]
fn album_deletion_hides_history_only_photo_and_preserves_current_book_on_restore() {
    let (root, store) = store();
    let history_photo = photo(&root, &store, "history.png", "collection");
    let current_photo = photo(&root, &store, "current.png", "collection");
    let mut conn = store.connection.lock().unwrap();
    let album = groups::create(
        &conn,
        GroupInput {
            library: "collection".into(),
            name: "删除画册素材相簿".into(),
            description: String::new(),
            capacity: None,
        },
    )
    .unwrap()
    .groups[0]
        .id
        .clone();
    groups::add(
        &mut conn,
        &album,
        &[history_photo.clone(), current_photo.clone()],
    )
    .unwrap();
    let first = books::create(&mut conn, input(vec![history_photo.clone()])).unwrap();
    let mut replacement = crate::book_layout::generate(
        input(vec![current_photo.clone()]).chapters,
        "full",
        1200,
        900,
    )
    .unwrap();
    replacement.pages[0].caption = "保留当前编辑".into();
    let saved = books::save_version(
        &mut conn,
        &first.book.id,
        &first.book.current_version_id,
        replacement,
    )
    .unwrap();
    let current_id = &saved.book.current_version_id;
    let history_id = &first.book.current_version_id;
    conn.execute(
        "UPDATE book_versions SET data=json_set(data,'$.reflowUndoId',?1) WHERE id=?2",
        [history_id, current_id],
    )
    .unwrap();
    let rows_before_delete = stored_rows(&conn, &saved.book.id);

    let state = crate::work_directory::runtime::delete_album(&mut conn, &album).unwrap();
    assert_eq!(state.hidden_photo_ids, [history_photo.clone()]);
    assert!(state.photos.iter().any(|p| p.id == current_photo));
    assert!(books::create(&mut conn, input(vec![history_photo.clone()])).is_err());
    assert!(books::append_photos(&mut conn, &saved.book.id, vec![history_photo.clone()]).is_err());
    assert!(book_export::document(&conn, &saved.book.id, history_id, &mut Vec::new()).is_err());
    assert_eq!(stored_rows(&conn, &saved.book.id), rows_before_delete);

    let original: String = conn
        .query_row(
            "SELECT original_path FROM photos WHERE id=?1",
            [&history_photo],
            |row| row.get(0),
        )
        .unwrap();
    let original_bytes = std::fs::read(original).unwrap();
    drop(conn);
    let archive = root.path().join("book-backup.zip");
    assert_eq!(
        crate::backup::create(&store, &archive).unwrap().photo_count,
        1
    );
    let restored = crate::backup::restore(&store, &archive).unwrap();
    assert_eq!(restored.photo_count, 1);
    let state = crate::libraries::switch(
        &store,
        &crate::curation::CurationStore::default(),
        &restored.library.id,
    )
    .unwrap();
    assert_eq!(state.hidden_photo_ids, [history_photo.clone()]);
    let mut conn = store.connection.lock().unwrap();
    assert_eq!(stored_rows(&conn, &saved.book.id), rows_before_delete);
    let detail = books::get(&conn, &saved.book.id).unwrap();
    assert_eq!(&detail.book.current_version_id, current_id);
    assert_eq!(
        detail.book.cover_photo_id.as_deref(),
        Some(current_photo.as_str())
    );
    assert_eq!(detail.versions[0].input.pages[0].caption, "保留当前编辑");
    let original: String = conn
        .query_row(
            "SELECT original_path FROM photos WHERE id=?1",
            [&history_photo],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(std::fs::read(original).unwrap(), original_bytes);
    let edited = books::save_version(
        &mut conn,
        &saved.book.id,
        current_id,
        current_input(&detail),
    )
    .unwrap();
    let rows_after_save = stored_rows(&conn, &saved.book.id);
    assert!(rows_before_delete
        .iter()
        .all(|row| rows_after_save.contains(row)));
    let new_data = &rows_after_save
        .iter()
        .find(|row| row.0 == edited.book.current_version_id)
        .unwrap()
        .3;
    assert!(!new_data.contains("reflowUndoId"));
}

#[test]
fn archive_restore_rejects_hidden_current_book_references() {
    let (root, store) = store();
    let current_photo = photo(&root, &store, "current.png", "collection");
    let mut conn = store.connection.lock().unwrap();
    books::create(&mut conn, input(vec![current_photo.clone()])).unwrap();
    conn.execute(
        "UPDATE photos SET hidden_after_album_delete=1 WHERE id=?1",
        [&current_photo],
    )
    .unwrap();
    drop(conn);
    let archive = root.path().join("hidden-current.zip");
    crate::backup::create(&store, &archive).unwrap();
    let error = crate::backup::restore(&store, &archive).err().unwrap();
    assert!(error.contains(&format!("选片不存在：{current_photo}")));
}

#[test]
fn book_uses_both_libraries_and_survives_group_discard_and_reopen() {
    let (root, store) = store();
    let collection = photo(&root, &store, "collection.jpg", "collection");
    let work = photo(&root, &store, "work.png", "work");
    let mut conn = store.connection.lock().unwrap();
    let group = groups::create(
        &conn,
        GroupInput {
            library: "collection".into(),
            name: "收藏组".into(),
            description: String::new(),
            capacity: None,
        },
    )
    .unwrap()
    .groups[0]
        .id
        .clone();
    groups::add(&mut conn, &group, &[collection.clone()]).unwrap();
    let detail = books::create(&mut conn, input(vec![collection.clone(), work.clone()])).unwrap();
    assert_eq!(
        detail.book.cover_photo_id.as_deref(),
        Some(collection.as_str())
    );
    groups::set_statuses(&mut conn, &group, &[collection.clone()], "discarded").unwrap();
    assert_eq!(
        books::list(&conn).unwrap()[0].cover_photo_id.as_deref(),
        Some(collection.as_str())
    );
    assert_eq!(
        books::get(&conn, &detail.book.id).unwrap().versions[0]
            .input
            .chapters[0]
            .photo_ids,
        vec![collection, work]
    );
    let id = detail.book.id;
    drop(conn);
    drop(store);
    let reopened = Store::open(root.path().join("managed")).unwrap();
    let conn = reopened.connection.lock().unwrap();
    assert_eq!(books::get(&conn, &id).unwrap().book.photo_count, 2);
}

#[test]
fn shelf_cover_follows_current_reading_order_and_skips_unavailable_files() {
    let (root, store) = store();
    let first = photo(&root, &store, "first.jpg", "collection");
    let second = photo(&root, &store, "second.png", "work");
    let third = photo(&root, &store, "third.jpg", "work");
    let mut conn = store.connection.lock().unwrap();
    let created = books::create(
        &mut conn,
        input(vec![first.clone(), second.clone(), third.clone()]),
    )
    .unwrap();
    let mut reordered = created.versions[0].input.clone();
    reordered.pages.swap(0, 1);
    reordered.chapters[0].photo_ids.swap(0, 1);
    let saved = books::save_version(
        &mut conn,
        &created.book.id,
        &created.book.current_version_id,
        reordered,
    )
    .unwrap();
    assert_eq!(saved.book.cover_photo_id.as_deref(), Some(second.as_str()));
    let listed = books::list(&conn).unwrap();
    assert_eq!(listed[0].cover_photo_id, saved.book.cover_photo_id);
    assert_eq!((listed[0].version_count, listed[0].photo_count), (2, 3));

    let original: String = conn
        .query_row(
            "SELECT original_path FROM photos WHERE id=?1",
            [&second],
            |row| row.get(0),
        )
        .unwrap();
    std::fs::remove_file(original).unwrap();
    assert_eq!(
        books::list(&conn).unwrap()[0].cover_photo_id.as_deref(),
        Some(first.as_str())
    );
    let thumbnail: String = conn
        .query_row(
            "SELECT thumbnail_path FROM photos WHERE id=?1",
            [&first],
            |row| row.get(0),
        )
        .unwrap();
    std::fs::remove_file(thumbnail).unwrap();
    assert_eq!(
        books::get(&conn, &created.book.id)
            .unwrap()
            .book
            .cover_photo_id
            .as_deref(),
        Some(third.as_str())
    );
    let original: String = conn
        .query_row(
            "SELECT original_path FROM photos WHERE id=?1",
            [&third],
            |row| row.get(0),
        )
        .unwrap();
    std::fs::remove_file(original).unwrap();
    let listed = books::list(&conn).unwrap();
    assert_eq!(listed[0].cover_photo_id, None);
    assert_eq!(listed[0].photo_count, 3);
}

#[test]
fn new_book_layout_respects_selected_template() {
    let (root, store) = store();
    let a = photo(&root, &store, "a.jpg", "collection");
    let b = photo(&root, &store, "b.jpg", "work");
    let mut conn = store.connection.lock().unwrap();
    let mut create = input(vec![a, b]);
    create.template = "pair".into();
    let created = books::create(&mut conn, create).unwrap();
    assert_eq!(created.book.version_count, 1);
    let layout = &created.versions[0].input;
    assert_eq!(layout.template, "pair");
    assert_eq!(layout.pages.len(), 1);
    assert_eq!(layout.pages[0].items.len(), 2);
}

#[test]
fn invalid_layout_and_missing_references_leave_versions_unchanged() {
    let (root, store) = store();
    let a = photo(&root, &store, "a.jpg", "work");
    let mut conn = store.connection.lock().unwrap();
    assert!(books::create(&mut conn, input(vec!["missing-photo".into()])).is_err());
    assert!(books::list(&conn).unwrap().is_empty());
    let mut invalid_template = input(vec![a.clone()]);
    invalid_template.template = "invented".into();
    assert!(books::create(&mut conn, invalid_template).is_err());
    let detail = books::create(&mut conn, input(vec![a])).unwrap();
    let mut invalid = detail.versions[0].input.clone();
    invalid.pages[0].items[0].x = 99.0;
    assert!(books::save_version(
        &mut conn,
        &detail.book.id,
        &detail.book.current_version_id,
        invalid
    )
    .is_err());
    let after = books::get(&conn, &detail.book.id).unwrap();
    assert_eq!(after.book.version_count, 1);
    assert_eq!(after.versions[0].input.pages[0].items[0].x, 10.0);
}

#[test]
fn html_contains_original_images_utf8_and_escaped_text() {
    let (root, store) = store();
    let path = root.path().join("a.png");
    RgbImage::from_pixel(80, 60, Rgb([12, 48, 96]))
        .save(&path)
        .unwrap();
    let (imported, _) = photos::import_local(
        &store,
        vec![path.to_str().unwrap().into()],
        "collection",
        None,
    )
    .unwrap();
    let a = &imported.imported_ids[0];
    let mut conn = store.connection.lock().unwrap();
    let detail = books::create(&mut conn, input(vec![a.clone()])).unwrap();
    assert_eq!(detail.book.cover_photo_id.as_deref(), Some(a.as_str()));
    let mut manual = detail.versions[0].input.clone();
    manual.pages[0].caption = "说明 </script> & \"文本\"".into();
    let detail = books::save_version(
        &mut conn,
        &detail.book.id,
        &detail.book.current_version_id,
        manual,
    )
    .unwrap();
    let original = std::fs::read(&path).unwrap();
    let mut out = Vec::new();
    book_export::document(
        &conn,
        &detail.book.id,
        &detail.book.current_version_id,
        &mut out,
    )
    .unwrap();
    let html = String::from_utf8(out).unwrap();
    assert!(html.contains("<meta charset=\"utf-8\">"));
    assert!(html.contains("data:image/png;base64,"));
    assert!(html.contains(&STANDARD.encode(original)));
    assert!(html.contains("海岸 &lt;script&gt; &amp; 旅途"));
    assert!(html.contains("说明 &lt;/script&gt; &amp; &quot;文本&quot;"));
    assert!(!html.contains(path.to_str().unwrap()));
    let target = root.path().join("画册.html");
    book_export::export(
        &conn,
        &detail.book.id,
        &detail.book.current_version_id,
        &target,
    )
    .unwrap();
    assert!(std::fs::read_to_string(target)
        .unwrap()
        .contains("data:image/png;base64,"));
    std::fs::remove_file(path).unwrap();
    assert_eq!(books::list(&conn).unwrap()[0].cover_photo_id, None);
}

#[test]
fn export_missing_original_preserves_target_and_delete_preserves_photos() {
    let (root, store) = store();
    let a = photo(&root, &store, "a.png", "collection");
    let mut conn = store.connection.lock().unwrap();
    let detail = books::create(&mut conn, input(vec![a.clone()])).unwrap();
    let path: String = conn
        .query_row(
            "SELECT original_path FROM photos WHERE id=?1",
            [&a],
            |row| row.get(0),
        )
        .unwrap();
    std::fs::remove_file(path).unwrap();
    let target = root.path().join("existing.html");
    std::fs::write(&target, "keep existing file").unwrap();
    let error = book_export::export(
        &conn,
        &detail.book.id,
        &detail.book.current_version_id,
        &target,
    )
    .unwrap_err();
    assert!(error.contains("原图缺失"));
    assert_eq!(
        std::fs::read_to_string(target).unwrap(),
        "keep existing file"
    );
    assert!(std::fs::read_dir(root.path()).unwrap().all(|e| !e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".foliune-")));
    books::delete(&mut conn, &detail.book.id).unwrap();
    assert!(books::list(&conn).unwrap().is_empty());
    let count: u32 = conn
        .query_row("SELECT COUNT(*) FROM photos WHERE id=?1", [a], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn adding_selected_photos_creates_new_version_and_keeps_previous_manual_layout() {
    let (root, store) = store();
    let first = photo(&root, &store, "first.jpg", "collection");
    let second = photo(&root, &store, "second.png", "work");
    let mut conn = store.connection.lock().unwrap();
    let created = books::create(&mut conn, input(vec![first.clone()])).unwrap();
    let mut manual = created.versions[0].input.clone();
    manual.pages[0].caption = "原有手工文字".into();
    let saved = books::save_version(
        &mut conn,
        &created.book.id,
        &created.book.current_version_id,
        manual,
    )
    .unwrap();
    let old_id = saved.book.current_version_id.clone();
    let before = stored_rows(&conn, &saved.book.id);
    let appended = books::append_photos(
        &mut conn,
        &saved.book.id,
        vec![first, second.clone(), second],
    )
    .unwrap();
    assert_eq!(appended.book.version_count, 3);
    assert_eq!(appended.book.photo_count, 2);
    assert_ne!(appended.book.current_version_id, old_id);
    assert_eq!(appended.versions[0].input.pages[0].caption, "原有手工文字");
    let after = stored_rows(&conn, &saved.book.id);
    assert!(before.iter().all(|row| after.contains(row)));
}

fn current_input(detail: &books::BookDetail) -> books::VersionInput {
    detail.versions[0].input.clone()
}
fn stored_rows(
    conn: &rusqlite::Connection,
    book_id: &str,
) -> Vec<(String, String, String, String)> {
    let mut statement = conn
        .prepare("SELECT id,created_at,kind,data FROM book_versions WHERE book_id=?1 ORDER BY id")
        .unwrap();
    statement
        .query_map([book_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

#[test]
fn editor_saves_are_immutable_and_stale_save_and_export_are_rejected() {
    let (root, store) = store();
    let a = photo(&root, &store, "a.jpg", "work");
    let mut conn = store.connection.lock().unwrap();
    let created = books::create(&mut conn, input(vec![a])).unwrap();
    let mut draft = current_input(&created);
    draft.pages[0].caption = "第一次编辑".into();
    let saved = books::save_version(
        &mut conn,
        &created.book.id,
        &created.book.current_version_id,
        draft.clone(),
    )
    .unwrap();
    let before = stored_rows(&conn, &created.book.id);
    draft.pages[0].caption = "继续编辑".into();
    let saved_again = books::save_version(
        &mut conn,
        &saved.book.id,
        &saved.book.current_version_id,
        draft.clone(),
    )
    .unwrap();
    let after = stored_rows(&conn, &saved.book.id);
    for row in before {
        assert!(after.contains(&row), "saved row was modified");
    }
    assert_eq!(saved_again.book.version_count, 3);
    assert!(books::save_version(
        &mut conn,
        &saved.book.id,
        &saved.book.current_version_id,
        draft
    )
    .is_err());
    let mut out = Vec::new();
    assert!(book_export::document(
        &conn,
        &saved.book.id,
        &saved.book.current_version_id,
        &mut out
    )
    .is_err());
    assert!(out.is_empty());
    assert_eq!(stored_rows(&conn, &saved.book.id), after);
}
