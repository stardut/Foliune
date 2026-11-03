use crate::{
    db::{snapshot, Store},
    groups,
    models::GroupInput,
    photos,
};
use image::{Rgb, RgbImage};
use serde_json::json;

fn store() -> (tempfile::TempDir, Store) {
    let root = tempfile::tempdir().unwrap();
    let store = Store::open(root.path().join("managed")).unwrap();
    (root, store)
}

fn group(store: &Store, name: &str, capacity: Option<u32>) -> String {
    let conn = store.connection.lock().unwrap();
    groups::create(
        &conn,
        GroupInput {
            library: "collection".into(),
            name: name.into(),
            description: String::new(),
            capacity,
        },
    )
    .unwrap()
    .groups
    .into_iter()
    .find(|group| group.name == name)
    .unwrap()
    .id
}

fn fixture(root: &tempfile::TempDir, name: &str) -> String {
    let path = root.path().join(name);
    RgbImage::from_pixel(1500, 1000, Rgb([32, 80, 120]))
        .save(&path)
        .unwrap();
    path.to_str().unwrap().to_string()
}

#[test]
fn import_preserves_original_and_persists_metadata() {
    let (root, store) = store();
    let path = fixture(&root, "coast.jpg");
    let original = std::fs::read(&path).unwrap();
    let result = photos::import(&store, vec![path.clone()], "collection", None).unwrap();
    assert_eq!(result.imported_ids.len(), 1);
    assert!(result.failures.is_empty());
    let photo = &result.snapshot.photos[0];
    assert_eq!((photo.width, photo.height), (1500, 1000));
    assert_eq!(std::fs::read(&photo.original_path).unwrap(), original);
    assert_eq!(std::fs::read(path).unwrap(), original);
    let thumbnail = image::open(&photo.thumbnail_path).unwrap();
    assert!(thumbnail.width() <= 960 && thumbnail.height() <= 960);
    let id = photo.id.clone();
    photos::update(&mut store.connection.lock().unwrap(), &id, json!({"title":"海岸", "tags":["海", "海", "旅途"], "capturedAt":"2026-10-29", "source":"我的相机", "location":"青岛", "project":"沿岸", "annotation":"风大"})).unwrap();
    drop(store);
    let reopened = Store::open(root.path().join("managed")).unwrap();
    let snapshot = snapshot(&reopened.connection.lock().unwrap()).unwrap();
    assert_eq!(snapshot.photos[0].id, id);
    assert_eq!(snapshot.photos[0].title, "海岸");
    assert_eq!(snapshot.photos[0].tags, ["海", "旅途"]);
    assert_eq!(
        snapshot.photos[0].captured_at.as_deref(),
        Some("2026-10-29")
    );
}

#[test]
fn corrupt_photo_leaves_no_database_or_managed_files() {
    let (root, store) = store();
    let source = root.path().join("broken.jpg");
    std::fs::write(&source, b"not a photo").unwrap();
    let result = photos::import(
        &store,
        vec![source.to_str().unwrap().into()],
        "collection",
        None,
    )
    .unwrap();
    assert_eq!(result.failures.len(), 1);
    assert!(result.snapshot.photos.is_empty());
    assert_eq!(
        std::fs::read_dir(store.root.join("originals"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        std::fs::read_dir(store.root.join("thumbnails"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(std::fs::read(&source).unwrap(), b"not a photo");
}

#[test]
fn discard_is_local_and_restore_enforces_capacity_atomically() {
    let (root, store) = store();
    let first_group = group(&store, "旅行", Some(1));
    let second_group = group(&store, "海", None);
    let first = photos::import(
        &store,
        vec![fixture(&root, "a.png")],
        "collection",
        Some(&first_group),
    )
    .unwrap()
    .imported_ids[0]
        .clone();
    groups::add(
        &mut store.connection.lock().unwrap(),
        &second_group,
        &[first.clone()],
    )
    .unwrap();
    groups::set_status(
        &mut store.connection.lock().unwrap(),
        &first_group,
        &first,
        "discarded",
    )
    .unwrap();
    let second = photos::import(
        &store,
        vec![fixture(&root, "b.webp")],
        "collection",
        Some(&first_group),
    )
    .unwrap()
    .imported_ids[0]
        .clone();
    assert!(groups::set_status(
        &mut store.connection.lock().unwrap(),
        &first_group,
        &first,
        "active"
    )
    .is_err());
    let snapshot = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert_eq!(snapshot.photos.len(), 2);
    assert!(snapshot
        .photos
        .iter()
        .all(|photo| std::path::Path::new(&photo.original_path).exists()));
    assert_eq!(
        snapshot
            .memberships
            .iter()
            .find(|m| m.group_id == first_group && m.photo_id == first)
            .unwrap()
            .status,
        "discarded"
    );
    assert_eq!(
        snapshot
            .memberships
            .iter()
            .find(|m| m.group_id == second_group && m.photo_id == first)
            .unwrap()
            .status,
        "active"
    );
    assert_eq!(
        snapshot
            .memberships
            .iter()
            .find(|m| m.photo_id == second)
            .unwrap()
            .status,
        "active"
    );
    let third = fixture(&root, "c.png");
    assert!(photos::import(&store, vec![third], "collection", Some(&first_group)).is_err());
    assert_eq!(
        std::fs::read_dir(store.root.join("originals"))
            .unwrap()
            .count(),
        2
    );
    groups::delete(&store.connection.lock().unwrap(), &first_group).unwrap();
    let after_delete = crate::db::snapshot(&store.connection.lock().unwrap()).unwrap();
    assert_eq!(after_delete.photos.len(), 2);
    assert!(after_delete
        .memberships
        .iter()
        .all(|member| member.group_id != first_group));
    assert_eq!(after_delete.memberships.len(), 1);
}

#[test]
fn metadata_patch_rolls_back_on_invalid_field() {
    let (root, store) = store();
    let id = photos::import(&store, vec![fixture(&root, "a.png")], "work", None)
        .unwrap()
        .imported_ids[0]
        .clone();
    assert!(photos::update(
        &mut store.connection.lock().unwrap(),
        &id,
        json!({"annotation":"must rollback", "wrong":"field"})
    )
    .is_err());
    let result = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert_eq!(result.photos[0].annotation, "");
    let target = group(&store, "收藏分组", None);
    assert!(groups::add(&mut store.connection.lock().unwrap(), &target, &[id]).is_err());
    assert!(snapshot(&store.connection.lock().unwrap())
        .unwrap()
        .memberships
        .is_empty());
}

#[test]
fn exif_date_and_orientation_are_used_without_changing_original() {
    let (root, store) = store();
    let path = fixture(&root, "rotated.jpg");
    // Minimal little-endian TIFF: Orientation=6, ExifIFD -> DateTimeOriginal.
    let mut tiff = b"II\x2a\0\x08\0\0\0\x02\0".to_vec();
    tiff.extend_from_slice(&[0x12, 0x01, 0x03, 0, 1, 0, 0, 0, 6, 0, 0, 0]);
    tiff.extend_from_slice(&[0x69, 0x87, 0x04, 0, 1, 0, 0, 0, 38, 0, 0, 0]);
    tiff.extend_from_slice(&[0, 0, 0, 0, 1, 0]);
    tiff.extend_from_slice(&[0x03, 0x90, 0x02, 0, 20, 0, 0, 0, 56, 0, 0, 0]);
    tiff.extend_from_slice(&[0, 0, 0, 0]);
    tiff.extend_from_slice(b"2020:07:16 08:30:00\0");
    let mut segment = b"Exif\0\0".to_vec();
    segment.extend_from_slice(&tiff);
    let jpeg = std::fs::read(&path).unwrap();
    let mut original = jpeg[..2].to_vec();
    original.extend_from_slice(&[0xff, 0xe1]);
    original.extend_from_slice(&((segment.len() + 2) as u16).to_be_bytes());
    original.extend_from_slice(&segment);
    original.extend_from_slice(&jpeg[2..]);
    std::fs::write(&path, &original).unwrap();
    let result = photos::import(&store, vec![path.clone()], "work", None).unwrap();
    assert!(
        result.failures.is_empty(),
        "{:?}",
        result
            .failures
            .iter()
            .map(|failure| &failure.message)
            .collect::<Vec<_>>()
    );
    let photo = &result.snapshot.photos[0];
    assert_eq!((photo.width, photo.height), (1000, 1500));
    assert_eq!(photo.captured_at.as_deref(), Some("2020-07-16T08:30:00"));
    assert_eq!(std::fs::read(&photo.original_path).unwrap(), original);
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

#[test]
fn batch_restore_is_all_or_nothing_when_only_one_slot_is_free() {
    let (root, store) = store();
    let group_id = group(&store, "限额", Some(2));
    let imported = photos::import(
        &store,
        vec![fixture(&root, "a.png"), fixture(&root, "b.png")],
        "collection",
        Some(&group_id),
    )
    .unwrap();
    let ids = imported.imported_ids;
    groups::set_statuses(
        &mut store.connection.lock().unwrap(),
        &group_id,
        &ids,
        "discarded",
    )
    .unwrap();
    groups::update(
        &mut store.connection.lock().unwrap(),
        &group_id,
        json!({"capacity":1}),
    )
    .unwrap();
    assert!(groups::set_statuses(
        &mut store.connection.lock().unwrap(),
        &group_id,
        &ids,
        "active"
    )
    .is_err());
    let snapshot = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert_eq!(snapshot.memberships.len(), 2);
    assert!(snapshot
        .memberships
        .iter()
        .all(|member| member.status == "discarded"));
}

#[test]
fn relink_repairs_missing_file_and_keeps_identity_metadata_and_memberships() {
    let (root, store) = store();
    let group_id = group(&store, "相册候选", None);
    let imported = photos::import(
        &store,
        vec![fixture(&root, "old.png")],
        "collection",
        Some(&group_id),
    )
    .unwrap();
    let old_photo = &imported.snapshot.photos[0];
    let id = old_photo.id.clone();
    photos::update(
        &mut store.connection.lock().unwrap(),
        &id,
        json!({"title":"保留标题","tags":["保留标签"]}),
    )
    .unwrap();
    std::fs::remove_file(&old_photo.original_path).unwrap();
    std::fs::remove_file(&old_photo.thumbnail_path).unwrap();
    let missing = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert!(!missing.photos[0].original_available);
    assert!(!missing.photos[0].thumbnail_available);
    let replacement = root.path().join("replacement.webp");
    RgbImage::from_pixel(300, 200, Rgb([12, 24, 48]))
        .save(&replacement)
        .unwrap();
    let bytes = std::fs::read(&replacement).unwrap();
    let repaired = photos::relink(&store, &id, &replacement).unwrap();
    let photo = &repaired.photos[0];
    assert_eq!(photo.id, id);
    assert_eq!(photo.title, "保留标题");
    assert_eq!(photo.tags, ["保留标签"]);
    assert_eq!((photo.width, photo.height), (300, 200));
    assert!(photo.original_available && photo.thumbnail_available);
    assert_eq!(std::fs::read(&photo.original_path).unwrap(), bytes);
    assert_eq!(repaired.memberships.len(), 1);
    assert_eq!(repaired.memberships[0].photo_id, id);
    assert_ne!(photo.thumbnail_path, old_photo.thumbnail_path);
    let bad = root.path().join("bad.jpg");
    std::fs::write(&bad, b"broken").unwrap();
    assert!(photos::relink(&store, &id, &bad).is_err());
    let unchanged = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert_eq!(unchanged.photos[0].original_path, photo.original_path);
}

#[test]
fn transparent_png_thumbnail_uses_white_background() {
    let (root, store) = store();
    let source = root.path().join("transparent.png");
    image::RgbaImage::from_pixel(16, 16, image::Rgba([10, 20, 30, 0]))
        .save(&source)
        .unwrap();
    let result = photos::import(
        &store,
        vec![source.to_string_lossy().into()],
        "collection",
        None,
    )
    .unwrap();
    let thumb = image::open(&result.snapshot.photos[0].thumbnail_path)
        .unwrap()
        .to_rgb8();
    assert!(thumb
        .pixels()
        .all(|pixel| pixel.0.iter().all(|value| *value > 250)));
}

#[test]
fn all_eight_exif_orientations_map_thumbnail_corners_correctly() {
    let (root, store) = store();
    let colors = [
        [220u8, 20, 20],
        [20, 220, 20],
        [20, 20, 220],
        [220, 220, 20],
    ];
    let expected = [
        [0, 1, 2, 3],
        [1, 0, 3, 2],
        [3, 2, 1, 0],
        [2, 3, 0, 1],
        [0, 2, 1, 3],
        [2, 0, 3, 1],
        [3, 1, 2, 0],
        [1, 3, 0, 2],
    ];
    for orientation in 1u8..=8 {
        let path = root.path().join(format!("orientation-{orientation}.jpg"));
        RgbImage::from_fn(80, 60, |x, y| {
            Rgb(colors[((y >= 30) as usize) * 2 + (x >= 40) as usize])
        })
        .save(&path)
        .unwrap();
        let jpeg = std::fs::read(&path).unwrap();
        let mut tiff = b"II\x2a\0\x08\0\0\0\x01\0".to_vec();
        tiff.extend_from_slice(&[0x12, 1, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]);
        let mut segment = b"Exif\0\0".to_vec();
        segment.extend_from_slice(&tiff);
        let mut bytes = jpeg[..2].to_vec();
        bytes.extend_from_slice(&[0xff, 0xe1]);
        bytes.extend_from_slice(&((segment.len() + 2) as u16).to_be_bytes());
        bytes.extend_from_slice(&segment);
        bytes.extend_from_slice(&jpeg[2..]);
        std::fs::write(&path, &bytes).unwrap();
        let result =
            photos::import(&store, vec![path.to_string_lossy().into()], "work", None).unwrap();
        assert!(result.failures.is_empty());
        let photo = result
            .snapshot
            .photos
            .iter()
            .find(|photo| photo.id == result.imported_ids[0])
            .unwrap();
        let thumb = image::open(&photo.thumbnail_path).unwrap().to_rgb8();
        let (w, h) = thumb.dimensions();
        let dimensions = if orientation <= 4 { (80, 60) } else { (60, 80) };
        assert_eq!(
            (w, h),
            dimensions,
            "EXIF orientation {orientation} thumbnail dimensions"
        );
        assert_eq!(
            (photo.width, photo.height),
            dimensions,
            "EXIF orientation {orientation} stored dimensions"
        );
        assert_eq!(
            std::fs::read(&photo.original_path).unwrap(),
            bytes,
            "EXIF orientation {orientation} original bytes"
        );
        let positions = [
            (w / 4, h / 4),
            (w * 3 / 4, h / 4),
            (w / 4, h * 3 / 4),
            (w * 3 / 4, h * 3 / 4),
        ];
        let actual: Vec<_> = positions
            .iter()
            .map(|(x, y)| {
                let pixel = thumb.get_pixel(*x, *y);
                colors
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, color)| {
                        color
                            .iter()
                            .zip(pixel.0)
                            .map(|(a, b)| (*a as i32 - b as i32).pow(2))
                            .sum::<i32>()
                    })
                    .unwrap()
                    .0
            })
            .collect();
        assert_eq!(
            actual,
            expected[(orientation - 1) as usize],
            "EXIF orientation {orientation}"
        );
    }
}
