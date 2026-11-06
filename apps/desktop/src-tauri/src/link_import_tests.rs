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
const SOURCE: &str = "https://www.instagram.com/p/Abc/";

fn image_bytes() -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    RgbImage::from_pixel(16, 12, Rgb([10, 20, 30]))
        .write_to(&mut bytes, image::ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}

fn photo(session: &Session, index: usize) -> Result<Photo, String> {
    source::prepare_photo(session, image_bytes(), index, "collection", SOURCE)
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
    let messages = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
    let received = messages.clone();
    let progress = Channel::new(move |body| {
        received.lock().unwrap().push(body.deserialize().unwrap());
        Ok(())
    });
    send_progress(&store, &session, &progress, 3, None).unwrap();
    let first = photo(&session, 0).unwrap();
    send_progress(&store, &session, &progress, 3, Some(first.clone())).unwrap();

    {
        let messages = messages.lock().unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0], serde_json::json!({"total": 3, "photo": null}));
        assert_eq!(messages[1]["photo"]["id"], first.id);
        assert_eq!(messages[1]["photo"]["source"], SOURCE);
        assert_eq!(messages[1]["photo"]["thumbnailPath"], first.thumbnail_path);
    }
    assert_eq!(first.original_name, "001.png");
    assert_eq!(first.title, "001");
    assert_eq!((first.width, first.height), (16, 12));
    assert_eq!(fs::read(&first.original_path).unwrap(), image_bytes());
    assert!(image::open(&first.thumbnail_path).is_ok());
    assert_eq!(
        fs::read_dir(session.directory.join("originals"))
            .unwrap()
            .count(),
        1
    );
    assert_eq!(count(&store), 0);

    let photos = vec![
        first.clone(),
        photo(&session, 1).unwrap(),
        photo(&session, 2).unwrap(),
    ];
    let ids: Vec<_> = photos.iter().map(|photo| photo.id.clone()).collect();
    let draft = finish_candidates(&store, &drafts, &session, photos, "collection", None).unwrap();
    assert_eq!(draft.pending_ids, ids);
    assert_eq!(draft.candidates[0].thumbnail_path, first.thumbnail_path);
    assert_eq!(count(&store), 0);
    assert_eq!(
        fs::read_dir(store.root.join("originals")).unwrap().count(),
        0
    );
    assert!(draft.candidates.iter().all(|photo| photo.source == SOURCE));
    let state = curation::commit(
        &store,
        &drafts,
        &draft.id,
        vec![draft.pending_ids[1].clone()],
    )
    .unwrap();
    assert_eq!(state.photos.len(), 1);
    assert_eq!(state.photos[0].id, draft.pending_ids[1]);
    assert_eq!(state.photos[0].source, SOURCE);
    assert_eq!(
        std::fs::read_dir(store.root.join("originals"))
            .unwrap()
            .count(),
        1
    );
    assert!(!store.root.join("staging").join(draft.id).exists());
}

#[test]
fn a_damaged_later_photo_cleans_previews_and_never_registers_a_draft() {
    let (_temporary, store, drafts, links) = setup();
    let request = uuid::Uuid::new_v4().to_string();
    let session = links.begin(store.root.clone(), &request).unwrap();
    let first = photo(&session, 0).unwrap();
    assert!(image::open(&first.thumbnail_path).is_ok());

    let mut damaged = image_bytes();
    damaged.truncate(16);
    let result =
        source::prepare_photo(&session, damaged, 1, "collection", SOURCE).and_then(|second| {
            finish_candidates(
                &store,
                &drafts,
                &session,
                vec![first, second],
                "collection",
                None,
            )
        });
    let result = links.finish_preparation(&request, &session, result);
    assert_eq!(
        result.err().as_deref(),
        Some("图片解码失败或超过尺寸/内存限制。")
    );
    assert!(!session.directory.exists());
    assert!(curation::commit(&store, &drafts, &session.id, Vec::new()).is_err());
    assert_eq!(count(&store), 0);
}

#[test]
fn cancellation_before_start_and_during_work_is_idempotent() {
    let (_temporary, store, drafts, links) = setup();
    let cancelled = uuid::Uuid::new_v4().to_string();
    assert!(links.cancel(&cancelled).unwrap().is_none());
    assert!(links.begin(store.root.clone(), &cancelled).is_err());
    let request = uuid::Uuid::new_v4().to_string();
    let session = links.begin(store.root.clone(), &request).unwrap();
    let photo = photo(&session, 0).unwrap();
    links.cancel(&request).unwrap();
    links.cancel(&request).unwrap();
    assert!(source::prepare_photo(&session, image_bytes(), 1, "collection", SOURCE).is_err());
    assert!(!session.directory.exists());
    assert!(
        finish_candidates(&store, &drafts, &session, vec![photo], "collection", None,).is_err()
    );
    assert_eq!(count(&store), 0);
}

#[test]
fn cancel_after_candidate_handoff_cleans_staged_copies() {
    let (_temporary, store, drafts, links) = setup();
    let request = uuid::Uuid::new_v4().to_string();
    let session = links.begin(store.root.clone(), &request).unwrap();
    let photo = photo(&session, 0).unwrap();
    let draft =
        finish_candidates(&store, &drafts, &session, vec![photo], "collection", None).unwrap();
    let id = links.cancel(&request).unwrap().unwrap();
    curation::cancel(&store, &drafts, &id).unwrap();
    assert_eq!(
        links.cancel(&request).unwrap().as_deref(),
        Some(id.as_str())
    );
    curation::cancel(&store, &drafts, &id).unwrap();
    assert!(!store.root.join("staging").join(draft.id).exists());
    assert_eq!(count(&store), 0);
}

#[test]
fn switch_cancellation_invalidates_the_original_request() {
    let (_temporary, store, drafts, links) = setup();
    let session = links
        .begin(store.root.clone(), &uuid::Uuid::new_v4().to_string())
        .unwrap();
    let photo = photo(&session, 0).unwrap();
    links.cancel_all().unwrap();
    assert!(
        finish_candidates(&store, &drafts, &session, vec![photo], "collection", None,).is_err()
    );
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
fn stale_library_is_rejected_before_preview_and_handoff() {
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
    let photo = photo(&session, 0).unwrap();
    let progress = Channel::new(|_| panic!("stale library must not emit progress"));
    assert!(send_progress(&store, &session, &progress, 1, Some(photo.clone())).is_err());
    assert!(
        finish_candidates(&store, &drafts, &session, vec![photo], "collection", None,).is_err()
    );
    assert_eq!(count(&store), 0);
}

#[test]
fn cancelling_concurrently_with_candidate_preparation_never_leaves_a_draft() {
    let (_temporary, store, drafts, links) = setup();
    for _ in 0..6 {
        let request = uuid::Uuid::new_v4().to_string();
        let session = links.begin(store.root.clone(), &request).unwrap();
        let barrier = std::sync::Barrier::new(2);
        std::thread::scope(|scope| {
            let worker = scope.spawn(|| {
                barrier.wait();
                let photos = (0..4)
                    .map(|index| photo(&session, index))
                    .collect::<Result<_, _>>()?;
                finish_candidates(&store, &drafts, &session, photos, "collection", None)
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
