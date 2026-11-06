use crate::{
    collage::{self, CollageInput, CollageItem, Fit},
    db::{snapshot, Store},
    groups,
    models::GroupInput,
    photos,
};
use image::{Rgb, RgbImage};
use std::fs;

fn setup() -> (tempfile::TempDir, Store, CollageInput) {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path().join("managed")).unwrap();
    let group = groups::create(
        &store.connection.lock().unwrap(),
        GroupInput {
            library: "collection".into(),
            name: "来源".into(),
            description: String::new(),
            capacity: Some(2),
        },
    )
    .unwrap()
    .groups[0]
        .id
        .clone();
    let paths = [
        ("red.png", 80, 40, [240, 20, 30]),
        ("blue.png", 40, 80, [20, 30, 240]),
    ]
    .into_iter()
    .map(|(name, width, height, color)| {
        let path = temp.path().join(name);
        RgbImage::from_pixel(width, height, Rgb(color))
            .save(&path)
            .unwrap();
        path.to_string_lossy().into_owned()
    })
    .collect();
    let ids = photos::import(&store, paths, "collection", Some(&group))
        .unwrap()
        .imported_ids;
    let input = CollageInput {
        library: "collection".into(),
        title: "海岸拼图".into(),
        width: 100,
        height: 80,
        background: "#ffffff".into(),
        items: ids
            .into_iter()
            .enumerate()
            .map(|(index, id)| CollageItem {
                photo_id: id,
                x: index as u32 * 50,
                y: 0,
                width: 50,
                height: 80,
                fit: if index == 0 { Fit::Contain } else { Fit::Cover },
                offset_x: 0.5,
                offset_y: 0.5,
                zoom: 1.0,
            })
            .collect(),
    };
    (temp, store, input)
}

#[test]
fn png_export_preserves_sources_and_leaves_full_album_unchanged() {
    let (temp, store, input) = setup();
    let directory = temp.path().join("output");
    fs::create_dir(&directory).unwrap();
    let before = snapshot(&store.connection.lock().unwrap()).unwrap();
    let bytes: Vec<_> = before
        .photos
        .iter()
        .map(|photo| fs::read(&photo.original_path).unwrap())
        .collect();

    let path = collage::export_png(&store, &directory, input).unwrap();
    assert_eq!(path, directory.join("海岸拼图.png"));
    let output = image::open(path).unwrap().to_rgb8();
    assert_eq!(output.dimensions(), (100, 80));
    assert_eq!(output.get_pixel(10, 5).0, [255, 255, 255]);
    assert_eq!(output.get_pixel(10, 40).0, [240, 20, 30]);
    assert_eq!(output.get_pixel(90, 5).0, [20, 30, 240]);

    let after = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert_eq!(
        serde_json::to_value(after).unwrap(),
        serde_json::to_value(&before).unwrap()
    );
    for (photo, original) in before.photos.iter().zip(bytes) {
        assert_eq!(fs::read(&photo.original_path).unwrap(), original);
    }
    assert_eq!(
        fs::read_dir(store.root.join("originals")).unwrap().count(),
        2
    );
    assert_eq!(
        fs::read_dir(store.root.join("thumbnails")).unwrap().count(),
        2
    );
    assert!(!store.root.join("staging").exists());
}

#[test]
fn cover_offsets_and_zoom_select_the_requested_source_region() {
    let (temp, store, mut input) = setup();
    let path = temp.path().join("split.png");
    RgbImage::from_fn(120, 40, |x, _| {
        Rgb(if x < 40 {
            [255, 0, 0]
        } else if x < 80 {
            [0, 255, 0]
        } else {
            [0, 0, 255]
        })
    })
    .save(&path)
    .unwrap();
    let id = photos::import(
        &store,
        vec![path.to_string_lossy().into()],
        "collection",
        None,
    )
    .unwrap()
    .imported_ids[0]
        .clone();
    input.width = 40;
    input.height = 40;
    input.items.truncate(1);
    input.items[0].photo_id = id;
    input.items[0].width = 40;
    input.items[0].height = 40;
    input.items[0].fit = Fit::Cover;
    for (offset, expected) in [(0.0, [255, 0, 0]), (0.5, [0, 255, 0]), (1.0, [0, 0, 255])] {
        input.items[0].offset_x = offset;
        input.items[0].zoom = 2.0;
        let path = collage::export_png(&store, temp.path(), input.clone()).unwrap();
        assert_eq!(
            image::open(path).unwrap().to_rgb8().get_pixel(20, 20).0,
            expected
        );
    }
}

#[test]
fn invalid_geometry_missing_sources_and_wrong_library_are_rejected() {
    let (temp, store, input) = setup();
    let mut invalid = input.clone();
    invalid.width = 32_769;
    assert!(collage::export_png(&store, temp.path(), invalid).is_err());
    let mut invalid = input.clone();
    invalid.width = 16_000;
    invalid.height = 10_001;
    assert!(collage::export_png(&store, temp.path(), invalid).is_err());
    let mut invalid = input.clone();
    invalid.items[0].x = u32::MAX;
    assert!(collage::export_png(&store, temp.path(), invalid).is_err());
    let mut invalid = input.clone();
    invalid.items[0].offset_x = f64::NAN;
    assert!(collage::export_png(&store, temp.path(), invalid).is_err());
    let mut invalid = input.clone();
    invalid.items[0].zoom = 2.0;
    assert!(collage::export_png(&store, temp.path(), invalid).is_err());
    let mut invalid = input.clone();
    invalid.items = vec![input.items[0].clone(); 101];
    assert!(collage::export_png(&store, temp.path(), invalid).is_err());
    let mut invalid = input.clone();
    invalid.background = "transparent".into();
    assert!(collage::export_png(&store, temp.path(), invalid).is_err());
    let mut invalid = input.clone();
    invalid.library = "work".into();
    assert!(collage::export_png(&store, temp.path(), invalid).is_err());
    let mut invalid = input.clone();
    invalid.items[0].photo_id = "/tmp/photo.png".into();
    assert!(collage::export_png(&store, temp.path(), invalid).is_err());
    let state = snapshot(&store.connection.lock().unwrap()).unwrap();
    fs::remove_file(&state.photos[0].original_path).unwrap();
    assert!(collage::export_png(&store, temp.path(), input).is_err());
    assert_eq!(
        snapshot(&store.connection.lock().unwrap())
            .unwrap()
            .photos
            .len(),
        2
    );
}

#[test]
fn exif_rotation_is_applied_to_generated_png() {
    let (temp, store, mut input) = setup();
    let path = temp.path().join("rotated.jpg");
    RgbImage::from_fn(80, 40, |x, _| {
        Rgb(if x < 40 { [240, 10, 10] } else { [10, 10, 240] })
    })
    .save(&path)
    .unwrap();
    let jpeg = fs::read(&path).unwrap();
    let mut exif = b"Exif\0\0II*\0\x08\0\0\0\x01\0".to_vec();
    exif.extend_from_slice(&[0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);
    let mut oriented = vec![0xff, 0xd8, 0xff, 0xe1];
    oriented.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
    oriented.extend(exif);
    oriented.extend_from_slice(&jpeg[2..]);
    fs::write(&path, &oriented).unwrap();
    let id = photos::import(
        &store,
        vec![path.to_string_lossy().into()],
        "collection",
        None,
    )
    .unwrap()
    .imported_ids[0]
        .clone();
    input.width = 40;
    input.height = 80;
    input.items.truncate(1);
    input.items[0].photo_id = id;
    input.items[0].width = 40;
    let exported = collage::export_png(&store, temp.path(), input).unwrap();
    let output = image::open(&exported).unwrap().to_rgb8();
    assert_eq!(output.dimensions(), (40, 80));
    assert!(output.get_pixel(20, 10)[0] > 200);
    assert!(output.get_pixel(20, 70)[2] > 200);
    assert_eq!(fs::read(path).unwrap(), oriented);
    assert_eq!(exported.extension().unwrap(), "png");
}

#[test]
fn native_detail_pixels_survive_contain_and_zoomed_cover_without_resampling() {
    let (temp, store, mut input) = setup();
    let detail = RgbImage::from_fn(512, 384, |x, y| {
        // Single-pixel texture and distinct coordinates reveal blur, wrong
        // cropping, thumbnail substitution and lossy encoding.
        Rgb([
            (x % 256) as u8,
            (y % 256) as u8,
            if (x + y) % 2 == 0 { 0 } else { 255 },
        ])
    });
    let path = temp.path().join("native-detail.png");
    detail.save(&path).unwrap();
    let id = photos::import(
        &store,
        vec![path.to_string_lossy().into()],
        "collection",
        None,
    )
    .unwrap()
    .imported_ids[0]
        .clone();
    input.width = 704;
    input.height = 384;
    input.items[0].photo_id = id.clone();
    input.items[0].width = 512;
    input.items[0].height = 384;
    input.items[0].fit = Fit::Contain;
    input.items[1].photo_id = id;
    input.items[1].x = 512;
    input.items[1].width = 192;
    input.items[1].height = 192;
    input.items[1].fit = Fit::Cover;
    input.items[1].zoom = 2.0;
    input.items[1].offset_x = 1.0;
    input.items[1].offset_y = 0.0;
    let exported = collage::export_png(&store, temp.path(), input).unwrap();
    let output = image::open(&exported).unwrap().to_rgb8();
    for (x, y, pixel) in detail.enumerate_pixels() {
        assert_eq!(output.get_pixel(x, y), pixel, "contain pixel {x},{y}");
    }
    // Cover scales 192/384 × zoom 2 = 1:1; right/top crop is [320, 0, 192, 192].
    for y in 0..192 {
        for x in 0..192 {
            assert_eq!(
                output.get_pixel(512 + x, y),
                detail.get_pixel(320 + x, y),
                "cover pixel {x},{y}"
            );
        }
    }
}

#[test]
fn transparent_source_is_composited_on_selected_background_at_native_size() {
    let (temp, store, mut input) = setup();
    let path = temp.path().join("transparent.png");
    image::RgbaImage::from_fn(4, 2, |x, _| {
        image::Rgba([200, 100, 0, [0, 64, 128, 255][x as usize]])
    })
    .save(&path)
    .unwrap();
    let id = photos::import(
        &store,
        vec![path.to_string_lossy().into()],
        "collection",
        None,
    )
    .unwrap()
    .imported_ids[0]
        .clone();
    input.width = 4;
    input.height = 2;
    input.background = "#102030".into();
    input.items.truncate(1);
    input.items[0].photo_id = id;
    input.items[0].width = 4;
    input.items[0].height = 2;
    let exported = collage::export_png(&store, temp.path(), input).unwrap();
    let output = image::open(&exported).unwrap().to_rgb8();
    assert_eq!(output.get_pixel(0, 0).0, [16, 32, 48]);
    assert_eq!(output.get_pixel(1, 0).0, [62, 49, 36]);
    assert_eq!(output.get_pixel(2, 0).0, [108, 66, 24]);
    assert_eq!(output.get_pixel(3, 0).0, [200, 100, 0]);
}

#[test]
#[ignore = "160 MP resource acceptance; run explicitly to verify PNG encoding"]
fn maximum_rgb_output_exports_without_reducing_dimensions() {
    let (temp, store, mut input) = setup();
    input.width = 16_000;
    input.height = 10_000;
    input.background = "#102030".into();
    let exported = collage::export_png(&store, temp.path(), input).unwrap();
    assert_eq!(image::image_dimensions(exported).unwrap(), (16_000, 10_000));
}
