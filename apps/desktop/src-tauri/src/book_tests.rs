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
fn input(ids: Vec<String>) -> CreateBookInput {
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
    groups::set_statuses(&mut conn, &group, &[collection.clone()], "discarded").unwrap();
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
fn reflow_never_overwrites_manual_version_and_history_can_be_selected() {
    let (root, store) = store();
    let a = photo(&root, &store, "a.jpg", "collection");
    let b = photo(&root, &store, "b.jpg", "work");
    let mut conn = store.connection.lock().unwrap();
    let created = books::create(&mut conn, input(vec![a, b])).unwrap();
    let mut manual = created.versions[0].input.clone();
    manual.label = "我的手工版".into();
    manual.pages[0].caption = "手动说明".into();
    manual.pages[0].items[0].fit = "cover".into();
    manual.pages[0].items[0].crop_x = 12.0;
    let saved = books::save_version(
        &mut conn,
        &created.book.id,
        &created.book.current_version_id,
        manual,
    )
    .unwrap();
    assert_eq!(saved.book.version_count, 2);
    let manual_id = saved.book.current_version_id.clone();
    let before = serde_json::to_value(
        &saved
            .versions
            .iter()
            .find(|v| v.id == manual_id)
            .unwrap()
            .input,
    )
    .unwrap();
    let reflowed = books::reflow(&mut conn, &saved.book.id, &manual_id, "pair").unwrap();
    assert_eq!(reflowed.book.version_count, 3);
    assert_eq!(
        reflowed
            .versions
            .iter()
            .find(|v| v.id == reflowed.book.current_version_id)
            .unwrap()
            .input
            .pages
            .len(),
        1
    );
    assert_eq!(
        serde_json::to_value(
            &reflowed
                .versions
                .iter()
                .find(|v| v.id == manual_id)
                .unwrap()
                .input
        )
        .unwrap(),
        before
    );
    let selected = books::select_version(&mut conn, &saved.book.id, &manual_id).unwrap();
    assert_eq!(selected.book.current_version_id, manual_id);
}

#[test]
fn invalid_layout_and_missing_references_leave_versions_unchanged() {
    let (root, store) = store();
    let a = photo(&root, &store, "a.jpg", "work");
    let mut conn = store.connection.lock().unwrap();
    assert!(books::create(&mut conn, input(vec!["missing-photo".into()])).is_err());
    assert!(books::list(&conn).unwrap().is_empty());
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
    assert!(books::reflow(
        &mut conn,
        &detail.book.id,
        &detail.book.current_version_id,
        "invented"
    )
    .is_err());
}

#[test]
fn html_contains_original_images_utf8_and_escaped_text() {
    let (root, store) = store();
    let a = photo(&root, &store, "a.png", "collection");
    let mut conn = store.connection.lock().unwrap();
    let detail = books::create(&mut conn, input(vec![a.clone()])).unwrap();
    let mut manual = detail.versions[0].input.clone();
    manual.pages[0].caption = "说明 </script> & \"文本\"".into();
    let detail = books::save_version(
        &mut conn,
        &detail.book.id,
        &detail.book.current_version_id,
        manual,
    )
    .unwrap();
    let path: String = conn
        .query_row("SELECT original_path FROM photos WHERE id=?1", [a], |row| {
            row.get(0)
        })
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
    assert!(!html.contains(&path));
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
    let before = serde_json::to_value(
        &saved
            .versions
            .iter()
            .find(|v| v.id == old_id)
            .unwrap()
            .input,
    )
    .unwrap();
    let appended = books::append_photos(
        &mut conn,
        &saved.book.id,
        vec![first, second.clone(), second],
    )
    .unwrap();
    assert_eq!(appended.book.version_count, 3);
    assert_eq!(appended.book.photo_count, 2);
    assert_ne!(appended.book.current_version_id, old_id);
    assert_eq!(
        serde_json::to_value(
            &appended
                .versions
                .iter()
                .find(|v| v.id == old_id)
                .unwrap()
                .input
        )
        .unwrap(),
        before
    );
}
