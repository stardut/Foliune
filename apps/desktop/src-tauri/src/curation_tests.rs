use crate::{
    curation::{self, CurationStore},
    db::{snapshot, Store},
    groups,
    models::GroupInput,
    photos,
};
use image::{Rgb, RgbImage};
use serde_json::json;

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
    // 提交先写新照片、管理副本并废弃旧成员，再在新增成员的 SQL 写入处失败。
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
