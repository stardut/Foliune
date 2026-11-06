use super::*;
use image::{Rgb, RgbImage};

fn setup() -> (tempfile::TempDir, Store, CurationStore, LinkImportStore) {
    let temporary = tempfile::tempdir().unwrap();
    let store = Store::open(temporary.path().join("managed")).unwrap();
    (
        temporary,
        store,
        CurationStore::default(),
        LinkImportStore::default(),
    )
}
fn photo(session: &Session, index: usize) -> String {
    let path = session.directory.join(format!("{index}.png"));
    RgbImage::from_pixel(16, 12, Rgb([10, 20, 30]))
        .save(&path)
        .unwrap();
    path.to_string_lossy().into_owned()
}
fn count(store: &Store) -> usize {
    db::snapshot(&store.connection.lock().unwrap())
        .unwrap()
        .photos
        .len()
}

#[test]
fn candidates_do_not_import_until_selected_subset_is_committed() {
    let (_temporary, store, drafts, links) = setup();
    let session = links
        .begin(store.root.clone(), &uuid::Uuid::new_v4().to_string())
        .unwrap();
    let paths = vec![photo(&session, 0), photo(&session, 1), photo(&session, 2)];
    let source = "https://www.instagram.com/p/Abc/";
    let draft =
        finish_candidates(&store, &drafts, &session, paths, "collection", None, source).unwrap();
    assert_eq!(count(&store), 0);
    assert_eq!(
        std::fs::read_dir(store.root.join("originals"))
            .unwrap()
            .count(),
        0
    );
    assert!(!session.directory.exists());
    assert!(draft.candidates.iter().all(|photo| photo.source == source));
    let state = curation::commit(
        &store,
        &drafts,
        &draft.id,
        vec![draft.pending_ids[1].clone()],
    )
    .unwrap();
    assert_eq!(state.photos.len(), 1);
    assert_eq!(state.photos[0].id, draft.pending_ids[1]);
    assert_eq!(state.photos[0].source, source);
    assert_eq!(
        std::fs::read_dir(store.root.join("originals"))
            .unwrap()
            .count(),
        1
    );
    assert!(!store.root.join("staging").join(draft.id).exists());
}

#[test]
fn cancellation_before_start_and_during_work_is_idempotent() {
    let (_temporary, store, drafts, links) = setup();
    let cancelled = uuid::Uuid::new_v4().to_string();
    assert!(links.cancel(&cancelled).unwrap().is_none());
    assert!(links.begin(store.root.clone(), &cancelled).is_err());
    let request = uuid::Uuid::new_v4().to_string();
    let session = links.begin(store.root.clone(), &request).unwrap();
    let path = photo(&session, 0);
    links.cancel(&request).unwrap();
    links.cancel(&request).unwrap();
    assert!(finish_candidates(
        &store,
        &drafts,
        &session,
        vec![path],
        "collection",
        None,
        "https://www.instagram.com/p/Abc/"
    )
    .is_err());
    assert_eq!(count(&store), 0);
}

#[test]
fn cancel_after_candidate_handoff_cleans_staged_copies() {
    let (_temporary, store, drafts, links) = setup();
    let request = uuid::Uuid::new_v4().to_string();
    let session = links.begin(store.root.clone(), &request).unwrap();
    let path = photo(&session, 0);
    let draft = finish_candidates(
        &store,
        &drafts,
        &session,
        vec![path],
        "collection",
        None,
        "https://www.instagram.com/p/Abc/",
    )
    .unwrap();
    let id = links.cancel(&request).unwrap().unwrap();
    curation::cancel(&store, &drafts, &id).unwrap();
    assert!(links.cancel(&request).unwrap().is_none());
    assert!(!store.root.join("staging").join(draft.id).exists());
    assert_eq!(count(&store), 0);
}

#[test]
fn switch_cancellation_invalidates_the_original_request() {
    let (_temporary, store, drafts, links) = setup();
    let session = links
        .begin(store.root.clone(), &uuid::Uuid::new_v4().to_string())
        .unwrap();
    let path = photo(&session, 0);
    links.cancel_all().unwrap();
    assert!(finish_candidates(
        &store,
        &drafts,
        &session,
        vec![path],
        "collection",
        None,
        "https://www.instagram.com/p/Abc/"
    )
    .is_err());
    assert_eq!(count(&store), 0);
}

#[test]
fn unsupported_input_and_url_boundaries_are_rejected() {
    use input::{input_url, media_allowed, target, Platform};
    use tauri::Url;
    for value in [
        "https://instagram.com.evil.test/p/Abc/",
        "https://127.0.0.1/p/a/",
        "file:///etc/passwd",
        "https://user:password@instagram.com/p/a/",
        "https://instagram.com:444/p/a/",
        "https://instagram.com/p/a/ https://instagram.com/p/b/",
    ] {
        assert!(input_url(value).is_err(), "{value}");
    }
    assert!(target(input_url("https://www.instagram.com/reel/Abc/").unwrap()).is_err());
    let target = target(
        input_url("NASA 分享 https://www.instagram.com/nasa/p/DfSi56IFwZK/?igsh=x 复制").unwrap(),
    )
    .unwrap();
    assert_eq!(target.id, "DfSi56IFwZK");
    assert_eq!(target.canonical, "https://www.instagram.com/p/DfSi56IFwZK/");
    assert!(target.url.path().contains("/nasa/"));
    assert!(input_url("分享 http://xhslink.com/a/Abc。复制")
        .unwrap()
        .as_str()
        .starts_with("https://"));
    for value in [
        "https://xhscdn.com.evil.test/a",
        "https://evilxhscdn.com/a",
        "http://s.xhscdn.com/a",
        "https://s.cdninstagram.com/a",
    ] {
        assert!(!media_allowed(&Url::parse(value).unwrap(), Platform::Xhs));
    }
    assert!(media_allowed(
        &Url::parse("https://s.xhscdn.com/a?xsec_token=abc").unwrap(),
        Platform::Xhs
    ));
}

#[test]
fn stale_library_is_rejected_before_candidate_preparation() {
    let (_temporary, store, drafts, links) = setup();
    let session = links
        .begin(
            store
                .root
                .join("libraries")
                .join(uuid::Uuid::new_v4().to_string()),
            &uuid::Uuid::new_v4().to_string(),
        )
        .unwrap();
    let path = photo(&session, 0);
    assert!(finish_candidates(
        &store,
        &drafts,
        &session,
        vec![path],
        "collection",
        None,
        "https://www.instagram.com/p/Abc/"
    )
    .is_err());
    assert_eq!(count(&store), 0);
}

#[test]
fn cancelling_concurrently_with_candidate_preparation_never_leaves_a_draft() {
    let (_temporary, store, drafts, links) = setup();
    for _ in 0..6 {
        let request = uuid::Uuid::new_v4().to_string();
        let session = links.begin(store.root.clone(), &request).unwrap();
        let paths = (0..4).map(|index| photo(&session, index)).collect();
        let barrier = std::sync::Barrier::new(2);
        std::thread::scope(|scope| {
            let worker = scope.spawn(|| {
                barrier.wait();
                finish_candidates(
                    &store,
                    &drafts,
                    &session,
                    paths,
                    "collection",
                    None,
                    "https://www.instagram.com/p/Abc/",
                )
            });
            barrier.wait();
            if let Some(id) = links.cancel(&request).unwrap() {
                curation::cancel(&store, &drafts, &id).unwrap();
            }
            let _ = worker.join().unwrap();
        });
        assert_eq!(count(&store), 0);
        assert!(!session.directory.exists());
        assert_eq!(
            std::fs::read_dir(store.root.join("staging"))
                .unwrap()
                .count(),
            0
        );
    }
}
