use super::*;
use crate::{backup, groups, models::GroupInput};
use image::{Rgb, RgbImage};
use serde_json::json;

fn fixture() -> (tempfile::TempDir, Store, String) {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open_direct(temp.path().join("library")).unwrap();
    let group_id = groups::create(
        &store.connection.lock().unwrap(),
        GroupInput {
            library: "collection".into(),
            name: "海岸".into(),
            description: String::new(),
            capacity: None,
        },
    )
    .unwrap()
    .groups[0]
        .id
        .clone();
    (temp, store, group_id)
}

fn import(store: &Store, group_id: &str, paths: &[&Path]) -> Vec<Request> {
    let (imported, _) = photos::import_local(
        store,
        paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        "collection",
        Some(group_id),
    )
    .unwrap();
    assert!(imported.failures.is_empty());
    imported
        .imported_ids
        .into_iter()
        .map(|id| {
            let photo = imported
                .snapshot
                .photos
                .iter()
                .find(|photo| photo.id == id)
                .unwrap();
            Request {
                group_id: group_id.to_owned(),
                photo_id: id,
                original_path: photo.original_path.clone(),
                thumbnail_path: Some(photo.thumbnail_path.clone()),
                cover: None,
            }
        })
        .collect()
}

fn save_crop(store: &Store, request: &mut Request, offset_x: f64) {
    let cover = AlbumCover {
        photo_id: request.photo_id.clone(),
        offset_x,
        offset_y: 0.5,
        zoom: 1.5,
    };
    let updated = groups::update(
        &mut store.connection.lock().unwrap(),
        &request.group_id,
        json!({"cover": cover}),
    )
    .unwrap();
    request.cover = updated.groups[0].cover.clone();
}

fn decode(bytes: &[u8]) -> RgbImage {
    image::load_from_memory_with_format(bytes, image::ImageFormat::Jpeg)
        .unwrap()
        .into_rgb8()
}

#[test]
fn resolves_default_and_saved_crops_and_rejects_stale_publication() {
    let (temp, store, group_id) = fixture();
    let path = temp.path().join("wide.jpg");
    RgbImage::from_fn(2400, 1200, |x, _| {
        Rgb(if x < 1200 {
            [240, 10, 20]
        } else {
            [20, 10, 240]
        })
    })
    .save(&path)
    .unwrap();
    let original_bytes = fs::read(&path).unwrap();
    let second = temp.path().join("small.jpg");
    RgbImage::from_pixel(81, 60, Rgb([50, 220, 50]))
        .save(&second)
        .unwrap();
    let mut sources = import(&store, &group_id, &[&path, &second]);
    let first = &mut sources[0];
    assert!(!store.root.join(CACHE_DIRECTORY).exists());
    assert_eq!(decode(&read(&store, first).unwrap()).dimensions(), TARGET);
    save_crop(&store, first, 0.0);
    let left = decode(&read(&store, first).unwrap());
    assert_eq!(left.dimensions(), TARGET);
    assert!(left.get_pixel(600, 400)[0] > 225);
    let previous = first.cover.clone();
    let previous_source = Source::resolve(&store.connection.lock().unwrap(), first).unwrap();
    save_crop(&store, first, 1.0);
    let right = decode(&read(&store, first).unwrap());
    assert!(right.get_pixel(600, 400)[2] > 225);
    assert!(ensure_current(&store, first, &previous_source).is_err());
    first.cover = previous;
    assert!(read(&store, first).is_err());
    assert_eq!(
        fs::read_dir(store.root.join(CACHE_DIRECTORY))
            .unwrap()
            .count(),
        1
    );
    assert_eq!(fs::read(path).unwrap(), original_bytes);
    assert!(read(&store, &sources[1]).is_err());
    groups::set_status(
        &mut store.connection.lock().unwrap(),
        &group_id,
        &sources[0].photo_id,
        "discarded",
    )
    .unwrap();
    let fallback = decode(&read(&store, &sources[1]).unwrap());
    assert_eq!(fallback.dimensions(), (81, 54));
    assert!(fallback.get_pixel(40, 27)[1] > 200);
    let path = cache_path(&store.root, &group_id);
    assert!(path.is_file());
    work_directory::runtime::delete_album(&mut store.connection.lock().unwrap(), &group_id)
        .unwrap();
    assert!(!path.exists());
    assert!(read(&store, &sources[1]).is_err());
}

#[test]
fn revises_local_cover_on_source_change_and_preserves_it_offline() {
    let (temp, store, group_id) = fixture();
    let path = temp.path().join("local.jpg");
    RgbImage::from_pixel(90, 60, Rgb([240, 10, 20]))
        .save(&path)
        .unwrap();
    let mut request = import(&store, &group_id, &[&path]).remove(0);
    let first = read(&store, &request).unwrap();
    let replacement = temp.path().join("replacement.jpg");
    RgbImage::from_pixel(90, 60, Rgb([20, 10, 240]))
        .save(&replacement)
        .unwrap();
    fs::rename(replacement, &path).unwrap();
    let changed = read(&store, &request).unwrap();
    assert_ne!(changed, first);
    assert!(decode(&changed).get_pixel(45, 30)[2] > 225);
    let backup_path = temp.path().join("backup.zip");
    backup::create(&store, &backup_path).unwrap();
    let archive = zip::ZipArchive::new(File::open(backup_path).unwrap()).unwrap();
    assert!(archive
        .file_names()
        .all(|name| !name.contains(CACHE_DIRECTORY)));
    fs::remove_file(path).unwrap();
    assert_eq!(read(&store, &request).unwrap(), changed);
    request.thumbnail_path = Some("旧来源".into());
    assert!(read(&store, &request).is_err());
}

#[test]
fn rotates_the_original_before_cropping() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("rotate.jpg");
    RgbImage::from_fn(90, 60, |x, _| {
        Rgb(if x < 45 { [240, 10, 20] } else { [20, 10, 240] })
    })
    .save(&path)
    .unwrap();
    let jpeg = fs::read(&path).unwrap();
    let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
    let mut oriented = jpeg[..2].to_vec();
    oriented.extend_from_slice(&[0xff, 0xe1]);
    oriented.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
    oriented.extend_from_slice(exif);
    oriented.extend_from_slice(&jpeg[2..]);
    fs::write(&path, oriented).unwrap();
    let cover = AlbumCover {
        photo_id: "photo".into(),
        offset_x: 0.5,
        offset_y: 1.0,
        zoom: 1.0,
    };
    let fitted = decode(&render(File::open(path).unwrap(), "rotate.jpg", Some(&cover)).unwrap());
    assert_eq!(fitted.dimensions(), (60, 40));
    assert!(fitted.get_pixel(30, 20)[2] > 225);
}

#[test]
fn preserves_rgb_profiles_across_jpeg_app2_segments() {
    use std::io::Cursor;

    let mut profile = vec![0x20; 70_000];
    let length = profile.len() as u32;
    profile[..4].copy_from_slice(&length.to_be_bytes());
    profile[16..20].copy_from_slice(b"RGB ");
    profile[36..40].copy_from_slice(b"acsp");
    let mut source = Vec::new();
    JpegEncoder::new_with_quality(&mut source, 90)
        .encode_image(&RgbImage::from_pixel(90, 60, Rgb([80, 120, 160])))
        .unwrap();
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("profile.jpg");
    fs::write(&path, encode_profile(source, &profile)).unwrap();
    let bytes = render(File::open(path).unwrap(), "profile.jpg", None).unwrap();
    assert_eq!(bytes[..4], [0xff, 0xd8, 0xff, 0xe0]);
    let mut decoder = image::codecs::jpeg::JpegDecoder::new(Cursor::new(bytes)).unwrap();
    assert_eq!(decoder.icc_profile().unwrap(), Some(profile));
}
