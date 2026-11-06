use crate::{
    curation::{self, CurationStore},
    db::{snapshot, Store},
    groups,
    models::GroupInput,
    photos,
};
use image::{Rgb, RgbImage};
use serde_json::json;
use std::{fs, path::Path};

fn setup() -> (tempfile::TempDir, Store, CurationStore, String) {
    let root = tempfile::tempdir().unwrap();
    let store = Store::open(root.path().join("managed")).unwrap();
    let group = groups::create(
        &store.connection.lock().unwrap(),
        GroupInput {
            library: "collection".into(),
            name: "主分组".into(),
            description: String::new(),
            capacity: Some(30),
        },
    )
    .unwrap()
    .groups[0]
        .id
        .clone();
    (root, store, CurationStore::default(), group)
}

fn fixture(root: &tempfile::TempDir, name: &str) -> String {
    let path = root.path().join(name);
    RgbImage::from_pixel(16, 12, Rgb([12, 34, 56]))
        .save(&path)
        .unwrap();
    path.to_str().unwrap().into()
}

#[test]
fn album_deletion_rejects_stale_selection_and_leaves_unrelated_photos_visible() {
    let (root, store, drafts, target) = setup();
    let make_album = |name: &str| {
        groups::create(
            &store.connection.lock().unwrap(),
            GroupInput {
                library: "collection".into(),
                name: name.into(),
                description: String::new(),
                capacity: None,
            },
        )
        .unwrap()
        .groups
        .into_iter()
        .find(|group| group.name == name)
        .unwrap()
        .id
    };
    let import = |name: &str, group: Option<&str>| {
        photos::import(&store, vec![fixture(&root, name)], "collection", group)
            .unwrap()
            .imported_ids
            .remove(0)
    };
    let old = make_album("旧相簿");
    let old_orphan = import("old.png", Some(&old));
    // Before this change, album deletion only removed memberships.
    store
        .connection
        .lock()
        .unwrap()
        .execute("DELETE FROM groups WHERE id=?1", [&old])
        .unwrap();
    let standalone = import("standalone.png", None);
    let source = make_album("待删除相簿");
    let orphan = import("source.png", Some(&source));
    let draft = curation::prepare_group(&store, &drafts, &target, json!({"photoIds":[orphan]}))
        .unwrap();
    {
        let mut conn = store.connection.lock().unwrap();
        let state = crate::work_directory::runtime::delete_album(&mut conn, &source).unwrap();
        assert_eq!(state.hidden_photo_ids, [orphan.clone()]);
        assert!(state.photos.iter().any(|p| p.id == standalone));
        assert!(state.photos.iter().any(|p| p.id == old_orphan));
        assert!(groups::add(&mut conn, &target, &[orphan.clone()]).is_err());
    }
    assert!(curation::commit(&store, &drafts, &draft.id, vec![orphan]).is_err());
    assert!(snapshot(&store.connection.lock().unwrap())
        .unwrap()
        .memberships
        .is_empty());
}

#[test]
fn local_curation_keeps_only_selected_thumbnail_and_original_reference() {
    let (root, store, drafts, group) = setup();
    let source = fixture(&root, "selected.png");
    let source_bytes = fs::read(&source).unwrap();
    let skipped = fixture(&root, "skipped.png");
    let draft = curation::prepare_import_files(
        &store,
        &drafts,
        vec![source.clone(), skipped.clone()],
        "collection",
        Some(&group),
    )
    .unwrap();
    let staging = store.root.join("staging").join(&draft.id);
    assert_eq!(fs::read_dir(staging.join("originals")).unwrap().count(), 0);
    assert_eq!(fs::read_dir(staging.join("thumbnails")).unwrap().count(), 2);
    assert_eq!(draft.pending_ids.len(), 2);
    let id = &draft.pending_ids[0];
    let candidate = draft
        .candidates
        .iter()
        .find(|photo| &photo.id == id)
        .unwrap();
    let locator = crate::local_photo::locator(Path::new(&source)).unwrap();
    assert_eq!(candidate.original_path, locator);
    assert!(candidate.original_available && candidate.thumbnail_available);
    assert!(Path::new(&candidate.thumbnail_path).starts_with(staging.join("thumbnails")));

    // An unavailable candidate that is not selected must not block the others.
    fs::remove_file(&skipped).unwrap();
    let state = curation::commit(&store, &drafts, &draft.id, vec![id.clone()]).unwrap();
    assert!(!staging.exists());
    assert_eq!(
        fs::read_dir(store.root.join("originals")).unwrap().count(),
        0
    );
    assert_eq!(
        fs::read_dir(store.root.join("thumbnails")).unwrap().count(),
        1
    );
    assert_eq!(fs::read(&source).unwrap(), source_bytes);
    assert_eq!(state.photos.len(), 1);
    let photo = &state.photos[0];
    assert_eq!(&photo.id, id);
    assert_eq!(photo.original_path, locator);
    assert!(photo.original_available && photo.thumbnail_available);
    assert_eq!(state.memberships[0].photo_id, *id);
    assert_eq!(state.memberships[0].group_id, group);

    fs::rename(&source, root.path().join("moved.png")).unwrap();
    let state = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert!(!state.photos[0].original_available);
    assert!(state.photos[0].thumbnail_available);
    assert_eq!(&state.photos[0].id, id);
}

#[test]
fn local_curation_rejects_missing_or_changed_selected_original_atomically() {
    for changed in [false, true] {
        let (root, store, drafts, group) = setup();
        let valid = fixture(&root, "valid.png");
        let source = fixture(&root, "source.png");
        let valid_bytes = fs::read(&valid).unwrap();
        let draft = curation::prepare_import_files(
            &store,
            &drafts,
            vec![source.clone(), valid.clone()],
            "collection",
            Some(&group),
        )
        .unwrap();
        if changed {
            RgbImage::from_pixel(25, 21, Rgb([56, 34, 12]))
                .save(&source)
                .unwrap();
        } else {
            fs::remove_file(&source).unwrap();
        }
        let source_bytes = fs::read(&source).ok();
        let error = curation::commit(&store, &drafts, &draft.id, draft.pending_ids).unwrap_err();
        assert!(
            error.contains("source.png") && error.contains("重新导入"),
            "{error}"
        );
        if changed {
            assert!(error.contains("已变化"), "{error}");
        }
        let state = snapshot(&store.connection.lock().unwrap()).unwrap();
        assert!(state.photos.is_empty() && state.memberships.is_empty());
        assert_eq!(
            fs::read_dir(store.root.join("originals")).unwrap().count(),
            0
        );
        assert_eq!(
            fs::read_dir(store.root.join("thumbnails")).unwrap().count(),
            0
        );
        assert!(!store.root.join("staging").join(draft.id).exists());
        assert_eq!(fs::read(&valid).unwrap(), valid_bytes);
        assert_eq!(fs::read(&source).ok(), source_bytes);
    }
}

#[test]
fn thirty_plus_three_can_keep_twenty_nine_old_and_one_new() {
    let (root, store, drafts, group) = setup();
    let source = fixture(&root, "old.png");
    let old = photos::import(&store, vec![source.clone(); 30], "collection", Some(&group))
        .unwrap()
        .imported_ids;
    let other = groups::create(
        &store.connection.lock().unwrap(),
        GroupInput {
            library: "collection".into(),
            name: "另一组".into(),
            description: String::new(),
            capacity: None,
        },
    )
    .unwrap()
    .groups
    .into_iter()
    .find(|group| group.name == "另一组")
    .unwrap()
    .id;
    groups::add(
        &mut store.connection.lock().unwrap(),
        &other,
        &[old[0].clone()],
    )
    .unwrap();
    let new = fixture(&root, "new.webp");
    let draft = curation::prepare_import_files(
        &store,
        &drafts,
        vec![new.clone(); 3],
        "collection",
        Some(&group),
    )
    .unwrap();
    assert_eq!(draft.candidates.len(), 33);
    assert_eq!(draft.pending_ids.len(), 3);
    assert_eq!(
        snapshot(&store.connection.lock().unwrap())
            .unwrap()
            .photos
            .len(),
        30
    );
    let mut keep = old[1..].to_vec();
    keep.push(draft.pending_ids[0].clone());
    let state = curation::commit(&store, &drafts, &draft.id, keep).unwrap();
    assert_eq!(state.photos.len(), 31);
    assert_eq!(
        state
            .memberships
            .iter()
            .filter(|member| member.group_id == group && member.status == "active")
            .count(),
        30
    );
    assert_eq!(
        state
            .memberships
            .iter()
            .find(|member| member.group_id == group && member.photo_id == old[0])
            .unwrap()
            .status,
        "discarded"
    );
    assert_eq!(
        state
            .memberships
            .iter()
            .find(|member| member.group_id == other)
            .unwrap()
            .status,
        "active"
    );
    assert!(state.photos.iter().all(|photo| photo.original_available));
    assert!(!store.root.join("staging").join(draft.id).exists());
    assert!(std::path::Path::new(&source).exists() && std::path::Path::new(&new).exists());
}

#[test]
fn cancel_import_and_group_edit_make_no_business_changes() {
    let (root, store, drafts, group) = setup();
    let initial =
        serde_json::to_value(snapshot(&store.connection.lock().unwrap()).unwrap()).unwrap();
    let draft = curation::prepare_import_files(
        &store,
        &drafts,
        vec![fixture(&root, "new.png")],
        "collection",
        Some(&group),
    )
    .unwrap();
    curation::cancel(&store, &drafts, &draft.id).unwrap();
    assert!(!store.root.join("staging").join(draft.id).exists());
    let draft = curation::prepare_group(
        &store,
        &drafts,
        &group,
        json!({"name":"未保存","capacity":1}),
    )
    .unwrap();
    curation::cancel(&store, &drafts, &draft.id).unwrap();
    assert_eq!(
        serde_json::to_value(snapshot(&store.connection.lock().unwrap()).unwrap()).unwrap(),
        initial
    );
    assert_eq!(
        std::fs::read_dir(store.root.join("originals"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn concurrent_group_change_rejects_stale_draft_and_cleans_staging() {
    let (root, store, drafts, group) = setup();
    let draft = curation::prepare_import_files(
        &store,
        &drafts,
        vec![fixture(&root, "new.png")],
        "collection",
        Some(&group),
    )
    .unwrap();
    groups::update(
        &mut store.connection.lock().unwrap(),
        &group,
        json!({"capacity":1}),
    )
    .unwrap();
    assert!(curation::commit(&store, &drafts, &draft.id, draft.pending_ids).is_err());
    let state = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert!(state.photos.is_empty() && state.memberships.is_empty());
    assert_eq!(state.groups[0].capacity, Some(1));
    assert!(!store.root.join("staging").join(draft.id).exists());
}

#[test]
fn forged_keep_id_from_another_candidate_pool_is_rejected() {
    let (root, store, drafts, group) = setup();
    let foreign = photos::import(
        &store,
        vec![fixture(&root, "foreign.png")],
        "collection",
        None,
    )
    .unwrap()
    .imported_ids[0]
        .clone();
    let draft = curation::prepare_import_files(
        &store,
        &drafts,
        vec![fixture(&root, "new.png")],
        "collection",
        Some(&group),
    )
    .unwrap();
    assert!(curation::commit(&store, &drafts, &draft.id, vec![foreign]).is_err());
    let state = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert_eq!(state.photos.len(), 1);
    assert!(state.memberships.is_empty());
    assert!(!store.root.join("staging").join(draft.id).exists());
}

#[test]
fn restore_and_lower_capacity_share_the_same_atomic_plan() {
    let (root, store, drafts, group) = setup();
    let ids = photos::import(
        &store,
        vec![fixture(&root, "a.png"), fixture(&root, "b.png")],
        "collection",
        Some(&group),
    )
    .unwrap()
    .imported_ids;
    let draft = curation::prepare_group(&store, &drafts, &group, json!({"capacity":1})).unwrap();
    let state = curation::commit(&store, &drafts, &draft.id, vec![ids[0].clone()]).unwrap();
    assert_eq!(state.groups[0].capacity, Some(1));
    let draft = curation::prepare_group(
        &store,
        &drafts,
        &group,
        json!({"photoIds":[ids[1]],"name":"已恢复"}),
    )
    .unwrap();
    assert_eq!(draft.pending_ids, vec![ids[1].clone()]);
    let state = curation::commit(&store, &drafts, &draft.id, vec![ids[1].clone()]).unwrap();
    assert_eq!(state.groups[0].name, "已恢复");
    assert_eq!(state.photos.len(), 2);
    assert_eq!(
        state
            .memberships
            .iter()
            .find(|member| member.photo_id == ids[0])
            .unwrap()
            .status,
        "discarded"
    );
    assert_eq!(
        state
            .memberships
            .iter()
            .find(|member| member.photo_id == ids[1])
            .unwrap()
            .status,
        "active"
    );
}

#[test]
fn regions_require_bounded_coordinates_and_persist_with_photo() {
    let (root, store, _, _) = setup();
    let id = photos::import(&store, vec![fixture(&root, "a.png")], "work", None)
        .unwrap()
        .imported_ids[0]
        .clone();
    let region = json!({"id":"light","x":0.1,"y":0.2,"width":0.3,"height":0.4,"text":"窗边光"});
    photos::update(
        &mut store.connection.lock().unwrap(),
        &id,
        json!({"regions":[region]}),
    )
    .unwrap();
    let state = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert_eq!(state.photos[0].regions.len(), 1);
    assert!(photos::update(
        &mut store.connection.lock().unwrap(),
        &id,
        json!({"regions":[{"id":"bad","x":0.9,"y":0.2,"width":0.3,"height":0.4,"text":"超界"}]})
    )
    .is_err());
    assert_eq!(
        snapshot(&store.connection.lock().unwrap()).unwrap().photos[0].regions[0].text,
        "窗边光"
    );
}

#[test]
fn curation_sql_failure_rolls_back_records_members_capacity_and_files() {
    let (root, store, drafts, group) = setup();
    let old_source = fixture(&root, "old.png");
    let old = photos::import(&store, vec![old_source.clone()], "collection", Some(&group))
        .unwrap()
        .imported_ids[0]
        .clone();
    let baseline =
        serde_json::to_value(snapshot(&store.connection.lock().unwrap()).unwrap()).unwrap();
    let new_source = fixture(&root, "new.png");
    let draft = curation::prepare_import_files(
        &store,
        &drafts,
        vec![new_source.clone(), new_source.clone()],
        "collection",
        Some(&group),
    )
    .unwrap();
    store
        .connection
        .lock()
        .unwrap()
        .execute_batch(
            "CREATE TRIGGER g07_fail_membership BEFORE INSERT ON memberships
         BEGIN SELECT RAISE(ABORT, 'g07 forced SQL write failure'); END;",
        )
        .unwrap();
    // 提交先写新照片、缩略图并废弃旧成员，再在新增成员的 SQL 写入处失败。
    let failure = curation::commit(
        &store,
        &drafts,
        &draft.id,
        vec![draft.pending_ids[0].clone()],
    )
    .unwrap_err();
    assert!(
        failure.contains("g07 forced SQL write failure"),
        "{failure}"
    );
    let after = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert_eq!(serde_json::to_value(&after).unwrap(), baseline);
    assert_eq!(after.memberships[0].photo_id, old);
    assert_eq!(after.memberships[0].status, "active");
    assert_eq!(after.groups[0].capacity, Some(30));
    assert!(!store.root.join("staging").join(&draft.id).exists());
    assert_eq!(
        std::fs::read_dir(store.root.join("originals"))
            .unwrap()
            .count(),
        1
    );
    assert_eq!(
        std::fs::read_dir(store.root.join("thumbnails"))
            .unwrap()
            .count(),
        1
    );
    assert!(std::path::Path::new(&old_source).is_file());
    assert!(std::path::Path::new(&new_source).is_file());

    // 同一受控 SQL 失败也必须回滚本次上限、名称及恢复/加入选择。
    let candidate = photos::import(&store, vec![new_source], "collection", None)
        .unwrap()
        .imported_ids[0]
        .clone();
    let baseline =
        serde_json::to_value(snapshot(&store.connection.lock().unwrap()).unwrap()).unwrap();
    let draft = curation::prepare_group(
        &store,
        &drafts,
        &group,
        json!({"photoIds":[candidate],"capacity":1,"name":"不得部分保存"}),
    )
    .unwrap();
    let failure =
        curation::commit(&store, &drafts, &draft.id, draft.pending_ids.clone()).unwrap_err();
    assert!(
        failure.contains("g07 forced SQL write failure"),
        "{failure}"
    );
    let after = snapshot(&store.connection.lock().unwrap()).unwrap();
    assert_eq!(serde_json::to_value(&after).unwrap(), baseline);
    assert_eq!(after.groups[0].capacity, Some(30));
    assert_eq!(after.groups[0].name, "主分组");
    assert_eq!(after.memberships.len(), 1);
    assert_eq!(after.memberships[0].status, "active");
    assert_eq!(
        std::fs::read_dir(store.root.join("staging"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        std::fs::read_dir(store.root.join("originals"))
            .unwrap()
            .count(),
        2
    );
    assert_eq!(
        std::fs::read_dir(store.root.join("thumbnails"))
            .unwrap()
            .count(),
        2
    );
}
