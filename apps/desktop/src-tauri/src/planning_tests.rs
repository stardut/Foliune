use crate::{
    backup,
    db::{self, Store},
    photos,
    planning::{self, PlanPart, PlanPriority, PlanReference, PlanShot, ShootPlanInput},
    planning_export,
};
use image::{Rgb, RgbImage};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Cursor, Read, Write},
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
    let ids = photos::import(
        &store,
        (0..count)
            .map(|_| source.to_string_lossy().into_owned())
            .collect(),
        "work",
        None,
    )
    .unwrap()
    .imported_ids;
    (dir, store, ids)
}

fn reference(photo_id: &str, intent: &str) -> PlanReference {
    PlanReference {
        id: uuid::Uuid::new_v4().to_string(),
        photo_id: photo_id.into(),
        intent: intent.into(),
    }
}

fn shot(photo_id: &str, title: &str) -> PlanShot {
    PlanShot {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.into(),
        description: "回头看镜头".into(),
        pose: "肩膀放松".into(),
        composition: "半身".into(),
        lighting: "侧光".into(),
        mood: "安静".into(),
        priority: PlanPriority::Must,
        references: vec![reference(photo_id, title)],
    }
}

fn part() -> PlanPart {
    PlanPart {
        id: uuid::Uuid::new_v4().to_string(),
        title: String::new(),
        description: String::new(),
        shot_list: String::new(),
        scene: String::new(),
        styling: String::new(),
        lighting: String::new(),
        focal_length: String::new(),
        mood: String::new(),
        time_window: String::new(),
        references: vec![],
        shots: vec![],
    }
}

pub(crate) fn input(ids: &[String]) -> ShootPlanInput {
    ShootPlanInput {
        title: " 午后人像 ".into(),
        concept: "安静的窗光\n自然的情绪".into(),
        execution_date: "2026-11-07".into(),
        shoot_date: "周六 15:00—18:00".into(),
        location: "老街工作室".into(),
        team: "摄影／模特／化妆".into(),
        deliverables: "8张作品集".into(),
        visual_direction: "冷调自然光".into(),
        styling: "自然妆／低马尾／白衬衫".into(),
        props: "透明雨伞／旧书".into(),
        equipment: "机身／35mm／85mm／反光板".into(),
        preparation: "提前沟通肖像授权".into(),
        references: ids.iter().map(|id| reference(id, "整体气质")).collect(),
        parts: vec![],
    }
}

#[test]
fn album_deletion_preserves_plan_references_and_rejects_new_hidden_references() {
    let (_dir, store, ids) = setup(2);
    let mut conn = store.connection.lock().unwrap();
    let album = crate::groups::create(
        &conn,
        crate::models::GroupInput {
            library: "work".into(),
            name: "策划素材".into(),
            description: String::new(),
            capacity: None,
        },
    )
    .unwrap()
    .groups[0]
        .id
        .clone();
    crate::groups::add(&mut conn, &album, &ids).unwrap();
    let plan = planning::save(&mut conn, None, input(&ids[..1])).unwrap();
    let state = crate::work_directory::runtime::delete_album(&mut conn, &album).unwrap();
    assert_eq!(state.hidden_photo_ids, ids[1..]);
    assert_eq!(state.photos[0].id, ids[0]);
    assert_eq!(planning::list(&conn).unwrap(), [plan]);
    assert!(planning::save(&mut conn, None, input(&ids[1..])).is_err());
}

#[test]
fn planning_crud_persists_nested_order_and_keeps_originals_and_other_plans() {
    let (dir, store, ids) = setup(3);
    let mut conn = store.connection.lock().unwrap();
    let mut draft = input(&[ids[2].clone(), ids[0].clone(), ids[2].clone()]);
    let mut first = part();
    first.shot_list = "01 环境\n02 半身".into();
    first.focal_length = "35mm 环境／85mm 半身".into();
    first.references = vec![reference(&ids[1], "服装"), reference(&ids[0], "发型")];
    first.shots = vec![shot(&ids[0], "姿态"), shot(&ids[0], "光线")];
    draft.parts = vec![first, part()];
    let saved = planning::save(&mut conn, None, draft).unwrap();
    assert_eq!(saved.input.title, "午后人像");
    assert_eq!(saved.input.references.len(), 3);
    let union: Vec<String> = conn
        .prepare("SELECT photo_id FROM shoot_plan_photos WHERE plan_id=?1 ORDER BY position")
        .unwrap()
        .query_map([&saved.id], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(union, [ids[2].clone(), ids[0].clone(), ids[1].clone()]);
    let other = planning::save(&mut conn, None, input(&ids)).unwrap();
    let mut changed = saved.input.clone();
    changed.references.reverse();
    changed.parts[0].shots.reverse();
    changed.parts[0].references.reverse();
    changed.parts.reverse();
    changed.execution_date = "2028-02-29".into();
    changed.preparation = "已确认时间".into();
    let updated = planning::save(&mut conn, Some(&saved.id), changed).unwrap();
    assert_eq!(saved.id, updated.id);
    assert_eq!(saved.created_at, updated.created_at);
    drop(conn);
    drop(store);
    let store = Store::open(dir.path().join("managed")).unwrap();
    let mut conn = store.connection.lock().unwrap();
    assert!(planning::list(&conn).unwrap().contains(&updated));
    let encoded = serde_json::to_value(&updated).unwrap();
    assert_eq!(
        encoded["parts"][1]["shots"][0]["references"][0]["intent"],
        "光线"
    );
    assert_eq!(encoded["parts"][1]["shotList"], "01 环境\n02 半身");
    assert_eq!(encoded["parts"][1]["focalLength"], "35mm 环境／85mm 半身");
    assert_eq!(encoded["executionDate"], "2028-02-29");
    assert_eq!(encoded["shootDate"], "周六 15:00—18:00");
    assert_eq!(encoded["styling"], "自然妆／低马尾／白衬衫");
    assert_eq!(encoded["props"], "透明雨伞／旧书");
    assert_eq!(encoded["equipment"], "机身／35mm／85mm／反光板");
    assert!(encoded.get("input").is_none());
    planning::delete(&mut conn, &saved.id).unwrap();
    assert_eq!(planning::list(&conn).unwrap(), [other]);
    assert_eq!(
        conn.query_row::<i64, _, _>(
            "SELECT count(*) FROM shoot_plan_photos WHERE plan_id=?1",
            [&saved.id],
            |row| row.get(0)
        )
        .unwrap(),
        0
    );
    assert!(planning::delete(&mut conn, &saved.id)
        .unwrap_err()
        .contains("不存在"));
    let state = db::snapshot(&conn).unwrap();
    assert_eq!(state.photos.len(), 3);
    assert!(state.photos.iter().all(|photo| photo.original_available));
}

#[test]
fn planning_validation_and_reference_failure_roll_back_the_whole_save() {
    let (_dir, store, ids) = setup(2);
    let mut conn = store.connection.lock().unwrap();
    let saved = planning::save(&mut conn, None, input(&ids[..1])).unwrap();
    let base = serde_json::to_value(input(&ids[..1])).unwrap();
    for (field, invalid) in [
        ("title", json!(" ")),
        ("title", json!("中".repeat(201))),
        ("shootDate", json!("a".repeat(101))),
        ("concept", json!("\0")),
        ("references", json!([reference("missing-photo", "")])),
    ] {
        let mut value = base.clone();
        value[field] = invalid;
        assert!(planning::save(
            &mut conn,
            Some(&saved.id),
            serde_json::from_value(value).unwrap()
        )
        .is_err());
    }
    for field in [
        "concept",
        "location",
        "team",
        "deliverables",
        "visualDirection",
        "styling",
        "props",
        "equipment",
        "preparation",
    ] {
        let mut value = base.clone();
        value[field] = json!("中".repeat(20_001));
        assert!(planning::save(
            &mut conn,
            Some(&saved.id),
            serde_json::from_value(value).unwrap()
        )
        .is_err());
    }
    let mut valid = input(&[]);
    valid.parts = vec![part()];
    valid.parts[0].shots = vec![shot(&ids[0], "")];
    valid.references = (0..planning::MAX_REFERENCES - 1)
        .map(|_| reference(&ids[0], ""))
        .collect();
    let draft = planning::save(&mut conn, None, valid.clone()).unwrap();
    planning::delete(&mut conn, &draft.id).unwrap();
    let mut invalids = vec![];
    let mut invalid = valid.clone();
    invalid.references.push(reference(&ids[0], ""));
    invalids.push(invalid);
    let mut invalid = valid.clone();
    invalid.parts = (0..21).map(|_| part()).collect();
    invalids.push(invalid);
    let mut invalid = input(&[]);
    invalid.parts = vec![part()];
    invalid.parts[0].shots = (0..101).map(|_| shot(&ids[0], "")).collect();
    invalids.push(invalid);
    let mut invalid = valid.clone();
    invalid.parts[0].id = invalid.references[0].id.clone();
    invalids.push(invalid);
    let mut invalid = valid.clone();
    invalid.parts[0].shots[0].id = "".into();
    invalids.push(invalid);
    let mut invalid = valid.clone();
    invalid.parts[0].shots[0].title = "a".repeat(201);
    invalids.push(invalid);
    let mut invalid = valid.clone();
    invalid.parts[0].time_window = "a".repeat(101);
    invalids.push(invalid);
    let mut invalid = valid.clone();
    invalid.parts[0].shots[0].references[0].intent = "中".repeat(20_001);
    invalids.push(invalid);
    for invalid in invalids {
        assert!(planning::save(&mut conn, Some(&saved.id), invalid).is_err());
    }
    let mut invalid_priority = serde_json::to_value(&valid).unwrap();
    invalid_priority["parts"][0]["shots"][0]["priority"] = json!("later");
    assert!(serde_json::from_value::<ShootPlanInput>(invalid_priority).is_err());
    assert!(planning::save(&mut conn, Some("missing-plan"), input(&[])).is_err());
    conn.execute_batch("CREATE TRIGGER fail_plan_photo BEFORE INSERT ON shoot_plan_photos BEGIN SELECT RAISE(ABORT, 'injected'); END;").unwrap();
    assert!(planning::save(&mut conn, Some(&saved.id), input(&ids)).is_err());
    assert!(planning::save(&mut conn, None, input(&ids)).is_err());
    assert_eq!(planning::list(&conn).unwrap(), [saved]);
}

#[test]
fn planning_validate_all_rejects_corrupt_documents_timestamps_and_unions() {
    let (_dir, store, ids) = setup(2);
    let mut conn = store.connection.lock().unwrap();
    planning::save(&mut conn, None, input(&ids)).unwrap();
    for sql in [
        "UPDATE shoot_plans SET document_json='{}'",
        "UPDATE shoot_plans SET document_json=NULL",
        "UPDATE shoot_plans SET document_json=json_set(document_json,'$.version',3)",
        "UPDATE shoot_plans SET document_json=json_set(document_json,'$.input.title','')",
        "UPDATE shoot_plans SET document_json=json_set(document_json,'$.input.executionDate','2027-02-29')",
        "UPDATE shoot_plans SET created_at='invalid'",
        "UPDATE shoot_plans SET updated_at='2000-01-01T00:00:00Z'",
        "UPDATE shoot_plan_photos SET position=8 WHERE position=1",
        "DELETE FROM shoot_plan_photos WHERE position=1",
    ] {
        let tx = conn.transaction().unwrap();
        tx.execute_batch(sql).unwrap();
        assert!(planning::validate_all(&tx).is_err(), "{sql}");
        tx.rollback().unwrap();
    }
    conn.execute_batch("PRAGMA foreign_keys=OFF; UPDATE shoot_plan_photos SET photo_id='missing' WHERE position=1;").unwrap();
    assert!(planning::validate_all(&conn).is_err());
}

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
            .find(|(name, _)| name == "library.sqlite")
            .unwrap()
            .1,
    )
    .unwrap();
    let conn = rusqlite::Connection::open(&database).unwrap();
    conn.execute_batch("PRAGMA foreign_keys=OFF;").unwrap();
    conn.execute_batch(sql).unwrap();
    drop(conn);
    let bytes = fs::read(database).unwrap();
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
            file["sha256"] = json!(format!("{:x}", Sha256::digest(&bytes)));
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
fn planning_restore_preserves_plans_migrates_old_backups_and_rejects_partial_or_invalid_data() {
    let (dir, store, ids) = setup(2);
    let mut draft = input(&[ids[1].clone(), ids[0].clone()]);
    let mut scene = part();
    scene.shot_list = "01 环境\n02 靠窗回头".into();
    scene.focal_length = "50mm／85mm".into();
    scene.shots = vec![shot(&ids[0], "半身")];
    draft.parts = vec![scene];
    let saved = planning::save(&mut store.connection.lock().unwrap(), None, draft).unwrap();
    let path = dir.path().join("backup.zip");
    backup::create(&store, &path).unwrap();
    let target = Store::open(dir.path().join("target")).unwrap();
    backup::restore(&target, &path).unwrap();
    let mut updated = saved.input.clone();
    updated.title = "当前策划".into();
    let updated = planning::save(
        &mut target.connection.lock().unwrap(),
        Some(&saved.id),
        updated,
    )
    .unwrap();
    backup::restore(&target, &path).unwrap();
    assert_eq!(
        planning::list(&target.connection.lock().unwrap()).unwrap(),
        [updated]
    );
    for (index, sql) in [
        "DROP TABLE shoot_plan_photos;",
        "UPDATE shoot_plans SET document_json='bad json';",
        "UPDATE shoot_plans SET document_json=NULL;",
        "UPDATE shoot_plans SET document_json=json_set(document_json,'$.input.title','');",
        "UPDATE shoot_plans SET document_json=json_set(document_json,'$.input.executionDate','2026-11-31');",
        "DELETE FROM shoot_plan_photos WHERE position=1;",
        "ALTER TABLE shoot_plans DROP COLUMN concept;",
        "DROP TABLE shoot_plan_photos; CREATE TABLE shoot_plan_photos (plan_id TEXT);",
        "UPDATE shoot_plan_photos SET position=8 WHERE position=1;",
        "UPDATE shoot_plan_photos SET photo_id='missing' WHERE position=1;",
    ]
    .iter()
    .enumerate()
    {
        let invalid = mutate_backup(dir.path(), &path, &format!("bad-{index}"), sql);
        assert!(backup::restore(&store, &invalid).is_err());
        assert_eq!(
            planning::list(&store.connection.lock().unwrap()).unwrap(),
            [saved.clone()]
        );
    }
    let v1 = mutate_backup(
        dir.path(), &path, "v1-content",
        "ALTER TABLE shoot_plans DROP COLUMN document_json; UPDATE shoot_plans SET styling='白衬衫', lighting='窗光', shot_list='靠窗回头', notes='准备服装';",
    );
    let target = Store::open(dir.path().join("v1-target")).unwrap();
    backup::restore(&target, &v1).unwrap();
    let migrated = planning::list(&target.connection.lock().unwrap())
        .unwrap()
        .remove(0);
    assert_eq!(migrated.id, saved.id);
    assert_eq!(migrated.input.parts[0].styling, "白衬衫");
    assert_eq!(migrated.input.parts[0].lighting, "窗光");
    assert_eq!(migrated.input.parts[0].shot_list, "靠窗回头");
    assert!(migrated.input.parts[0].focal_length.is_empty());
    assert!(migrated.input.parts[0].description.is_empty());
    assert!(migrated.input.styling.is_empty());
    assert!(migrated.input.props.is_empty());
    assert!(migrated.input.equipment.is_empty());
    assert!(migrated.input.execution_date.is_empty());
    assert_eq!(migrated.input.shoot_date, saved.input.shoot_date);
    assert_eq!(migrated.input.preparation, "准备服装");
    assert_eq!(
        migrated
            .input
            .references
            .iter()
            .map(|r| r.photo_id.clone())
            .collect::<Vec<_>>(),
        [ids[1].clone(), ids[0].clone()]
    );
    planning::init(&target.connection.lock().unwrap()).unwrap();
    assert_eq!(
        planning::list(&target.connection.lock().unwrap()).unwrap(),
        [migrated]
    );
    let legacy = mutate_backup(
        dir.path(),
        &path,
        "legacy",
        "DROP TABLE shoot_plan_photos; DROP TABLE shoot_plans;",
    );
    let target = Store::open(dir.path().join("legacy-target")).unwrap();
    backup::restore(&target, &legacy).unwrap();
    let mut conn = target.connection.lock().unwrap();
    assert!(planning::list(&conn).unwrap().is_empty());
    planning::save(&mut conn, None, input(&ids)).unwrap();
}

#[test]
fn planning_png_export_validates_content_and_preserves_existing_destinations() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("plan.png");
    fs::write(&path, b"existing").unwrap();
    let mut valid = Cursor::new(Vec::new());
    RgbImage::from_pixel(108, 500, Rgb([230, 230, 230]))
        .write_to(&mut valid, image::ImageFormat::Png)
        .unwrap();
    let bytes = valid.into_inner();
    for invalid in [&b"not png"[..], &bytes[..40], &[]] {
        assert!(planning_export::export_png(dir.path(), "plan", invalid).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"existing");
    }
    let mut oversized = Cursor::new(Vec::new());
    RgbImage::new(32_769, 1)
        .write_to(&mut oversized, image::ImageFormat::Png)
        .unwrap();
    assert!(planning_export::export_png(dir.path(), "plan", &oversized.into_inner()).is_err());
    // A checksum-correct IHDR isolates the pixel budget from the edge limit.
    let mut too_many_pixels = bytes.clone();
    too_many_pixels[16..20].copy_from_slice(&8000u32.to_be_bytes());
    too_many_pixels[20..24].copy_from_slice(&5001u32.to_be_bytes());
    let mut crc = u32::MAX;
    for byte in &too_many_pixels[12..29] {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320 & (0u32.wrapping_sub(crc & 1)));
        }
    }
    too_many_pixels[29..33].copy_from_slice(&(!crc).to_be_bytes());
    assert!(
        planning_export::export_png(dir.path(), "plan", &too_many_pixels)
            .unwrap_err()
            .contains("4000 万")
    );
    assert_eq!(fs::read(&path).unwrap(), b"existing");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    let exported = planning_export::export_png(dir.path(), "plan", &bytes).unwrap();
    assert_eq!(exported, dir.path().join("plan (2).png"));
    assert_eq!(fs::read(&exported).unwrap(), bytes);
    assert_eq!(fs::read(&path).unwrap(), b"existing");
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    assert!(planning_export::export_png(&dir.path().join("missing"), "plan", &bytes).is_err());
    assert!(planning_export::export_png(&path, "plan", &bytes).is_err());
    assert!(planning_export::export_png(Path::new("."), "plan", &bytes).is_err());
}

#[path = "planning_tests/compatibility.rs"]
mod compatibility;
