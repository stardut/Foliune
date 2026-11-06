use super::*;

#[test]
fn planning_old_v2_without_scene_fields_keeps_content_and_saves_explicit_defaults() {
    let (_dir, store, ids) = setup(1);
    let mut conn = store.connection.lock().unwrap();
    let mut draft = input(&[]);
    let mut scene = part();
    scene.description = "已有场景描述，不推断为镜头清单".into();
    scene.references = vec![reference(&ids[0], "原有参考")];
    draft.parts = vec![scene];
    let saved = planning::save(&mut conn, None, draft).unwrap();
    conn.execute_batch("UPDATE shoot_plans SET document_json=json_remove(document_json,'$.input.parts[0].shotList','$.input.parts[0].focalLength')").unwrap();
    planning::init(&conn).unwrap();
    let loaded = planning::list(&conn).unwrap().remove(0);
    assert_eq!(loaded, saved);
    assert!(loaded.input.parts[0].shot_list.is_empty());
    assert!(loaded.input.parts[0].focal_length.is_empty());
    let updated = planning::save(&mut conn, Some(&loaded.id), loaded.input.clone()).unwrap();
    assert_eq!(updated.input, loaded.input);
    let document: String = conn
        .query_row("SELECT document_json FROM shoot_plans", [], |row| {
            row.get(0)
        })
        .unwrap();
    let document: serde_json::Value = serde_json::from_str(&document).unwrap();
    assert_eq!(document["version"], 2);
    assert_eq!(document["input"]["parts"][0]["shotList"], "");
    assert_eq!(document["input"]["parts"][0]["focalLength"], "");
}

#[test]
fn planning_old_v2_without_execution_date_can_reopen_and_restore_but_must_set_date_to_resave() {
    let (dir, store, ids) = setup(1);
    let mut conn = store.connection.lock().unwrap();
    let mut draft = input(&ids);
    draft.shoot_date = "2026-11-07".into();
    let mut legacy = planning::save(&mut conn, None, draft).unwrap();
    conn.execute_batch(
        "UPDATE shoot_plans SET document_json=json_remove(document_json,'$.input.executionDate')",
    )
    .unwrap();
    legacy.input.execution_date.clear();
    drop(conn);
    drop(store);
    let store = Store::open(dir.path().join("managed")).unwrap();
    assert_eq!(
        planning::list(&store.connection.lock().unwrap()).unwrap(),
        [legacy.clone()]
    );
    let path = dir.path().join("old-v2-without-execution-date.zip");
    backup::create(&store, &path).unwrap();
    let target = Store::open(dir.path().join("target")).unwrap();
    backup::restore(&target, &path).unwrap();
    let mut conn = target.connection.lock().unwrap();
    let mut loaded = planning::list(&conn).unwrap().remove(0);
    assert_eq!(loaded, legacy);
    let error = planning::save(&mut conn, Some(&loaded.id), loaded.input.clone()).unwrap_err();
    assert!(error.contains("执行日期"), "{error}");
    assert_eq!(planning::list(&conn).unwrap(), [legacy]);
    loaded.input.execution_date = "9999-12-31".into();
    let updated = planning::save(&mut conn, Some(&loaded.id), loaded.input.clone()).unwrap();
    assert_eq!(updated.id, loaded.id);
    assert_eq!(updated.created_at, loaded.created_at);
    assert_eq!(updated.input, loaded.input);
    assert_eq!(planning::list(&conn).unwrap(), [updated]);
}

#[test]
fn planning_save_rejects_missing_or_invalid_execution_date_without_mutation() {
    let (_dir, store, ids) = setup(2);
    let mut conn = store.connection.lock().unwrap();
    let saved = planning::save(&mut conn, None, input(&ids[..1])).unwrap();
    let base = serde_json::to_value(input(&ids[1..])).unwrap();
    for invalid in [
        None,
        Some(""),
        Some("2026-2-07"),
        Some("2026-02-7"),
        Some("2026-02-29"),
        Some("1900-02-29"),
        Some("2026-13-01"),
        Some("2026-02-00"),
        Some("0000-01-01"),
        Some("10000-01-01"),
        Some("２０２６-11-07"),
        Some("2026-11-07T00:00:00Z"),
        Some("2026-11-07 "),
    ] {
        let mut value = base.clone();
        match invalid {
            Some(date) => value["executionDate"] = json!(date),
            None => {
                value.as_object_mut().unwrap().remove("executionDate");
            }
        }
        let draft: ShootPlanInput = serde_json::from_value(value).unwrap();
        for id in [None, Some(saved.id.as_str())] {
            let error = planning::save(&mut conn, id, draft.clone()).unwrap_err();
            assert!(error.contains("执行日期"), "{invalid:?}: {error}");
        }
        assert_eq!(planning::list(&conn).unwrap(), [saved.clone()]);
    }
    let mut earliest = saved.input;
    earliest.execution_date = "0001-01-01".into();
    let updated = planning::save(&mut conn, Some(&saved.id), earliest).unwrap();
    assert_eq!(updated.input.execution_date, "0001-01-01");
    assert_eq!(planning::list(&conn).unwrap(), [updated]);
}

#[test]
fn planning_invalid_scene_focal_length_rolls_back_without_losing_saved_content() {
    let (_dir, store, ids) = setup(1);
    let mut conn = store.connection.lock().unwrap();
    let mut draft = input(&[]);
    let mut scene = part();
    scene.focal_length = "35mm／85mm".into();
    scene.references = vec![reference(&ids[0], "保留原有参考")];
    draft.parts = vec![scene];
    let saved = planning::save(&mut conn, None, draft).unwrap();
    for invalid in ["中".repeat(planning::MAX_TEXT + 1), "50mm\0".into()] {
        let mut changed = saved.input.clone();
        changed.parts[0].focal_length = invalid;
        assert!(planning::save(&mut conn, Some(&saved.id), changed).is_err());
        assert_eq!(planning::list(&conn).unwrap(), [saved.clone()]);
    }
}

#[test]
fn planning_scene_reference_limit_allows_drafts_and_three_and_rolls_back_four() {
    let (_dir, store, ids) = setup(4);
    let mut conn = store.connection.lock().unwrap();
    let mut draft = input(&[]);
    draft.parts = vec![part(), part()];
    draft.parts[1].title = "窗边".into();
    draft.parts[1].shot_list = "01 全身\n02 半身".into();
    draft.parts[1].references = ids[..3]
        .iter()
        .map(|id| reference(id, "场景参考"))
        .collect();
    // Shot references keep their existing independent allowance.
    let mut frame = shot(&ids[0], "回头");
    frame.references = ids.iter().map(|id| reference(id, "画面参考")).collect();
    draft.parts[1].shots = vec![frame];
    let saved = planning::save(&mut conn, None, draft).unwrap();
    let before: String = conn
        .query_row("SELECT document_json FROM shoot_plans", [], |row| {
            row.get(0)
        })
        .unwrap();
    let mut invalid = saved.input.clone();
    invalid.parts[1]
        .references
        .push(reference(&ids[3], "第四张"));
    let error = planning::save(&mut conn, Some(&saved.id), invalid.clone()).unwrap_err();
    assert!(error.contains("场景 2「窗边」"), "{error}");
    assert!(error.contains("最多 3 张"), "{error}");
    invalid.parts[1].title.clear();
    let error = planning::save(&mut conn, None, invalid).unwrap_err();
    assert!(error.contains("场景 2"), "{error}");
    assert_eq!(planning::list(&conn).unwrap(), [saved.clone()]);
    let after: String = conn
        .query_row("SELECT document_json FROM shoot_plans", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(before, after);
    planning::validate_all(&conn).unwrap();
    let mut invalid = saved.input.clone();
    invalid.parts[0].shot_list = "中".repeat(planning::MAX_TEXT + 1);
    assert!(planning::save(&mut conn, Some(&saved.id), invalid).is_err());
    assert_eq!(planning::list(&conn).unwrap(), [saved]);
}

#[test]
fn planning_old_v2_four_scene_references_survive_reopen_and_backup_restore() {
    let (dir, store, ids) = setup(4);
    let mut conn = store.connection.lock().unwrap();
    // Construct an offline old-v2 document using the same valid reference union.
    let mut draft = input(&ids);
    draft.parts = vec![part()];
    draft.parts[0].description = "旧版描述与参考原样保留".into();
    let mut saved = planning::save(&mut conn, None, draft).unwrap();
    saved.input.parts[0].references = std::mem::take(&mut saved.input.references);
    let mut document = json!({ "version": 2, "input": saved.input });
    for field in ["shotList", "focalLength"] {
        document["input"]["parts"][0]
            .as_object_mut()
            .unwrap()
            .remove(field);
    }
    conn.execute(
        "UPDATE shoot_plans SET document_json=?1",
        [document.to_string()],
    )
    .unwrap();
    planning::validate_all(&conn).unwrap();
    assert_eq!(planning::list(&conn).unwrap(), [saved.clone()]);
    assert!(
        planning::save(&mut conn, Some(&saved.id), saved.input.clone())
            .unwrap_err()
            .contains("最多 3 张")
    );
    drop(conn);
    drop(store);
    let store = Store::open(dir.path().join("managed")).unwrap();
    assert_eq!(
        planning::list(&store.connection.lock().unwrap()).unwrap(),
        [saved.clone()]
    );
    let path = dir.path().join("old-v2.zip");
    backup::create(&store, &path).unwrap();
    let target = Store::open(dir.path().join("target")).unwrap();
    backup::restore(&target, &path).unwrap();
    let mut conn = target.connection.lock().unwrap();
    assert_eq!(planning::list(&conn).unwrap(), [saved.clone()]);
    let mut corrected = saved.input;
    corrected.parts[0].references.pop();
    planning::save(&mut conn, Some(&saved.id), corrected).unwrap();
    assert_eq!(db::snapshot(&conn).unwrap().photos.len(), 4);
}

#[test]
fn planning_migrates_v1_once_preserving_fields_and_does_not_revive_removed_content() {
    let (dir, store, ids) = setup(2);
    let mut conn = store.connection.lock().unwrap();
    let saved = planning::save(&mut conn, None, input(&ids)).unwrap();
    conn.execute_batch("ALTER TABLE shoot_plans DROP COLUMN document_json; UPDATE shoot_plans SET shoot_date='2026-11-07', styling='  白衬衫  ', lighting='窗光', shot_list='01 半身\n02 环境', notes='携带备用衣服';").unwrap();
    planning::init(&conn).unwrap();
    let migrated = planning::list(&conn).unwrap().remove(0);
    assert_eq!(migrated.id, saved.id);
    assert_eq!(migrated.created_at, saved.created_at);
    assert_eq!(migrated.updated_at, saved.updated_at);
    assert_eq!(migrated.input.concept, saved.input.concept);
    assert_eq!(migrated.input.shoot_date, "2026-11-07");
    assert!(migrated.input.execution_date.is_empty());
    assert_eq!(migrated.input.preparation, "携带备用衣服");
    assert_eq!(migrated.input.parts[0].title, "原拍摄安排");
    assert_eq!(migrated.input.parts[0].styling, "  白衬衫  ");
    assert!(migrated.input.styling.is_empty());
    assert!(migrated.input.props.is_empty());
    assert!(migrated.input.equipment.is_empty());
    assert_eq!(migrated.input.parts[0].lighting, "窗光");
    assert_eq!(migrated.input.parts[0].shot_list, "01 半身\n02 环境");
    assert!(migrated.input.parts[0].focal_length.is_empty());
    assert!(migrated.input.parts[0].description.is_empty());
    assert!(migrated.input.parts[0].shots.is_empty());
    assert_eq!(
        migrated
            .input
            .references
            .iter()
            .map(|r| &r.photo_id)
            .collect::<Vec<_>>(),
        ids.iter().collect::<Vec<_>>()
    );
    planning::init(&conn).unwrap();
    assert_eq!(planning::list(&conn).unwrap(), [migrated.clone()]);
    drop(conn);
    drop(store);
    let store = Store::open(dir.path().join("managed")).unwrap();
    let mut conn = store.connection.lock().unwrap();
    assert_eq!(planning::list(&conn).unwrap(), [migrated.clone()]);
    let mut removed = migrated.input;
    removed.parts.clear();
    removed.references.clear();
    removed.preparation.clear();
    removed.execution_date = "2026-12-07".into();
    let updated = planning::save(&mut conn, Some(&saved.id), removed).unwrap();
    planning::init(&conn).unwrap();
    assert_eq!(planning::list(&conn).unwrap(), [updated]);
    let legacy: String = conn
        .query_row(
            "SELECT styling||lighting||shot_list||notes FROM shoot_plans",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(legacy.is_empty());
}

#[test]
fn planning_old_v2_shared_preparation_defaults_survive_reopen_backup_and_resave() {
    let (dir, store, ids) = setup(1);
    let mut conn = store.connection.lock().unwrap();
    let mut draft = input(&ids);
    draft.parts = vec![part()];
    draft.parts[0].styling = "旧场景造型与道具保持原位".into();
    let mut saved = planning::save(&mut conn, None, draft).unwrap();
    conn.execute_batch("UPDATE shoot_plans SET document_json=json_remove(document_json,'$.input.styling','$.input.props','$.input.equipment')").unwrap();
    saved.input.styling.clear();
    saved.input.props.clear();
    saved.input.equipment.clear();
    planning::init(&conn).unwrap();
    assert_eq!(planning::list(&conn).unwrap(), [saved.clone()]);
    drop(conn);
    drop(store);
    let store = Store::open(dir.path().join("managed")).unwrap();
    assert_eq!(
        planning::list(&store.connection.lock().unwrap()).unwrap(),
        [saved.clone()]
    );
    let path = dir.path().join("old-v2-shared-preparation.zip");
    backup::create(&store, &path).unwrap();
    let target = Store::open(dir.path().join("target")).unwrap();
    backup::restore(&target, &path).unwrap();
    let mut conn = target.connection.lock().unwrap();
    assert_eq!(planning::list(&conn).unwrap(), [saved.clone()]);
    let updated = planning::save(&mut conn, Some(&saved.id), saved.input).unwrap();
    assert_eq!(updated.input.parts[0].styling, "旧场景造型与道具保持原位");
    let document: String = conn
        .query_row("SELECT document_json FROM shoot_plans", [], |row| {
            row.get(0)
        })
        .unwrap();
    let document: serde_json::Value = serde_json::from_str(&document).unwrap();
    for field in ["styling", "props", "equipment"] {
        assert_eq!(document["input"][field], "");
    }
}

#[test]
fn planning_shared_preparation_rejects_long_or_nul_text_atomically() {
    let (_dir, store, ids) = setup(1);
    let mut conn = store.connection.lock().unwrap();
    let saved = planning::save(&mut conn, None, input(&ids)).unwrap();
    let before: String = conn
        .query_row("SELECT document_json FROM shoot_plans", [], |row| {
            row.get(0)
        })
        .unwrap();
    for field in ["styling", "props", "equipment"] {
        for invalid in ["中".repeat(planning::MAX_TEXT + 1), "非法\0内容".into()] {
            let mut value = serde_json::to_value(&saved.input).unwrap();
            value[field] = json!(invalid);
            let draft: ShootPlanInput = serde_json::from_value(value).unwrap();
            assert!(planning::save(&mut conn, Some(&saved.id), draft.clone()).is_err());
            assert!(planning::save(&mut conn, None, draft).is_err());
            assert_eq!(planning::list(&conn).unwrap(), [saved.clone()]);
            let after: String = conn
                .query_row("SELECT document_json FROM shoot_plans", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(before, after);
        }
    }
}
