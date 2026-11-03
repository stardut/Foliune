use crate::{
    backup,
    curation::CurationStore,
    db::{self, Store},
    libraries,
    model_profiles::{self, ModelInput},
    photos,
    social::{self, SocialInput, SocialPlatform},
};
use image::{Rgb, RgbImage};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

fn setup(count: usize) -> (tempfile::TempDir, Store, Vec<String>) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("managed")).unwrap();
    let source = dir.path().join("photo.png");
    RgbImage::from_pixel(24, 16, Rgb([80, 120, 140]))
        .save(&source)
        .unwrap();
    let paths = (0..count)
        .map(|_| source.to_string_lossy().into_owned())
        .collect();
    let ids = photos::import(&store, paths, "work", None)
        .unwrap()
        .imported_ids;
    (dir, store, ids)
}

fn model(ids: &[String]) -> ModelInput {
    ModelInput {
        name: "夏日肖像".into(),
        contact: "微信：portrait".into(),
        city: "杭州".into(),
        tags: vec!["自然".into(), "人像".into()],
        tag_options: Some(vec!["自然".into(), "人像".into(), "未选标签".into()]),
        notes: "窗边自然光".into(),
        gender: "女".into(),
        birthday: "1996-02-29".into(),
        height_cm: Some(173.5),
        bust_cm: Some(85.0),
        waist_cm: Some(62.0),
        hips_cm: Some(89.0),
        photo_ids: ids.to_vec(),
        cover_photo_id: ids.first().cloned(),
    }
}

fn draft(ids: &[String]) -> SocialInput {
    SocialInput {
        name: "夏日序列".into(),
        platform: SocialPlatform::Moments,
        display_name: "摄影师".into(),
        title: "光与风".into(),
        body: "午后\n沿河散步。".into(),
        photo_ids: ids.to_vec(),
    }
}

#[test]
fn editorial_crud_preserves_order_identity_originals_and_other_references() {
    let (dir, store, ids) = setup(3);
    let mut conn = store.connection.lock().unwrap();
    let mut input = model(&[ids[2].clone(), ids[0].clone(), ids[2].clone()]);
    input.tags.push("自然".into());
    let saved = model_profiles::save(&mut conn, None, input).unwrap();
    assert_eq!(saved.input.photo_ids, [ids[2].clone(), ids[0].clone()]);
    assert_eq!(saved.input.tags, ["自然", "人像"]);
    let other = model_profiles::save(&mut conn, None, model(&ids)).unwrap();
    let mut social_input = draft(&[ids[1].clone(), ids[0].clone(), ids[1].clone()]);
    let social = social::save(&mut conn, None, social_input.clone()).unwrap();
    assert_eq!(social.input.photo_ids, [ids[1].clone(), ids[0].clone()]);
    let mut edited = saved.input.clone();
    edited.name = "  新名字  ".into();
    edited.photo_ids.reverse();
    edited.cover_photo_id = Some(ids[0].clone());
    let updated = model_profiles::save(&mut conn, Some(&saved.id), edited).unwrap();
    assert_eq!(updated.id, saved.id);
    assert_eq!(updated.created_at, saved.created_at);
    assert_eq!(updated.input.name, "新名字");
    assert_eq!(updated.input.photo_ids, [ids[0].clone(), ids[2].clone()]);
    social_input.platform = SocialPlatform::InstagramGrid;
    social_input.photo_ids = ids.iter().rev().cloned().collect();
    let updated_social = social::save(&mut conn, Some(&social.id), social_input).unwrap();
    assert_eq!(updated_social.created_at, social.created_at);
    assert_eq!(updated_social.id, social.id);
    photos::update(&mut conn, &ids[0], json!({"title":"引用不变"})).unwrap();
    drop(conn);
    drop(store);
    let reopened = Store::open(dir.path().join("managed")).unwrap();
    let conn = reopened.connection.lock().unwrap();
    assert!(model_profiles::list(&conn).unwrap().contains(&updated));
    assert_eq!(social::list(&conn).unwrap(), [updated_social.clone()]);
    let encoded = serde_json::to_value(&updated).unwrap();
    assert_eq!(encoded["heightCm"], 173.5);
    assert_eq!(encoded["coverPhotoId"], ids[0]);
    assert!(encoded.get("input").is_none());
    model_profiles::delete(&conn, &saved.id).unwrap();
    assert_eq!(model_profiles::list(&conn).unwrap(), [other]);
    assert_eq!(social::list(&conn).unwrap(), [updated_social]);
    social::delete(&conn, &social.id).unwrap();
    assert!(social::list(&conn).unwrap().is_empty());
    assert_eq!(
        conn.query_row::<i64, _, _>("SELECT count(*) FROM social_photos", [], |r| r.get(0))
            .unwrap(),
        0
    );
    assert_eq!(db::snapshot(&conn).unwrap().photos.len(), 3);
    assert!(db::snapshot(&conn)
        .unwrap()
        .photos
        .iter()
        .all(|p| p.original_available));
    assert!(model_profiles::delete(&conn, &saved.id)
        .unwrap_err()
        .contains("不存在"));
    assert!(social::delete(&conn, &social.id)
        .unwrap_err()
        .contains("不存在"));
}

#[test]
fn editorial_validation_rejects_invalid_inputs_and_unknown_updates() {
    let (_dir, store, ids) = setup(2);
    let mut conn = store.connection.lock().unwrap();
    let input = model(&ids);
    let mut cases = Vec::new();
    for name in [" ".to_string(), "中".repeat(201)] {
        let mut bad = input.clone();
        bad.name = name;
        cases.push(bad);
    }
    for birthday in ["2025-02-29", "2000-2-01", "invalid", "0000-01-01"] {
        let mut bad = input.clone();
        bad.birthday = birthday.into();
        cases.push(bad);
    }
    let mut future = input.clone();
    future.birthday = (chrono::Local::now().date_naive() + chrono::Days::new(1))
        .format("%Y-%m-%d")
        .to_string();
    cases.push(future);
    for value in [0.0, -1.0, 301.0, f64::NAN, f64::INFINITY] {
        for field in 0..4 {
            let mut bad = input.clone();
            match field {
                0 => bad.height_cm = Some(value),
                1 => bad.bust_cm = Some(value),
                2 => bad.waist_cm = Some(value),
                _ => bad.hips_cm = Some(value),
            }
            cases.push(bad);
        }
    }
    let mut missing = input.clone();
    missing.photo_ids.push("absent".into());
    cases.push(missing);
    let mut cover = input.clone();
    cover.photo_ids = vec![ids[0].clone()];
    cover.cover_photo_id = Some(ids[1].clone());
    cases.push(cover);
    let mut tags = input.clone();
    tags.tags = vec!["x".repeat(81)];
    cases.push(tags);
    let mut gender = input.clone();
    gender.gender = "x".repeat(41);
    cases.push(gender);
    let mut contact = input.clone();
    contact.contact = "x".repeat(501);
    cases.push(contact);
    let mut city = input.clone();
    city.city = "x".repeat(201);
    cases.push(city);
    let mut notes = input.clone();
    notes.notes = "x".repeat(20001);
    cases.push(notes);
    for bad in cases {
        assert!(model_profiles::save(&mut conn, None, bad).is_err());
    }
    assert!(model_profiles::list(&conn).unwrap().is_empty());
    assert!(
        model_profiles::save(&mut conn, Some("absent"), input.clone())
            .unwrap_err()
            .contains("不存在")
    );
    assert!(social::save(&mut conn, Some("absent"), draft(&ids))
        .unwrap_err()
        .contains("不存在"));
    let mut no_body = input;
    no_body.birthday.clear();
    no_body.gender.clear();
    no_body.height_cm = None;
    no_body.bust_cm = None;
    no_body.waist_cm = None;
    no_body.hips_cm = None;
    model_profiles::save(&mut conn, None, no_body).unwrap();
    let mut unknown = serde_json::to_value(draft(&ids)).unwrap();
    unknown["platform"] = json!("other");
    assert!(serde_json::from_value::<SocialInput>(unknown).is_err());
    for (field, value) in [
        ("name", " ".into()),
        ("displayName", "x".repeat(201)),
        ("title", "x".repeat(501)),
        ("body", "x".repeat(50001)),
    ] {
        let mut bad = serde_json::to_value(draft(&ids)).unwrap();
        bad[field] = json!(value);
        assert!(social::save(&mut conn, None, serde_json::from_value(bad).unwrap()).is_err());
    }
    let mut missing = draft(&ids);
    missing.photo_ids.push("absent".into());
    assert!(social::save(&mut conn, None, missing).is_err());
}

#[test]
fn editorial_save_rolls_back_after_late_reference_write_failure() {
    let (_dir, store, ids) = setup(2);
    let mut conn = store.connection.lock().unwrap();
    let profile = model_profiles::save(&mut conn, None, model(&ids[..1])).unwrap();
    let draft = social::save(&mut conn, None, draft(&ids[..1])).unwrap();
    conn.execute_batch("CREATE TRIGGER reject_model_ref BEFORE INSERT ON model_photos WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'test failure'); END;
        CREATE TRIGGER reject_social_ref BEFORE INSERT ON social_photos WHEN NEW.position=1 BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    let mut updated = model(&ids);
    updated.name = "不应保存".into();
    assert!(model_profiles::save(&mut conn, Some(&profile.id), updated.clone()).is_err());
    assert!(model_profiles::save(&mut conn, None, updated).is_err());
    let mut updated = draft.input.clone();
    updated.photo_ids = ids.clone();
    updated.body = "不应保存".into();
    assert!(social::save(&mut conn, Some(&draft.id), updated.clone()).is_err());
    assert!(social::save(&mut conn, None, updated).is_err());
    assert_eq!(model_profiles::list(&conn).unwrap(), [profile]);
    assert_eq!(social::list(&conn).unwrap(), [draft]);
    assert!(conn
        .execute(
            "INSERT INTO model_photos VALUES ('missing','missing',0)",
            []
        )
        .is_err());
}

#[test]
fn editorial_simulation_limits_allow_empty_drafts_and_preserve_on_platform_change_error() {
    let (_dir, store, ids) = setup(61);
    let mut conn = store.connection.lock().unwrap();
    for (platform, limit) in [
        (SocialPlatform::Moments, 9),
        (SocialPlatform::Xiaohongshu, 18),
        (SocialPlatform::Instagram, 20),
        (SocialPlatform::InstagramGrid, 60),
    ] {
        let mut input = draft(&[]);
        input.platform = platform;
        let empty = social::save(&mut conn, None, input.clone()).unwrap();
        input.photo_ids = ids[..limit].to_vec();
        let full = social::save(&mut conn, Some(&empty.id), input.clone()).unwrap();
        input.photo_ids.push(ids[limit].clone());
        assert!(social::save(&mut conn, Some(&empty.id), input).is_err());
        assert!(social::list(&conn).unwrap().contains(&full));
        if limit > 9 {
            let mut changed = full.input.clone();
            changed.platform = SocialPlatform::Moments;
            assert!(social::save(&mut conn, Some(&full.id), changed).is_err());
            assert!(social::list(&conn).unwrap().contains(&full));
        }
    }
}

// Rebuild a test backup with a checksum-valid database mutation to exercise semantic validation.
fn mutate_backup(dir: &Path, source: &Path, name: &str, sql: &str) -> PathBuf {
    let mut archive = ZipArchive::new(fs::File::open(source).unwrap()).unwrap();
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).unwrap();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).unwrap();
        entries.push((entry.name().to_string(), bytes));
    }
    let database = dir.join(format!("{name}.sqlite"));
    fs::write(
        &database,
        &entries
            .iter()
            .find(|(n, _)| n == "library.sqlite")
            .unwrap()
            .1,
    )
    .unwrap();
    let conn = rusqlite::Connection::open(&database).unwrap();
    conn.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    conn.execute_batch(sql).unwrap();
    drop(conn);
    let bytes = fs::read(database).unwrap();
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let mut manifest: serde_json::Value = serde_json::from_slice(
        &entries
            .iter()
            .find(|(n, _)| n == "manifest.json")
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
    let path = dir.join(format!("{name}.zip"));
    let mut output = ZipWriter::new(fs::File::create(&path).unwrap());
    for (name, data) in entries {
        output
            .start_file(&name, SimpleFileOptions::default())
            .unwrap();
        let data = match name.as_str() {
            "library.sqlite" => bytes.clone(),
            "manifest.json" => serde_json::to_vec(&manifest).unwrap(),
            _ => data,
        };
        output.write_all(&data).unwrap();
    }
    output.finish().unwrap();
    path
}

#[test]
fn editorial_backup_restore_keeps_records_order_and_current_library_isolation() {
    let (dir, store, ids) = setup(3);
    let profile = model_profiles::save(
        &mut store.connection.lock().unwrap(),
        None,
        model(&[ids[2].clone(), ids[0].clone()]),
    )
    .unwrap();
    let draft = social::save(&mut store.connection.lock().unwrap(), None, draft(&ids)).unwrap();
    let path = dir.path().join("backup.zip");
    backup::create(&store, &path).unwrap();
    let restored = backup::restore(&store, &path).unwrap();
    libraries::switch(&store, &CurationStore::default(), &restored.library.id).unwrap();
    {
        let mut conn = store.connection.lock().unwrap();
        assert_eq!(model_profiles::list(&conn).unwrap(), [profile.clone()]);
        assert_eq!(social::list(&conn).unwrap(), [draft.clone()]);
        let mut changed = profile.input.clone();
        changed.name = "新库模特".into();
        model_profiles::save(&mut conn, Some(&profile.id), changed).unwrap();
        social::delete(&conn, &draft.id).unwrap();
    }
    drop(store);
    let store = Store::open(dir.path().join("managed")).unwrap();
    assert_eq!(
        model_profiles::list(&store.connection.lock().unwrap()).unwrap()[0]
            .input
            .name,
        "新库模特"
    );
    assert!(social::list(&store.connection.lock().unwrap())
        .unwrap()
        .is_empty());
    libraries::switch(&store, &CurationStore::default(), "default").unwrap();
    assert_eq!(
        model_profiles::list(&store.connection.lock().unwrap()).unwrap(),
        [profile]
    );
    assert_eq!(
        social::list(&store.connection.lock().unwrap()).unwrap(),
        [draft]
    );
}

#[test]
fn editorial_old_backup_initializes_empty_tables_before_restore_validation() {
    let (dir, store, _ids) = setup(1);
    let path = dir.path().join("backup.zip");
    backup::create(&store, &path).unwrap();
    let legacy = mutate_backup(dir.path(), &path, "legacy", "DROP TABLE model_photos; DROP TABLE model_profiles; DROP TABLE social_photos; DROP TABLE social_drafts;");
    let restored = backup::restore(&store, &legacy).unwrap();
    libraries::switch(&store, &CurationStore::default(), &restored.library.id).unwrap();
    let mut conn = store.connection.lock().unwrap();
    assert!(model_profiles::list(&conn).unwrap().is_empty());
    assert!(social::list(&conn).unwrap().is_empty());
    model_profiles::save(&mut conn, None, model(&[])).unwrap();
    social::save(&mut conn, None, draft(&[])).unwrap();
}

#[test]
fn editorial_restore_rejects_invalid_content_references_and_order_without_changing_current_library()
{
    let (dir, store, ids) = setup(2);
    let profile = model_profiles::save(
        &mut store.connection.lock().unwrap(),
        None,
        model(&ids[..1]),
    )
    .unwrap();
    let draft = social::save(&mut store.connection.lock().unwrap(), None, draft(&ids)).unwrap();
    let path = dir.path().join("backup.zip");
    backup::create(&store, &path).unwrap();
    let bad_cover = format!("UPDATE model_profiles SET cover_photo_id='{}'", ids[1]);
    for (index, sql) in [
        "DROP TABLE model_photos",
        "DROP TABLE social_photos",
        "UPDATE model_profiles SET birthday='2025-02-29'",
        "UPDATE model_profiles SET tags='not-json'",
        "UPDATE model_profiles SET tag_options='not-json'",
        "UPDATE model_profiles SET tag_options='[]'",
        "UPDATE model_profiles SET tag_options='[\"\"]'",
        "UPDATE model_profiles SET height_cm=-1",
        "UPDATE model_profiles SET name=''",
        "UPDATE model_profiles SET created_at='invalid'",
        bad_cover.as_str(),
        "UPDATE model_photos SET photo_id='missing'",
        "UPDATE model_photos SET position=5",
        "UPDATE social_photos SET photo_id='missing' WHERE position=0",
        "UPDATE social_photos SET position=5 WHERE position=1",
        "UPDATE social_drafts SET body=replace(hex(zeroblob(25001)),'0','x')",
        "PRAGMA ignore_check_constraints=ON; UPDATE social_drafts SET platform='other'",
    ]
    .into_iter()
    .enumerate()
    {
        let bad = mutate_backup(dir.path(), &path, &format!("invalid-{index}"), sql);
        assert!(backup::restore(&store, &bad).is_err(), "{sql}");
        assert_eq!(libraries::list(&store).unwrap().libraries.len(), 1);
        assert_eq!(
            model_profiles::list(&store.connection.lock().unwrap()).unwrap(),
            [profile.clone()]
        );
        assert_eq!(
            social::list(&store.connection.lock().unwrap()).unwrap(),
            [draft.clone()]
        );
    }
}

#[test]
fn editorial_model_tag_catalog_migrates_legacy_and_persists_empty_or_unselected_options() {
    let (dir, store, ids) = setup(1);
    let mut input = model(&ids);
    input.gender = "其他".into();
    let saved = model_profiles::save(&mut store.connection.lock().unwrap(), None, input).unwrap();
    // Simulate the real pre-catalog schema, preserving records and photo references.
    store
        .connection
        .lock()
        .unwrap()
        .execute("ALTER TABLE model_profiles DROP COLUMN tag_options", [])
        .unwrap();
    drop(store);
    let store = Store::open(dir.path().join("managed")).unwrap();
    let mut conn = store.connection.lock().unwrap();
    model_profiles::init(&conn).unwrap(); // Repeated initialization is harmless.
    let legacy = model_profiles::list(&conn).unwrap().remove(0);
    assert_eq!(legacy.input.tag_options, None);
    assert_eq!(legacy.input.tags, saved.input.tags);
    assert_eq!(legacy.input.photo_ids, ids);
    assert_eq!(legacy.input.gender, "其他");
    assert_eq!(legacy.input.height_cm, saved.input.height_cm);
    model_profiles::validate_all(&conn).unwrap();
    let mut missing = serde_json::to_value(&legacy.input).unwrap();
    missing.as_object_mut().unwrap().remove("tagOptions");
    assert_eq!(
        serde_json::from_value::<ModelInput>(missing)
            .unwrap()
            .tag_options,
        None
    );
    let mut edited = legacy.input.clone();
    edited.tags = vec![" 自然 ".into(), "自然".into()];
    edited.tag_options = Some(vec![" 自然 ".into(), "自然".into(), "未选标签".into()]);
    let normalized = model_profiles::save(&mut conn, Some(&saved.id), edited).unwrap();
    assert_eq!(normalized.input.tags, ["自然"]);
    assert_eq!(
        normalized.input.tag_options.as_ref().unwrap(),
        &["自然", "未选标签"]
    );
    assert_eq!(model_profiles::list(&conn).unwrap(), [normalized.clone()]);
    let mut empty = normalized.input.clone();
    empty.tags.clear();
    empty.tag_options = Some(vec![]);
    let empty = model_profiles::save(&mut conn, Some(&saved.id), empty).unwrap();
    drop(conn);
    drop(store);
    let reopened = Store::open(dir.path().join("managed")).unwrap();
    let conn = reopened.connection.lock().unwrap();
    assert_eq!(model_profiles::list(&conn).unwrap(), [empty]);
    model_profiles::validate_all(&conn).unwrap();
}

#[test]
fn editorial_model_tag_catalog_checks_limits_text_and_selected_membership() {
    let (_dir, store, _) = setup(0);
    let mut conn = store.connection.lock().unwrap();
    let mut input = model(&[]);
    input.tags = (0..50).map(|i| format!("标签{i}")).collect();
    input.tag_options = Some((0..100).map(|i| format!("标签{i}")).collect());
    let saved = model_profiles::save(&mut conn, None, input.clone()).unwrap();
    for (options, expected) in [
        ((0..101).map(|i| format!("标签{i}")).collect(), "最多 100"),
        (vec![" ".into()], "不能为空"),
        (vec!["x".repeat(81)], "80 个字符"),
        (vec!["nul\0tag".into()], "空字符"),
        (vec![], "须来自"),
    ] {
        let mut bad = input.clone();
        bad.tag_options = Some(options);
        assert!(model_profiles::save(&mut conn, Some(&saved.id), bad)
            .unwrap_err()
            .contains(expected));
    }
    input.tags.push("标签50".into());
    assert!(model_profiles::save(&mut conn, Some(&saved.id), input)
        .unwrap_err()
        .contains("最多 50"));
    assert_eq!(model_profiles::list(&conn).unwrap(), [saved]);
}

#[test]
fn editorial_backup_restore_migrates_legacy_tag_catalog_and_preserves_explicit_empty() {
    let (dir, store, _) = setup(0);
    let profile =
        model_profiles::save(&mut store.connection.lock().unwrap(), None, model(&[])).unwrap();
    let mut empty = model(&[]);
    empty.tags.clear();
    empty.tag_options = Some(vec![]);
    let empty = model_profiles::save(&mut store.connection.lock().unwrap(), None, empty).unwrap();
    let path = dir.path().join("catalog.zip");
    backup::create(&store, &path).unwrap();
    let restored = backup::restore(&store, &path).unwrap();
    libraries::switch(&store, &CurationStore::default(), &restored.library.id).unwrap();
    let profiles = model_profiles::list(&store.connection.lock().unwrap()).unwrap();
    assert!(profiles.contains(&profile));
    assert!(profiles.contains(&empty));
    let legacy = mutate_backup(
        dir.path(),
        &path,
        "pre-catalog",
        "ALTER TABLE model_profiles DROP COLUMN tag_options",
    );
    let restored = backup::restore(&store, &legacy).unwrap();
    libraries::switch(&store, &CurationStore::default(), &restored.library.id).unwrap();
    let profiles = model_profiles::list(&store.connection.lock().unwrap()).unwrap();
    assert!(profiles
        .iter()
        .all(|profile| profile.input.tag_options.is_none()));
    assert_eq!(
        profiles
            .iter()
            .find(|p| p.id == profile.id)
            .unwrap()
            .input
            .tags,
        profile.input.tags
    );
    assert!(profiles
        .iter()
        .find(|p| p.id == empty.id)
        .unwrap()
        .input
        .tags
        .is_empty());
}
