use super::*;
use crate::{db::Store, photos};
use image::{Rgb, RgbImage};
use serde_json::json;

struct Fixture {
    dir: tempfile::TempDir,
    store: Store,
    originals: Vec<PathBuf>,
    ids: Vec<String>,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().join("library")).unwrap();
        let originals: Vec<_> = [(21, 12), (12, 21), (16, 16)]
            .into_iter()
            .enumerate()
            .map(|(i, (width, height))| {
                let path = dir.path().join(format!("Window-{i}.jpg"));
                RgbImage::from_pixel(width, height, Rgb([22, 70, 90]))
                    .save(&path)
                    .unwrap();
                path
            })
            .collect();
        let paths = originals
            .iter()
            .map(|path| path.to_str().unwrap().to_string())
            .collect();
        let ids = photos::import_local(&store, paths, "collection", None)
            .unwrap()
            .0
            .imported_ids;
        Self {
            dir,
            store,
            originals,
            ids,
        }
    }

    fn execute(&self, args: &[&str]) -> Result<Value, Failure> {
        let cli = ["foliune", "--library", self.store.root.to_str().unwrap()];
        execute(Arguments::try_parse_from(cli.into_iter().chain(args.iter().copied())).unwrap())
    }

    fn json(&self, args: &[&str]) -> Value {
        self.execute(args)
            .unwrap_or_else(|err| panic!("{args:?}: {} {}", err.code, err.message))
    }

    fn with_input(&self, args: &[&str], data: Value) -> Result<Value, Failure> {
        let path = self
            .dir
            .path()
            .join(format!("{}.json", uuid::Uuid::new_v4()));
        fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
        let mut args = args.to_vec();
        args.extend(["--file", path.to_str().unwrap()]);
        self.execute(&args)
    }

    fn edit(&self, args: &[&str], data: Value) -> Value {
        self.with_input(args, data)
            .unwrap_or_else(|err| panic!("{args:?}: {} {}", err.code, err.message))
    }

    fn desktop_snapshot(&self) -> crate::models::Snapshot {
        db::snapshot(&self.store.connection.lock().unwrap()).unwrap()
    }
}

fn string<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap()
}

#[test]
fn planning_cli_round_trip_and_desktop_conflict() {
    let f = Fixture::new();
    let references = json!([
        {"id":"overall-1", "photoId":f.ids[1], "intent":"保留站姿"},
        {"id":"overall-2", "photoId":f.ids[0], "intent":"借用窗光"}
    ]);
    let plan = f.edit(
        &["plan", "create"],
        json!({"title":"窗边人像", "executionDate":"2026-11-14", "references":references}),
    );
    let id = string(&plan, "id");
    let revision = string(&plan, "revision");
    let page = f.json(&["plan", "search", "窗边", "--limit", "1"]);
    assert_eq!(page["total"], 1);
    assert_eq!(page["items"][0]["id"], id);
    assert_eq!(f.json(&["plan", "show", id])["references"], references);
    assert_eq!(
        f.json(&["plan", "search", "窗边", "--offset", "1"])["items"],
        json!([])
    );

    let update = ["plan", "update", id, "--revision", revision];
    let bad = f.with_input(&update, json!({"parts":[{"id":"scene", "references":[{"id":"unknown", "photoId":"missing", "intent":""}]}]}));
    assert!(bad.is_err());
    assert_eq!(f.json(&["plan", "show", id]), plan);
    let edited = f.edit(&update, json!({"visualDirection":"下午侧光", "parts":[{"id":"scene","title":"窗边","shots":[{"id":"shot","title":"转头","priority":"must"}]}]}));
    assert_eq!(edited["references"], references);
    assert_eq!(edited["parts"][0]["shots"][0]["priority"], "must");
    let conflict = f.with_input(&update, json!({"title":"过期标题"}));
    assert!(matches!(
        conflict,
        Err(Failure {
            code: "REVISION_CONFLICT",
            ..
        })
    ));
    let mut desktop = f.store.connection.lock().unwrap();
    let current = crate::planning::get(&desktop, id).unwrap();
    assert_eq!(current.input.visual_direction, "下午侧光");
    let mut input = current.input;
    input.visual_direction = "桌面侧光".into();
    let saved = db::write(&mut desktop, |conn| {
        crate::planning::update(conn, id, &current.updated_at, input)
    })
    .unwrap();
    assert_ne!(saved.updated_at, current.updated_at);
    drop(desktop);
    assert_eq!(f.json(&["plan", "show", id])["visualDirection"], "桌面侧光");
    assert!(matches!(
        f.execute(&[
            "plan",
            "delete",
            id,
            "--revision",
            string(&edited, "revision")
        ]),
        Err(Failure {
            code: "REVISION_CONFLICT",
            ..
        })
    ));
    assert_eq!(
        f.json(&["plan", "delete", id, "--revision", &saved.updated_at])["id"],
        id
    );
    assert!(matches!(
        f.execute(&["plan", "show", id]),
        Err(Failure {
            code: "NOT_FOUND",
            ..
        })
    ));
}

#[test]
fn album_and_photo_edits_preserve_originals_and_rollback_capacity_errors() {
    let f = Fixture::new();
    let original = fs::read(&f.originals[0]).unwrap();
    let album = f.edit(
        &["album", "create"],
        json!({"name":"窗边", "library":"collection", "capacity":2}),
    );
    let id = string(&album, "id");
    assert_eq!(f.json(&["album", "list", "--kind", "work"])["total"], 0);
    assert_eq!(
        f.json(&["album", "list", "--kind", "collection"])["items"][0]["id"],
        id
    );
    let first = f.ids[0].as_str();
    let second = f.ids[1].as_str();
    let third = f.ids[2].as_str();
    assert!(f
        .execute(&["album", "add", id, first, second, third])
        .is_err());
    assert!(f.desktop_snapshot().memberships.is_empty());
    f.json(&["album", "add", id, first, second]);
    let cover = json!({"photoId":first,"offsetX":0.2,"offsetY":0.8,"zoom":2.0});
    assert_eq!(
        f.edit(&["album", "update", id], json!({"cover":cover}))["cover"],
        cover
    );
    assert!(f
        .with_input(&["album", "update", id], json!({"capacity":1}))
        .is_err());
    f.json(&["album", "discard", id, first]);
    f.json(&["album", "add", id, third]);
    assert!(f.execute(&["album", "restore", id, first]).is_err());
    assert_eq!(
        f.json(&["album", "show", id])["memberships"][0]["status"],
        "discarded"
    );
    f.json(&["album", "discard", id, third]);
    f.json(&["album", "restore", id, first]);
    f.edit(
        &["photo", "update", first],
        json!({"title":"室内侧光", "tags":["窗光"], "annotation":"低调"}),
    );
    assert_eq!(f.json(&["photo", "show", first])["annotation"], "低调");
    assert_eq!(
        f.json(&["photo", "search", "窗光", "--album", id])["items"][0]["id"],
        first
    );
    assert!(f
        .with_input(
            &["photo", "update", first],
            json!({"originalPath":"outside"})
        )
        .is_err());
    assert_eq!(fs::read(&f.originals[0]).unwrap(), original);
    fs::remove_file(&f.originals[0]).unwrap();
    let path = f.dir.path().join("preview.jpg");
    let preview = [
        "photo",
        "preview",
        first,
        "--output",
        path.to_str().unwrap(),
    ];
    assert_eq!(f.json(&preview)["format"], "jpeg");
    let preview_bytes = fs::read(&path).unwrap();
    assert_eq!(image::load_from_memory(&preview_bytes).unwrap().width(), 21);
    assert!(matches!(
        f.execute(&preview),
        Err(Failure {
            code: "OUTPUT_ERROR",
            ..
        })
    ));
    assert_eq!(fs::read(path).unwrap(), preview_bytes);
    f.json(&["album", "delete", id]);
    assert!(f.desktop_snapshot().memberships.is_empty());
    assert!(f.originals[1].is_file());
    assert!(matches!(
        f.execute(&["album", "show", id]),
        Err(Failure {
            code: "NOT_FOUND",
            ..
        })
    ));
}

#[test]
fn book_and_model_updates_keep_unsubmitted_data_and_reject_stale_revisions() {
    let f = Fixture::new();
    let model = f.edit(&["model", "create"], json!({"name":"林","city":"杭州","contact":"私人联系方式","photoIds":f.ids,"coverPhotoId":f.ids[2]}));
    let model_id = string(&model, "id");
    let found = f.json(&["model", "search", "杭州"]);
    assert_eq!(found["items"][0]["id"], model_id);
    assert!(found["items"][0].get("contact").is_none());
    let edited_model = f.edit(
        &[
            "model",
            "update",
            model_id,
            "--revision",
            string(&model, "revision"),
        ],
        json!({"tags":["纪实"],"heightCm":172.5}),
    );
    assert_eq!(
        f.json(&["model", "show", model_id])["contact"],
        "私人联系方式"
    );
    assert_eq!(edited_model["coverPhotoId"], f.ids[2]);
    assert!(matches!(
        f.execute(&[
            "model",
            "delete",
            model_id,
            "--revision",
            string(&model, "revision")
        ]),
        Err(Failure {
            code: "REVISION_CONFLICT",
            ..
        })
    ));

    let book = f.edit(&["book", "create"], json!({"title":"窗边画册","template":"white","pageWidth":1000,"pageHeight":800,"chapters":[{"id":"chapter-1","title":"窗边","photoIds":f.ids}]}));
    let book_id = string(&book["book"], "id");
    assert_eq!(
        f.json(&["book", "search", "窗边"])["items"][0]["id"],
        book_id
    );
    let mut pages = book["versions"][0]["pages"].clone();
    pages[0]["caption"] = json!("窗边的第一张");
    let mut invalid_pages = pages.clone();
    invalid_pages[0]["items"][0]["photoId"] = json!("missing");
    let update = [
        "book",
        "update",
        book_id,
        "--revision",
        string(&book, "revision"),
    ];
    assert!(f
        .with_input(
            &update,
            json!({"title":"失败的新名","version":{"pages":invalid_pages}})
        )
        .is_err());
    assert_eq!(f.json(&["book", "show", book_id]), book);
    let edited_book = f.edit(
        &update,
        json!({"title":"新版画册","version":{"pages":pages}}),
    );
    assert_eq!(
        edited_book["versions"][0]["pages"][0]["caption"],
        "窗边的第一张"
    );
    assert_eq!(
        edited_book["versions"][0]["chapters"],
        book["versions"][0]["chapters"]
    );
    assert!(matches!(
        f.with_input(&update, json!({"title":"旧版重写"})),
        Err(Failure {
            code: "REVISION_CONFLICT",
            ..
        })
    ));
    f.json(&[
        "book",
        "delete",
        book_id,
        "--revision",
        string(&edited_book, "revision"),
    ]);
    f.json(&[
        "model",
        "delete",
        model_id,
        "--revision",
        string(&edited_model, "revision"),
    ]);
    assert_eq!(f.json(&["book", "search", ""])["total"], 0);
    assert_eq!(f.json(&["model", "search", ""])["total"], 0);
}

#[test]
fn missing_library_is_never_created_and_legacy_location_is_reused() {
    let root = tempfile::tempdir().unwrap();
    let missing = root.path().join("missing");
    let arguments = Arguments::try_parse_from([
        "foliune",
        "album",
        "list",
        "--library",
        missing.to_str().unwrap(),
    ])
    .unwrap();
    assert!(matches!(
        execute(arguments),
        Err(Failure {
            code: "LIBRARY_UNAVAILABLE",
            ..
        })
    ));
    assert!(!missing.exists());
    let id = uuid::Uuid::new_v4().to_string();
    let legacy = Store::open_direct(root.path().join("libraries").join(&id)).unwrap();
    fs::write(
        root.path().join("library-selection.json"),
        json!(id).to_string(),
    )
    .unwrap();
    let cli = db::open_existing(root.path(), false).unwrap();
    assert_eq!(db::library_root(&cli).unwrap(), legacy.root);
    assert!(cli.execute("DELETE FROM groups", []).is_err());
    assert!(!root.path().join("library.sqlite").exists());
}

#[test]
fn concurrent_writers_cannot_both_apply_the_same_document_revision() {
    let f = Fixture::new();
    let plan = f.edit(
        &["plan", "create"],
        json!({"title":"并行编辑", "executionDate":"2026-11-14"}),
    );
    let id = string(&plan, "id");
    let revision = string(&plan, "revision");
    let update = ["plan", "update", id, "--revision", revision];
    let gate = std::sync::Barrier::new(2);
    let (a, b) = std::thread::scope(|scope| {
        let a = scope.spawn(|| {
            gate.wait();
            f.with_input(&update, json!({"location":"棚内"}))
        });
        gate.wait();
        let b = f.with_input(&update, json!({"location":"室外"}));
        (a.join().unwrap(), b)
    });
    let (saved, failed) = match (a, b) {
        (Ok(saved), Err(failed)) | (Err(failed), Ok(saved)) => (saved, failed),
        _ => panic!("exactly one update should commit"),
    };
    assert_eq!(failed.code, "REVISION_CONFLICT");
    assert_eq!(f.json(&["plan", "show", id]), saved);
}
