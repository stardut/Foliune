use serde_json::Value;
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
