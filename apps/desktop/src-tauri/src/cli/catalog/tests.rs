use super::*;
use crate::db::Store;
use image::{Rgb, RgbImage};
use serde_json::json;

#[test]
fn search_and_patch_respect_active_members_and_editable_metadata() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().canonicalize().unwrap();
    let store = Store::open_direct(root.join("library")).unwrap();
    let input = root.join("frame.png");
    RgbImage::from_pixel(24, 18, Rgb([90, 81, 10]))
        .save(&input)
        .unwrap();
    let paths = vec![input.to_str().unwrap().to_string(); 2];
    let imported = photos::import_local(&store, paths, "collection", None)
        .unwrap()
        .0;
    let active = &imported.imported_ids[0];
    let discarded = &imported.imported_ids[1];
    let mut conn = store.connection.lock().unwrap();
    let album = db::write(&mut conn, |conn| {
        let album = create_album(
            conn,
            GroupInput {
                library: "collection".into(),
                name: "棚拍".into(),
                description: String::new(),
                capacity: Some(2),
            },
        )?;
        let id = album.album.group.id;
        add_photos(conn, &id, &imported.imported_ids)?;
        discard_photos(conn, &id, std::slice::from_ref(discarded))?;
        Ok(id)
    })
    .unwrap();
    assert_eq!(show_album(&conn, &album).unwrap().album.active_count, 1);
    assert_eq!(list_albums(&conn, Some("work"), 1, 0).unwrap().total, 0);
    assert_eq!(list_albums(&conn, None, 1, 1).unwrap().total, 1);
    let page = search_photos(&conn, None, None, Some("FRAME.PNG"), 1, 0).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.total, 2);
    let page = search_photos(&conn, None, Some(&album), Some("frame"), 1, 0).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].id, *active);
    assert_eq!(
        show_photo(&conn, discarded).unwrap().memberships[0].status,
        "discarded"
    );

    let regions = json!([{"id":"legacy","text":"保留区域","x":0,"y":0,"width":0.5,"height":0.5}]);
    photos::update(&mut conn, active, json!({"regions": regions})).unwrap();
    assert_eq!(
        search_photos(&conn, None, None, Some("保留区域"), 1, 0)
            .unwrap()
            .total,
        1
    );
    let record = db::write(&mut conn, |conn| {
        update_photo(
            conn,
            active,
            json!({"capturedAt":"2026-11-13", "tags":["光线", "光线"]}),
        )
    })
    .unwrap();
    assert_eq!(record.photo.tags, ["光线"]);
    assert_eq!(record.photo.captured_at.as_deref(), Some("2026-11-13"));
    let record = db::write(&mut conn, |conn| {
        update_photo(conn, active, json!({"capturedAt":null}))
    })
    .unwrap();
    assert!(record.photo.captured_at.is_none());
    for patch in [
        json!({"annotation":"应回滚", "unknown":true}),
        json!({"regions": []}),
        json!({"tags": "字符串不是数组"}),
        json!({}),
    ] {
        assert!(db::write(&mut conn, |conn| update_photo(conn, active, patch)).is_err());
    }
    let record = show_photo(&conn, active).unwrap();
    assert!(record.photo.annotation.is_empty());
    assert_eq!(record.photo.regions.len(), 1);
    assert_eq!(record.photo.original_available, Some(true));

    let updated = photos::update_from_baseline(
        &mut conn,
        active,
        json!({"annotation":"桌面保存"}),
        json!({"annotation":""}),
    )
    .unwrap();
    let updated = updated
        .photos
        .iter()
        .find(|photo| photo.id == *active)
        .unwrap();
    assert_eq!(updated.tags, ["光线"]);
    assert_eq!(updated.annotation, "桌面保存");
    let conflict = photos::update_from_baseline(
        &mut conn,
        active,
        json!({"tags":["旧桌面标签"], "location":"应回滚"}),
        json!({"tags":[], "location":""}),
    )
    .unwrap_err();
    assert_eq!(conflict, db::REVISION_CONFLICT);
    assert!(show_photo(&conn, active).unwrap().photo.location.is_empty());

    std::fs::remove_file(input).unwrap();
    let jpeg = preview_photo(&conn, active).unwrap();
    assert_eq!(image::guess_format(&jpeg).unwrap(), ImageFormat::Jpeg);
    assert_eq!(
        show_photo(&conn, active).unwrap().photo.original_available,
        Some(false)
    );
    assert!(serde_json::to_value(record)
        .unwrap()
        .get("originalPath")
        .is_none());
}

#[test]
fn lowering_capacity_requires_explicit_active_members_and_is_atomic() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open_direct(temp.path().join("library")).unwrap();
    let input = temp.path().join("frame.png");
    RgbImage::from_pixel(24, 18, Rgb([90, 81, 10]))
        .save(&input)
        .unwrap();
    let imported = photos::import_local(
        &store,
        vec![input.to_str().unwrap().to_string(); 3],
        "collection",
        None,
    )
    .unwrap()
    .0;
    let [first, second, third] = imported.imported_ids.as_slice() else {
        panic!("需要三张测试照片");
    };
    let mut conn = store.connection.lock().unwrap();
    let id = db::write(&mut conn, |conn| {
        let album = create_album(
            conn,
            GroupInput {
                library: "collection".into(),
                name: "棚拍".into(),
                description: String::new(),
                capacity: None,
            },
        )?;
        let id = album.album.group.id;
        add_photos(conn, &id, &imported.imported_ids)?;
        Ok(id)
    })
    .unwrap();
    for patch in [
        json!({"capacity":1}),
        json!({"discardPhotoIds":[first]}),
        json!({"capacity":3,"discardPhotoIds":[first]}),
        json!({"capacity":1,"discardPhotoIds":[first]}),
        json!({"capacity":1,"discardPhotoIds":[first,first]}),
        json!({"capacity":1,"discardPhotoIds":[first,"missing"]}),
        json!({"capacity":1,"discardPhotoIds":[first,second],"name": ""}),
    ] {
        assert!(db::write(&mut conn, |conn| update_album(conn, &id, patch)).is_err());
        let saved = show_album(&conn, &id).unwrap();
        assert_eq!(saved.album.active_count, 3);
        assert_eq!(saved.album.group.capacity, None);
    }
    let saved = db::write(&mut conn, |conn| {
        update_album(
            conn,
            &id,
            json!({"capacity":1,"discardPhotoIds":[first,second]}),
        )
    })
    .unwrap();
    assert_eq!(saved.album.active_count, 1);
    assert_eq!(saved.album.group.capacity, Some(1));
    assert_eq!(saved.memberships[0].status, "discarded");
    assert_eq!(saved.memberships[1].status, "discarded");
    assert_eq!(saved.memberships[2].photo_id, *third);
    assert!(input.is_file());

    db::write(&mut conn, |conn| {
        update_album(
            conn,
            &id,
            json!({"cover":{"photoId":third,"offsetX":0.1,"offsetY":0.2,"zoom":1.5}}),
        )
    })
    .unwrap();
    let edited_cover = json!({"photoId":third,"offsetX":0.3,"offsetY":0.4,"zoom":2.0});
    let conflict = groups::save_cover(&mut conn, &id, &edited_cover, None).unwrap_err();
    assert_eq!(conflict, db::REVISION_CONFLICT);
    let saved = show_album(&conn, &id).unwrap().album.group.cover.unwrap();
    assert_eq!(saved.offset_x, 0.1);
    groups::save_cover(&mut conn, &id, &edited_cover, Some(&saved)).unwrap();
    assert_eq!(
        show_album(&conn, &id)
            .unwrap()
            .album
            .group
            .cover
            .unwrap()
            .offset_x,
        0.3
    );
}
