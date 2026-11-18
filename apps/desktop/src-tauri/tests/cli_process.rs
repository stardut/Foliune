use rusqlite::Connection;
use serde_json::{json, Value};
use std::process::Command;

fn cli() -> Command {
    Command::new(env!("CARGO_BIN_EXE_foliune-cli"))
}

#[test]
fn cli_help_and_version_work_without_an_open_library() {
    for args in [
        ["--help", ""],
        ["--version", ""],
        ["plan", "--help"],
        ["album", "--help"],
    ] {
        let output = cli()
            .args(args.into_iter().filter(|arg| !arg.is_empty()))
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(!output.stdout.is_empty());
        assert!(output.stderr.is_empty());
    }
}

#[test]
fn invalid_usage_and_unavailable_libraries_return_json_only_on_stderr() {
    let root = tempfile::tempdir().unwrap();
    let output = cli()
        .args(["plan", "update", "some-id", "--json"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stderr).unwrap()["code"],
        "USAGE_ERROR"
    );
    let output = cli()
        .args(["--json", "album", "list", "--library"])
        .arg(root.path())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stderr).unwrap()["code"],
        "LIBRARY_UNAVAILABLE"
    );
    assert!(!root.path().join("library.sqlite").exists());
}

#[test]
fn region_commands_update_only_eligible_photos_and_preserve_gps() {
    let library = tempfile::tempdir().unwrap();
    let conn = Connection::open(library.path().join("library.sqlite")).unwrap();
    conn.execute_batch(
        "CREATE TABLE photos (
            id TEXT PRIMARY KEY, library TEXT, title TEXT DEFAULT '', original_name TEXT DEFAULT '',
            original_path TEXT DEFAULT '', thumbnail_path TEXT DEFAULT '', width INTEGER DEFAULT 1,
            height INTEGER DEFAULT 1, tags TEXT DEFAULT '[]', annotation TEXT DEFAULT '',
            source TEXT DEFAULT '', captured_at TEXT, location TEXT, project TEXT DEFAULT '',
            imported_at TEXT DEFAULT '', regions TEXT DEFAULT '[]',
            location_region_id TEXT NOT NULL DEFAULT '', hidden_after_album_delete INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE groups (
            id TEXT PRIMARY KEY, library TEXT, name TEXT DEFAULT '', description TEXT DEFAULT '',
            capacity INTEGER, created_at TEXT DEFAULT ''
         );
         CREATE TABLE memberships (group_id TEXT, photo_id TEXT, status TEXT, position INTEGER);
         PRAGMA user_version=4;
         INSERT INTO photos (id,library,location,hidden_after_album_delete) VALUES
            ('individual','collection','文字地点',0), ('eligible','work','',0),
            ('gps','work','39.9163, 116.3972',0), ('discarded','work','',0), ('hidden','work','',1);
         INSERT INTO groups (id,library) VALUES ('work-album','work'), ('collection-album','collection');
         INSERT INTO memberships VALUES
            ('work-album','eligible','active',0), ('work-album','gps','active',1),
            ('work-album','discarded','discarded',2), ('work-album','hidden','active',3),
            ('collection-album','individual','active',0);",
    )
    .unwrap();

    let run = |args: &[&str], success: bool| {
        let output = cli()
            .arg("--library")
            .arg(library.path())
            .arg("--json")
            .args(args)
            .output()
            .unwrap();
        assert_eq!(
            output.status.success(),
            success,
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let (payload, empty) = if success {
            (&output.stdout, &output.stderr)
        } else {
            (&output.stderr, &output.stdout)
        };
        assert!(empty.is_empty());
        serde_json::from_slice::<Value>(payload).unwrap()
    };

    let read_region = |id: &str| -> (String, String) {
        conn.query_row(
            "SELECT location_region_id,location FROM photos WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    };

    let single = run(&["photo", "set-region", "individual", "北京市"], true);
    assert_eq!(single["regionId"], "CHN:CHN-1155");
    assert_eq!(single["updatedCount"], 1);
    let gps = run(&["photo", "set-region", "gps", "Beijing"], true);
    assert_eq!(gps["updatedCount"], 1);
    assert_eq!(gps["skippedGpsCount"], 0);
    let album = run(&["album", "set-region", "work-album", "Tianjin"], true);
    assert_eq!(album["updatedCount"], 2);
    assert_eq!(album["skippedGpsCount"], 0);
    let skipped = run(
        &["album", "set-region", "work-album", "Beijing", "--skip-gps"],
        true,
    );
    assert_eq!(skipped["updatedCount"], 1);
    assert_eq!(skipped["skippedGpsCount"], 1);
    assert_eq!(read_region("gps").0, "CHN:CHN-1816");
    let repeated = run(
        &[
            "album",
            "set-region",
            "work-album",
            "CHN:CHN-1155",
            "--skip-gps",
        ],
        true,
    );
    assert_eq!(repeated["updatedCount"], 0);
    assert_eq!(repeated["unchangedCount"], 1);
    assert_eq!(repeated["skippedGpsCount"], 1);
    let city = run(&["photo", "set-region", "individual", "杭州市"], true);
    assert_eq!(city["regionId"], "CHN:city-330100");
    assert_eq!(city["updatedCount"], 1);
    let repeated_city = run(&["photo", "set-region", "individual", "hangZHOU"], true);
    assert_eq!(repeated_city["regionId"], "CHN:city-330100");
    assert_eq!(repeated_city["unchangedCount"], 1);
    let ambiguous = run(&["photo", "set-region", "individual", "Suzhou"], false);
    assert_eq!(ambiguous["code"], "VALIDATION_ERROR");
    let candidates = ambiguous["message"].as_str().unwrap();
    assert!(candidates.contains("苏州市 · 江苏省（Suzhou，CHN:city-320500）"));
    assert!(candidates.contains("宿州市 · 安徽省（Suzhou，CHN:city-341300）"));
    let city_album = run(
        &[
            "album",
            "set-region",
            "work-album",
            "CHN:city-330100",
            "--skip-gps",
        ],
        true,
    );
    assert_eq!(city_album["regionId"], "CHN:city-330100");
    assert_eq!(city_album["updatedCount"], 1);
    assert_eq!(city_album["skippedGpsCount"], 1);
    run(
        &["album", "set-region", "collection-album", "Tianjin"],
        false,
    );
    run(&["photo", "set-region", "individual", "CHN:unknown"], false);
    let invalid = run(
        &["photo", "set-region", "gps", "Beijing", "--skip-gps"],
        false,
    );
    assert_eq!(invalid["code"], "USAGE_ERROR");

    let cleared = run(&["photo", "clear-region", "gps"], true);
    assert_eq!(
        cleared,
        json!({"regionId":"", "updatedCount":1, "skippedGpsCount":0, "unchangedCount":0})
    );
    let repeated_clear = run(&["photo", "clear-region", "gps"], true);
    assert_eq!(repeated_clear["updatedCount"], 0);
    assert_eq!(repeated_clear["unchangedCount"], 1);
    assert_eq!(
        run(&["photo", "clear-region", "hidden"], false)["code"],
        "NOT_FOUND"
    );

    for (id, expected_region, expected_location) in [
        ("individual", "CHN:city-330100", "文字地点"),
        ("eligible", "CHN:city-330100", ""),
        ("gps", "", "39.9163, 116.3972"),
        ("discarded", "", ""),
        ("hidden", "", ""),
    ] {
        let (region, location) = read_region(id);
        assert_eq!(
            (region.as_str(), location.as_str()),
            (expected_region, expected_location)
        );
    }
}
