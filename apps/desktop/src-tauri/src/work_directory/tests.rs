use super::*;
use crate::{
    backup, book_export,
    books::{self, BookChapter, CreateBookInput},
    db::{self, Store},
    groups,
};
use image::{Rgb, RgbImage};
use std::{fs, io::Cursor};

pub(super) struct Fixture {
    temp: tempfile::TempDir,
    pub(super) store: Store,
    pub(super) works: PathBuf,
}

impl Fixture {
    pub(super) fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().canonicalize().unwrap();
        let store = Store::open(base.join("managed")).unwrap();
        let works = base.join("作品");
        fs::create_dir(&works).unwrap();
        Self { temp, store, works }
    }

    pub(super) fn binding(&self, conn: &Connection) -> Root {
        bind(conn, &self.works).unwrap();
        active(conn).unwrap().unwrap()
    }

    fn pending(&self, conn: &Connection, root: &Root) -> Vec<sync::Candidate> {
        sync::candidates(conn, root, &scan(Some(root))).unwrap()
    }
}

pub(super) fn photo(path: &Path, red: u8) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    RgbImage::from_pixel(24, 18, Rgb([red, 80, 150]))
        .save(path)
        .unwrap();
}

fn sync_now(
    conn: &mut Connection,
    root: &Root,
    candidates: &[sync::Candidate],
) -> Result<(), String> {
    let library = db::library_root(conn)?;
    for candidate in candidates {
        sync::validate_job(conn, root, candidate)?;
        let mut prepared = sync::prepare(root, candidate, &library, None, |_| Ok(()))?;
        let mut jobs = queue::Queue::default();
        jobs.enqueue(conn, root, vec![candidate.clone()], None)?;
        let job = jobs.take_next().unwrap();
        let result = sync::commit(
            conn,
            root,
            candidate,
            &job.state.album_id,
            &job.state.id,
            "default",
            &mut prepared,
        );
        if result.is_err() {
            // A failed index commit leaves the queued confirmation intact.
            assert_eq!(queue::Queue::load(conn, root)?.states()[0].id, job.state.id);
        }
        result?;
    }
    Ok(())
}

#[test]
fn only_confirmed_direct_photos_get_stable_ids_and_no_original_copy() {
    let fixture = Fixture::new();
    let source = fixture.works.join("海岸/光线.PNG");
    photo(&source, 10);
    photo(&fixture.works.join("海岸/深一层/不收录.png"), 20);
    photo(&fixture.works.join("顶层不收录.png"), 30);
    photo(&fixture.works.join("只有孙目录/深一层/不收录.png"), 40);
    let bytes = fs::read(&source).unwrap();
    let mut conn = fixture.store.connection.lock().unwrap();
    let root = fixture.binding(&conn);
    let first = fixture.pending(&conn, &root);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].folder_name, "海岸");
    assert_eq!(first[0].file_names, ["光线.PNG"]);
    assert!(db::snapshot(&conn).unwrap().photos.is_empty());
    sync_now(&mut conn, &root, &first).unwrap();
    let indexed = db::snapshot(&conn).unwrap();
    let old = &indexed.photos[0];
    assert_eq!(indexed.groups[0].bound_folder.as_deref(), Some("海岸"));
    assert_eq!(old.availability, Some(BoundAvailability::Available));
    assert_eq!(
        original(&conn, &old.id, &old.original_path)
            .unwrap()
            .read()
            .unwrap(),
        bytes
    );
    assert_eq!(fs::read(&source).unwrap(), bytes);
    assert_eq!(
        fs::read_dir(fixture.store.root.join("originals"))
            .unwrap()
            .count(),
        0
    );
    assert!(Path::new(&old.thumbnail_path).is_file());

    let cover =
        serde_json::json!({"photoId": old.id, "offsetX": 0.25, "offsetY": 0.8, "zoom": 2.5});
    groups::update(
        &mut conn,
        &indexed.groups[0].id,
        serde_json::json!({"name":"改名后的相簿", "cover": cover}),
    )
    .unwrap();
    photo(&fixture.works.join("海岸/新片.jpg"), 50);
    let next = fixture.pending(&conn, &root);
    assert_eq!(
        next[0].album_id.as_deref(),
        Some(indexed.groups[0].id.as_str())
    );
    sync_now(&mut conn, &root, &next).unwrap();
    let appended = db::snapshot(&conn).unwrap();
    assert_eq!(appended.groups.len(), 1);
    assert_eq!(appended.groups[0].name, "改名后的相簿");
    assert_eq!(
        serde_json::to_value(&appended.groups[0].cover).unwrap(),
        cover
    );
    assert_eq!(appended.photos.len(), 2);
    assert_eq!(appended.memberships[0].photo_id, old.id);
    assert_eq!(appended.memberships[1].position, 1);
    assert!(fixture.pending(&conn, &root).is_empty());
}

#[test]
fn thumbnail_pipeline_uses_the_detected_format_for_supported_extensions() {
    let fixture = Fixture::new();
    let album = fixture.works.join("混合格式");
    fs::create_dir(&album).unwrap();
    let pixels = image::RgbaImage::from_pixel(32, 20, image::Rgba([30, 60, 90, 120]));
    let non_jpeg = [
        ("PNG.jpg", image::ImageFormat::Png),
        ("WebP.jpeg", image::ImageFormat::WebP),
    ];
    for (name, format) in non_jpeg {
        pixels.save_with_format(album.join(name), format).unwrap();
    }
    RgbImage::from_pixel(32, 20, Rgb([120, 60, 30]))
        .save_with_format(album.join("JPEG.png"), image::ImageFormat::Jpeg)
        .unwrap();
    let mut conn = fixture.store.connection.lock().unwrap();
    let root = fixture.binding(&conn);
    let candidates = fixture.pending(&conn, &root);
    sync_now(&mut conn, &root, &candidates).unwrap();
    let snapshot = db::snapshot(&conn).unwrap();
    assert_eq!(snapshot.photos.len(), 3);
    for photo in snapshot.photos {
        let path = Path::new(&photo.thumbnail_path);
        assert_eq!((photo.width, photo.height), (32, 20));
        assert_eq!(image::image_dimensions(path).unwrap(), (32, 20));
        if photo.original_name == "JPEG.png" {
            #[cfg(target_os = "macos")]
            {
                let mut reader = std::io::BufReader::new(fs::File::open(path).unwrap());
                let exif = crate::photo_metadata::read_exif(&mut reader).unwrap();
                let color_space = exif
                    .get_field(exif::Tag::ColorSpace, exif::In::PRIMARY)
                    .unwrap();
                assert_eq!(color_space.value.get_uint(0), Some(1));
            }
        } else {
            let source = album.join(photo.original_name);
            let prepared =
                crate::photos::prepare_open_image(&source, fs::File::open(&source).unwrap())
                    .unwrap();
            let expected = fixture.temp.path().join("expected.jpg");
            crate::photos::save_thumbnail(&prepared.image, &expected).unwrap();
            assert_eq!(fs::read(path).unwrap(), fs::read(expected).unwrap());
        }
    }
}

#[test]
fn ignore_exact_shown_additions_and_delete_suppress_after_reopen() {
    let fixture = Fixture::new();
    let path = fixture.works.join("收录/首张.jpg");
    photo(&path, 10);
    let unreferenced = fixture.works.join("收录/仅在相簿.jpg");
    photo(&unreferenced, 11);
    let unreferenced_bytes = fs::read(&unreferenced).unwrap();
    let mut conn = fixture.store.connection.lock().unwrap();
    let root = fixture.binding(&conn);
    let first = fixture.pending(&conn, &root);
    sync_now(&mut conn, &root, &first).unwrap();

    photo(&fixture.works.join("未收录/整组.jpg"), 20);
    photo(&fixture.works.join("收录/忽略.jpg"), 30);
    let shown = fixture.pending(&conn, &root);
    photo(&fixture.works.join("收录/弹窗后的新片.jpg"), 40);
    sync::ignore(&mut conn, &root, &shown).unwrap();
    photo(&fixture.works.join("未收录/后来仍忽略.jpg"), 50);
    drop(conn);
    let reopened = Store::open(fixture.store.root.clone()).unwrap();
    let mut conn = reopened.connection.lock().unwrap();
    let next = fixture.pending(&conn, &root);
    assert_eq!(next.len(), 1);
    assert_eq!(next[0].file_names, ["弹窗后的新片.jpg"]);
    let state = db::snapshot(&conn).unwrap();
    let id = state
        .photos
        .iter()
        .find(|photo| photo.original_name == "首张.jpg")
        .unwrap()
        .id
        .clone();
    let hidden = state.photos.iter().find(|photo| photo.id != id).unwrap();
    let book = books::create(
        &mut conn,
        CreateBookInput {
            title: "相簿之外仍可保留".into(),
            template: "white".into(),
            page_width: 1200,
            page_height: 900,
            chapters: vec![BookChapter {
                id: "chapter".into(),
                title: "首章".into(),
                photo_ids: vec![id.clone()],
            }],
        },
    )
    .unwrap();
    conn.execute_batch(
        "CREATE TEMP TRIGGER reject_album_delete BEFORE DELETE ON groups
           BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
    )
    .unwrap();
    assert!(runtime::delete_album(&mut conn, &state.groups[0].id).is_err());
    let unchanged = db::snapshot(&conn).unwrap();
    assert_eq!(unchanged.photos.len(), 2);
    assert!(unchanged.hidden_photo_ids.is_empty());
    assert_eq!(unchanged.groups[0].bound_folder.as_deref(), Some("收录"));
    conn.execute_batch("DROP TRIGGER reject_album_delete;")
        .unwrap();

    let deleted = runtime::delete_album(&mut conn, &state.groups[0].id).unwrap();
    assert_eq!(deleted.hidden_photo_ids, [hidden.id.clone()]);
    photo(&fixture.works.join("收录/删除后新增.jpg"), 60);
    assert!(fixture.pending(&conn, &root).is_empty());
    assert!(path.is_file());
    assert_eq!(fs::read(unreferenced).unwrap(), unreferenced_bytes);
    assert!(Path::new(&hidden.thumbnail_path).is_file());
    assert_eq!(db::snapshot(&conn).unwrap().photos[0].id, id);
    assert_eq!(
        books::get(&conn, &book.book.id)
            .unwrap()
            .book
            .cover_photo_id
            .as_deref(),
        Some(id.as_str())
    );
    let mut output = Cursor::new(Vec::new());
    book_export::document(
        &conn,
        &book.book.id,
        &book.book.current_version_id,
        &mut output,
    )
    .unwrap();
    assert!(String::from_utf8(output.into_inner())
        .unwrap()
        .contains("data:image/jpeg;base64,"));
}

#[test]
fn offline_missing_and_relink_never_replace_original_content() {
    let fixture = Fixture::new();
    let path = fixture.works.join("活动/首张.webp");
    photo(&path, 10);
    let mut conn = fixture.store.connection.lock().unwrap();
    let root = fixture.binding(&conn);
    let first = fixture.pending(&conn, &root);
    sync_now(&mut conn, &root, &first).unwrap();
    let original_photo = db::snapshot(&conn).unwrap().photos.remove(0);
    let moved = fixture.works.with_file_name("已移动");
    fs::rename(&fixture.works, &moved).unwrap();
    assert!(!scan(Some(&root)).connected);
    assert_eq!(
        db::snapshot(&conn).unwrap().photos[0].availability,
        Some(BoundAvailability::Offline)
    );

    let unrelated = fixture.works.with_file_name("不同内容");
    photo(&unrelated.join("活动/首张.webp"), 20);
    assert!(relink(&conn, &unrelated).unwrap_err().contains("同名原件"));
    assert_eq!(active(&conn).unwrap().unwrap(), root);
    relink(&conn, &moved).unwrap();
    let online = db::snapshot(&conn).unwrap().photos.remove(0);
    assert_eq!(online.id, original_photo.id);
    assert_eq!(online.availability, Some(BoundAvailability::Available));
    unbind(&conn).unwrap();
    assert!(active(&conn).unwrap().is_none());
    assert_eq!(
        db::snapshot(&conn).unwrap().photos[0].availability,
        Some(BoundAvailability::Available)
    );

    fs::remove_file(moved.join("活动/首张.webp")).unwrap();
    assert_eq!(
        db::snapshot(&conn).unwrap().photos[0].availability,
        Some(BoundAvailability::Missing)
    );
    photo(&moved.join("活动/首张.webp"), 20);
    assert_eq!(
        db::snapshot(&conn).unwrap().photos[0].availability,
        Some(BoundAvailability::Missing)
    );
    assert!(original(&conn, &online.id, &online.original_path)
        .unwrap()
        .read()
        .is_err());
}

#[test]
fn failed_sync_preserves_album_membership_and_rolls_back_generated_thumbnails() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("作品/首张.png"), 10);
    let mut conn = fixture.store.connection.lock().unwrap();
    let root = fixture.binding(&conn);
    let first = fixture.pending(&conn, &root);
    sync_now(&mut conn, &root, &first).unwrap();
    let old = db::snapshot(&conn).unwrap();
    photo(&fixture.works.join("作品/a.png"), 20);
    fs::write(fixture.works.join("作品/b.jpg"), b"not an image").unwrap();
    let next = fixture.pending(&conn, &root);
    assert!(sync_now(&mut conn, &root, &next)
        .unwrap_err()
        .contains("b.jpg"));
    assert_eq!(db::snapshot(&conn).unwrap().photos[0].id, old.photos[0].id);
    assert_eq!(
        fs::read_dir(fixture.store.root.join("thumbnails"))
            .unwrap()
            .count(),
        1
    );

    fs::remove_file(fixture.works.join("作品/b.jpg")).unwrap();
    groups::update(
        &mut conn,
        &old.groups[0].id,
        serde_json::json!({"capacity":1}),
    )
    .unwrap();
    let next = fixture.pending(&conn, &root);
    assert!(sync_now(&mut conn, &root, &next)
        .unwrap_err()
        .contains("容量"));
    assert_eq!(db::snapshot(&conn).unwrap().memberships.len(), 1);
}

#[test]
fn commit_failure_cleans_published_thumbnails_and_rolls_back_the_entire_album() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("作品/一.png"), 10);
    photo(&fixture.works.join("作品/二.png"), 20);
    let mut conn = fixture.store.connection.lock().unwrap();
    let root = fixture.binding(&conn);
    let candidates = fixture.pending(&conn, &root);
    // A deferred foreign key fails at COMMIT after thumbnail publication.
    conn.execute_batch(
        "CREATE TABLE injected_commit_failure (
           missing_album TEXT REFERENCES groups(id) DEFERRABLE INITIALLY DEFERRED
         );
         CREATE TRIGGER inject_commit_failure AFTER INSERT ON memberships BEGIN
           INSERT INTO injected_commit_failure VALUES ('missing');
         END;",
    )
    .unwrap();
    assert!(sync_now(&mut conn, &root, &candidates)
        .unwrap_err()
        .contains("FOREIGN KEY"));
    let snapshot = db::snapshot(&conn).unwrap();
    assert!(snapshot.groups.is_empty());
    assert!(snapshot.photos.is_empty());
    assert!(snapshot.memberships.is_empty());
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
    assert_eq!(fixture.pending(&conn, &root), candidates);
}

#[test]
fn startup_cleanup_removes_only_abandoned_work_directory_staging() {
    let fixture = Fixture::new();
    let other_library = fixture
        .store
        .root
        .join("libraries")
        .join(Uuid::new_v4().to_string());
    for root in [&fixture.store.root, &other_library] {
        let stage = root.join("staging/work-directory/interrupted-job");
        fs::create_dir_all(&stage).unwrap();
        fs::write(stage.join("thumbnail.jpg"), b"queue-owned").unwrap();
        let curation = root.join("staging/other-feature");
        fs::create_dir_all(&curation).unwrap();
        fs::write(curation.join("original.jpg"), b"other feature").unwrap();
    }
    staging::clean_abandoned_staging(&fixture.store.root).unwrap();
    assert!(!fixture.store.root.join("staging/work-directory").exists());
    assert!(other_library
        .join("staging/work-directory/interrupted-job/thumbnail.jpg")
        .is_file());
    for root in [&fixture.store.root, &other_library] {
        assert!(root.join("staging/other-feature/original.jpg").is_file());
    }
}

#[test]
fn startup_cleanup_keeps_committed_thumbnail_and_removes_only_uncommitted_publication() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("活动/首张.jpg"), 10);
    let committed = {
        let mut conn = fixture.store.connection.lock().unwrap();
        let root = fixture.binding(&conn);
        let first = fixture.pending(&conn, &root);
        sync_now(&mut conn, &root, &first).unwrap();
        PathBuf::from(db::snapshot(&conn).unwrap().photos.remove(0).thumbnail_path)
    };
    let thumbnails = fixture.store.root.join("thumbnails");
    let abandoned = thumbnails.join(format!("{}.jpg", Uuid::new_v4()));
    let unrelated = thumbnails.join(format!("{}.jpg", Uuid::new_v4()));
    for thumbnail in [&abandoned, &unrelated] {
        fs::write(thumbnail, b"thumbnail").unwrap();
    }
    let stage = staging::root(&fixture.store.root).join(Uuid::new_v4().to_string());
    fs::create_dir_all(&stage).unwrap();
    let mut names = [&committed, &abandoned]
        .map(|path| path.file_name().unwrap().to_str().unwrap().to_string())
        .to_vec();
    names.push("../unrelated.jpg".into());
    staging::record_publication(&stage, &names).unwrap();
    assert!(staging::clean_abandoned_staging(&fixture.store.root).is_err());
    assert!(abandoned.is_file());
    names.pop();
    staging::record_publication(&stage, &names).unwrap();
    staging::clean_abandoned_staging(&fixture.store.root).unwrap();
    assert!(committed.is_file());
    assert!(unrelated.is_file());
    assert!(!abandoned.exists());
    assert!(!stage.exists());
}

#[test]
fn backup_restores_metadata_and_thumbnail_without_authorizing_external_reads() {
    let fixture = Fixture::new();
    let path = fixture.works.join("活动/首张.jpg");
    photo(&path, 10);
    let photo_id = {
        let mut conn = fixture.store.connection.lock().unwrap();
        let root = fixture.binding(&conn);
        let first = fixture.pending(&conn, &root);
        sync_now(&mut conn, &root, &first).unwrap();
        db::snapshot(&conn).unwrap().photos.remove(0).id
    };
    let archive_path = fixture.temp.path().join("works.zip");
    backup::create_with_mode(&fixture.store, &archive_path, backup::BackupMode::Metadata).unwrap();
    let archive = zip::ZipArchive::new(fs::File::open(&archive_path).unwrap()).unwrap();
    assert!(!archive
        .file_names()
        .any(|name| name.starts_with("originals/")));
    assert!(archive
        .file_names()
        .any(|name| name.starts_with("thumbnails/")));
    let target = Store::open(fixture.temp.path().join("target")).unwrap();
    backup::restore(&target, &archive_path).unwrap();
    let conn = target.connection.lock().unwrap();
    let state = db::snapshot(&conn).unwrap();
    let restored_photo = &state.photos[0];
    assert_eq!(restored_photo.id, photo_id);
    assert!(restored_photo.thumbnail_available);
    assert!(!restored_photo.original_available);
    assert!(!active(&conn).unwrap().unwrap().authorized);
    assert!(original(&conn, &photo_id, &restored_photo.original_path)
        .unwrap()
        .read()
        .is_err());
    relink(&conn, &fixture.works).unwrap();
    assert_eq!(
        original(&conn, &photo_id, &restored_photo.original_path)
            .unwrap()
            .read()
            .unwrap(),
        fs::read(&path).unwrap()
    );
}

#[test]
fn full_backup_restores_managed_copies_for_all_sources_and_keeps_live_binding() {
    let fixture = Fixture::new();
    let work = fixture.works.join("活动/首张.png");
    let local = fixture.temp.path().join("首张.png");
    photo(&work, 10);
    photo(&local, 20);
    let inputs = vec![local.to_str().unwrap().into()];
    let managed_id = crate::photos::import(&fixture.store, inputs.clone(), "collection", None)
        .unwrap()
        .imported_ids
        .remove(0);
    let local_id = crate::photos::import_local(&fixture.store, inputs, "collection", None)
        .unwrap()
        .0
        .imported_ids
        .remove(0);
    let (work_id, album_id) = {
        let mut conn = fixture.store.connection.lock().unwrap();
        let root = fixture.binding(&conn);
        let candidates = fixture.pending(&conn, &root);
        sync_now(&mut conn, &root, &candidates).unwrap();
        conn.execute(
            "INSERT INTO work_directory_ignored_files(root_id,folder,file_name)
             VALUES(?1,'活动','忽略.png')",
            [&root.id],
        )
        .unwrap();
        let state = db::snapshot(&conn).unwrap();
        let work = state
            .photos
            .iter()
            .find(|photo| photo.library == "work")
            .unwrap();
        (work.id.clone(), state.groups[0].id.clone())
    };
    let archive_path = fixture.temp.path().join("full.zip");
    assert_eq!(
        backup::create_with_mode(&fixture.store, &archive_path, backup::BackupMode::Full)
            .unwrap()
            .photo_count,
        3
    );
    let archive = zip::ZipArchive::new(fs::File::open(&archive_path).unwrap()).unwrap();
    let names = archive.file_names().collect::<Vec<_>>();
    assert_eq!(
        names
            .iter()
            .filter(|name| name.starts_with("originals/"))
            .count(),
        3
    );
    assert!(names.contains(&format!("originals/{local_id}.png").as_str()));
    assert!(names.contains(&format!("originals/{work_id}.png").as_str()));
    let work_bytes = fs::read(&work).unwrap();
    let local_bytes = fs::read(&local).unwrap();
    {
        let conn = fixture.store.connection.lock().unwrap();
        assert!(active(&conn).unwrap().unwrap().authorized);
        let live = db::snapshot(&conn).unwrap();
        assert_eq!(live.groups[0].bound_folder.as_deref(), Some("活动"));
        assert!(live
            .photos
            .iter()
            .any(|p| p.id == work_id && is_locator(&p.original_path)));
        assert!(live
            .photos
            .iter()
            .any(|p| p.id == local_id && crate::local_photo::is_locator(&p.original_path)));
        assert_eq!(
            fs::read_dir(fixture.store.root.join("originals"))
                .unwrap()
                .count(),
            1
        );
    }
    fs::remove_file(&local).unwrap();
    fs::remove_dir_all(&fixture.works).unwrap();

    let target = Store::open(fixture.temp.path().join("target")).unwrap();
    let restored = backup::restore(&target, &archive_path).unwrap();
    assert_eq!(restored.photo_count, 3);
    assert_eq!(restored.unresolved_work_photo_count, 0);
    assert_eq!(restored.snapshot.groups[0].id, album_id);
    assert_eq!(restored.snapshot.groups[0].bound_folder, None);
    assert_eq!(restored.snapshot.memberships[0].photo_id, work_id);
    assert!(active(&target.connection.lock().unwrap())
        .unwrap()
        .is_none());
    for (id, bytes) in [
        (&work_id, &work_bytes),
        (&local_id, &local_bytes),
        (&managed_id, &local_bytes),
    ] {
        let photo = restored
            .snapshot
            .photos
            .iter()
            .find(|photo| &photo.id == id)
            .unwrap();
        assert!(photo.original_available && photo.thumbnail_available);
        assert!(Path::new(&photo.original_path).starts_with(target.root.join("originals")));
        assert_eq!(&fs::read(&photo.original_path).unwrap(), bytes);
    }
}

#[test]
fn full_backup_failure_for_offline_work_source_preserves_destination_and_cleans_temps() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("活动/离线.png"), 10);
    {
        let mut conn = fixture.store.connection.lock().unwrap();
        let root = fixture.binding(&conn);
        let candidates = fixture.pending(&conn, &root);
        sync_now(&mut conn, &root, &candidates).unwrap();
    }
    fs::remove_dir_all(&fixture.works).unwrap();
    let destination = fixture.temp.path().join("existing.zip");
    fs::write(&destination, b"previous backup").unwrap();
    let result = backup::create_with_mode(&fixture.store, &destination, backup::BackupMode::Full);
    assert!(
        matches!(result, Err(error) if error.contains("离线") && error.contains("作品目录当前不可用"))
    );
    assert_eq!(fs::read(&destination).unwrap(), b"previous backup");
    for (directory, prefix) in [
        (fixture.store.root.as_path(), ".backup-"),
        (fixture.temp.path(), ".foliune-backup-"),
    ] {
        assert!(fs::read_dir(directory).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(prefix)));
    }
    backup::create_with_mode(&fixture.store, &destination, backup::BackupMode::Metadata).unwrap();
    let target = Store::open(fixture.temp.path().join("target")).unwrap();
    let restored = backup::restore(&target, &destination).unwrap();
    assert!(restored.snapshot.photos[0].thumbnail_available);
    assert_eq!(
        restored.snapshot.photos[0].availability,
        Some(BoundAvailability::Offline)
    );
}

#[test]
fn archive_does_not_include_confirmations_and_restore_discards_any_legacy_queue() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("活动/首张.jpg"), 10);
    let mut jobs = queue::Queue::default();
    {
        let mut conn = fixture.store.connection.lock().unwrap();
        let root = fixture.binding(&conn);
        let candidates = fixture.pending(&conn, &root);
        jobs.enqueue(&mut conn, &root, candidates, None).unwrap();
    }
    let archive_path = fixture.temp.path().join("pending.zip");
    backup::create(&fixture.store, &archive_path).unwrap();
    let mut archive = zip::ZipArchive::new(fs::File::open(&archive_path).unwrap()).unwrap();
    let database_path = fixture.temp.path().join("archived.sqlite");
    std::io::copy(
        &mut archive.by_name("library.sqlite").unwrap(),
        &mut fs::File::create(&database_path).unwrap(),
    )
    .unwrap();
    let archive_database = Connection::open(database_path).unwrap();
    assert!(!archive_database
        .prepare("SELECT 1 FROM sqlite_schema WHERE name='work_directory_jobs'")
        .unwrap()
        .exists([])
        .unwrap());
    let target = Store::open(fixture.temp.path().join("target")).unwrap();
    backup::restore(&target, &archive_path).unwrap();
    let conn = target.connection.lock().unwrap();
    let root = active(&conn).unwrap().unwrap();
    assert!(!root.authorized);
    assert!(queue::Queue::load(&conn, &root)
        .unwrap()
        .states()
        .is_empty());
    relink(&conn, &fixture.works).unwrap();
    let root = active(&conn).unwrap().unwrap();
    assert_eq!(fixture.pending(&conn, &root).len(), 1);
    let legacy_path = fixture.temp.path().join("legacy.sqlite");
    let live = fixture.store.connection.lock().unwrap();
    let root = active(&live).unwrap().unwrap();
    assert_eq!(
        queue::Queue::load(&live, &root).unwrap().states(),
        jobs.states()
    );
    live.backup("main", &legacy_path, None).unwrap();
    let legacy = Connection::open(legacy_path).unwrap();
    prepare_restore(&legacy).unwrap();
    let root = active(&legacy).unwrap().unwrap();
    assert!(!root.authorized);
    assert!(queue::Queue::load(&legacy, &root)
        .unwrap()
        .states()
        .is_empty());
}

#[cfg(unix)]
#[test]
fn symlinks_are_neither_discovered_nor_followed_after_confirmed_file_replacement() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let original_path = fixture.works.join("活动/首张.jpg");
    photo(&original_path, 10);
    let outside = fixture.works.with_file_name("外部");
    photo(&outside.join("首张.jpg"), 10);
    symlink(&outside, fixture.works.join("外部相簿")).unwrap();
    symlink(
        outside.join("首张.jpg"),
        fixture.works.join("活动/外部照片.jpg"),
    )
    .unwrap();
    let mut conn = fixture.store.connection.lock().unwrap();
    let root = fixture.binding(&conn);
    let first = fixture.pending(&conn, &root);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].file_names, ["首张.jpg"]);
    sync_now(&mut conn, &root, &first).unwrap();
    fs::remove_file(&original_path).unwrap();
    symlink(outside.join("首张.jpg"), &original_path).unwrap();
    let indexed = db::snapshot(&conn).unwrap().photos.remove(0);
    assert_eq!(indexed.availability, Some(BoundAvailability::Missing));
    assert!(original(&conn, &indexed.id, &indexed.original_path)
        .unwrap()
        .read()
        .is_err());
}

#[test]
fn backup_with_a_trigger_cannot_reauthorize_external_root() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("活动/首张.jpg"), 10);
    {
        let mut conn = fixture.store.connection.lock().unwrap();
        let root = fixture.binding(&conn);
        let first = fixture.pending(&conn, &root);
        sync_now(&mut conn, &root, &first).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER reauthorize AFTER UPDATE OF authorized ON work_directory_roots
             WHEN NEW.authorized=0 BEGIN
             UPDATE work_directory_roots SET authorized=1 WHERE id=NEW.id;
             END;",
        )
        .unwrap();
    }
    let archive = fixture.temp.path().join("trigger.zip");
    backup::create(&fixture.store, &archive).unwrap();
    assert!(
        matches!(backup::restore(&fixture.store, &archive), Err(message) if message.contains("触发器"))
    );
    assert!(
        active(&fixture.store.connection.lock().unwrap())
            .unwrap()
            .unwrap()
            .authorized
    );
}

#[test]
fn backup_restore_keeps_existing_work_index_when_another_library_indexed_the_same_file() {
    let fixture = Fixture::new();
    let original_path = fixture.works.join("活动/首张.jpg");
    photo(&original_path, 10);
    let import = |store: &Store| {
        let mut conn = store.connection.lock().unwrap();
        let root = fixture.binding(&conn);
        let pending = fixture.pending(&conn, &root);
        sync_now(&mut conn, &root, &pending).unwrap();
        db::snapshot(&conn).unwrap().photos.remove(0).id
    };
    let incoming = import(&fixture.store);
    fixture
        .store
        .connection
        .lock()
        .unwrap()
        .execute_batch(
            "INSERT INTO work_directory_ignored_files(root_id,folder,file_name)
         SELECT root_id,folder,'归档中忽略.jpg' FROM work_directory_folders;",
        )
        .unwrap();
    let target = Store::open(fixture.temp.path().join("target")).unwrap();
    let current = import(&target);
    assert_ne!(incoming, current);

    let archive = fixture.temp.path().join("same-source.zip");
    backup::create(&fixture.store, &archive).unwrap();
    let restored = backup::restore(&target, &archive).unwrap();
    assert_eq!(restored.photo_count, 1);
    assert_eq!(restored.unresolved_work_photo_count, 1);
    let archived = restored
        .snapshot
        .photos
        .iter()
        .find(|p| p.id == incoming)
        .unwrap();
    assert_eq!(archived.original_path, crate::local_photo::PREFIX);
    assert!(!archived.original_available && archived.thumbnail_available);
    let retained = restored
        .snapshot
        .photos
        .iter()
        .find(|p| p.id == current)
        .unwrap();
    assert!(retained.original_available);
    assert_eq!(restored.snapshot.memberships.len(), 2);
    let repeated = backup::restore(&target, &archive).unwrap();
    assert_eq!(repeated.photo_count, 0);
    assert_eq!(repeated.unresolved_work_photo_count, 0);
    let conn = target.connection.lock().unwrap();
    assert!(active(&conn).unwrap().unwrap().authorized);
    assert!(!conn
        .prepare("SELECT 1 FROM work_directory_ignored_files")
        .unwrap()
        .exists([])
        .unwrap());
    assert_eq!(
        original(&conn, &current, &retained.original_path)
            .unwrap()
            .read()
            .unwrap(),
        fs::read(original_path).unwrap()
    );
}

#[test]
fn backup_restore_does_not_reuse_a_relinked_root_for_the_old_archive_path() {
    let fixture = Fixture::new();
    let first = "活动/首张.jpg";
    let second = "活动/第二张.jpg";
    photo(&fixture.works.join(first), 10);
    let first_id = {
        let mut conn = fixture.store.connection.lock().unwrap();
        let root = fixture.binding(&conn);
        let pending = fixture.pending(&conn, &root);
        sync_now(&mut conn, &root, &pending).unwrap();
        db::snapshot(&conn).unwrap().photos.remove(0).id
    };
    let initial = fixture.temp.path().join("initial.zip");
    backup::create(&fixture.store, &initial).unwrap();
    let target = Store::open(fixture.temp.path().join("target")).unwrap();
    backup::restore(&target, &initial).unwrap();
    let relocated = fixture.works.with_file_name("重新定位");
    photo(&relocated.join(first), 10);
    photo(&relocated.join(second), 11);
    relink(&target.connection.lock().unwrap(), &relocated).unwrap();

    photo(&fixture.works.join(second), 11);
    let second_id = {
        let mut conn = fixture.store.connection.lock().unwrap();
        let root = active(&conn).unwrap().unwrap();
        let pending = fixture.pending(&conn, &root);
        sync_now(&mut conn, &root, &pending).unwrap();
        db::snapshot(&conn)
            .unwrap()
            .photos
            .into_iter()
            .find(|p| p.id != first_id)
            .unwrap()
            .id
    };
    let archive = fixture.temp.path().join("old-root.zip");
    backup::create(&fixture.store, &archive).unwrap();
    let restored = backup::restore(&target, &archive).unwrap();
    assert_eq!(restored.photo_count, 1);
    assert_eq!(restored.unresolved_work_photo_count, 1);
    let original = restored
        .snapshot
        .photos
        .iter()
        .find(|p| p.id == first_id)
        .unwrap();
    assert!(original.original_available);
    let incoming = restored
        .snapshot
        .photos
        .iter()
        .find(|p| p.id == second_id)
        .unwrap();
    assert!(!incoming.original_available && incoming.thumbnail_available);
    let conn = target.connection.lock().unwrap();
    let root = active(&conn).unwrap().unwrap();
    assert_eq!(root.path, relocated);
    assert!(root.authorized);
}

#[test]
fn backup_restore_preserves_a_confirmed_work_directory_job() {
    let fixture = Fixture::new();
    photo(&fixture.works.join("活动/首张.jpg"), 10);
    let incoming = {
        let mut conn = fixture.store.connection.lock().unwrap();
        let root = fixture.binding(&conn);
        let pending = fixture.pending(&conn, &root);
        sync_now(&mut conn, &root, &pending).unwrap();
        db::snapshot(&conn).unwrap().photos.remove(0).id
    };
    let archive = fixture.temp.path().join("pending-folder.zip");
    backup::create(&fixture.store, &archive).unwrap();
    let target = Store::open(fixture.temp.path().join("target")).unwrap();
    let (root, job) = {
        let mut conn = target.connection.lock().unwrap();
        let root = fixture.binding(&conn);
        let pending = fixture.pending(&conn, &root);
        let mut jobs = queue::Queue::default();
        jobs.enqueue(&mut conn, &root, pending, None).unwrap();
        (root, jobs.take_next().unwrap())
    };

    let restored = backup::restore(&target, &archive).unwrap();
    assert_eq!(restored.unresolved_work_photo_count, 1);
    let photo = &restored.snapshot.photos[0];
    assert_eq!(photo.id, incoming);
    assert!(!photo.original_available && photo.thumbnail_available);

    let mut conn = target.connection.lock().unwrap();
    let library = db::library_root(&conn).unwrap();
    sync::validate_job(&conn, &root, &job.candidate).unwrap();
    let mut prepared = sync::prepare(&root, &job.candidate, &library, None, |_| Ok(())).unwrap();
    let result = sync::commit(
        &mut conn,
        &root,
        &job.candidate,
        &job.state.album_id,
        &job.state.id,
        "default",
        &mut prepared,
    )
    .unwrap();
    assert_eq!(result.album.id, job.state.album_id);
    assert!(result.photos[0].original_available);
    assert!(queue::Queue::load(&conn, &root)
        .unwrap()
        .states()
        .is_empty());
}
