use super::*;
use std::{cell::RefCell, collections::HashMap};

#[derive(Default)]
struct MemoryKeys {
    values: RefCell<HashMap<String, String>>,
    fail: bool,
}
impl Credentials for MemoryKeys {
    fn has(&self, provider: &str) -> Result<bool, String> {
        Ok(self.values.borrow().contains_key(provider))
    }
    fn set(&self, provider: &str, key: &str) -> Result<(), String> {
        if self.fail {
            return Err("凭据库不可用".into());
        }
        self.values.borrow_mut().insert(provider.into(), key.into());
        Ok(())
    }
    fn delete(&self, provider: &str) -> Result<(), String> {
        if self.fail {
            return Err("凭据库不可用".into());
        }
        self.values.borrow_mut().remove(provider);
        Ok(())
    }
}
fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    init(&conn).unwrap();
    conn
}
fn input(provider: &str, key: Option<&str>) -> SettingsInput {
    SettingsInput {
        provider: provider.into(),
        model: "test-model".into(),
        vision: true,
        api_key: key.map(str::to_string),
    }
}
#[test]
fn fresh_library_has_no_implicit_connection_or_callable_default() {
    let conn = database();
    let keys = MemoryKeys::default();
    let state = settings(&conn, &keys).unwrap();
    assert!(state.connection.is_none());
    for name in ["openai", "anthropic", "deepseek"] {
        assert!(config(&conn, name).is_err());
    }
}
#[test]
fn switching_replaces_the_only_connection_without_reusing_or_deleting_other_keys() {
    let conn = database();
    let keys = MemoryKeys::default();
    save(&conn, input("openai", Some("openai-secret")), &keys).unwrap();
    keys.set("deepseek", "previous-system-key").unwrap();
    assert!(save(&conn, input("deepseek", None), &keys).is_err());
    save(&conn, input("deepseek", Some("deepseek-secret")), &keys).unwrap();
    assert!(config(&conn, "openai").is_err());
    assert!(config(&conn, "deepseek").is_ok());
    assert!(keys.has("openai").unwrap());
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM ai_connection", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert!(conn
        .execute("INSERT INTO ai_connection VALUES(2,'openai','x',1)", [])
        .is_err());
    let json = serde_json::to_string(&settings(&conn, &keys).unwrap()).unwrap();
    assert!(!json.contains("secret"));
    assert_eq!(
        conn.query_row("SELECT model FROM ai_connection", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "test-model"
    );
}
#[test]
fn same_connection_keeps_key_and_removal_disables_calls() {
    let conn = database();
    let keys = MemoryKeys::default();
    keys.set("openai", "key").unwrap();
    keys.set("deepseek", "other").unwrap();
    save(&conn, input("openai", Some("key")), &keys).unwrap();
    save(&conn, input("openai", None), &keys).unwrap();
    assert!(remove(&conn, "deepseek", &keys).is_err());
    remove(&conn, "openai", &keys).unwrap();
    init(&conn).unwrap();
    assert!(settings(&conn, &keys).unwrap().connection.is_none());
    assert!(!keys.has("openai").unwrap());
    assert!(keys.has("deepseek").unwrap());
    assert!(config(&conn, "openai").is_err());
}
#[test]
fn credential_failures_do_not_commit_connection_changes() {
    let conn = database();
    let keys = MemoryKeys::default();
    save(&conn, input("openai", Some("key")), &keys).unwrap();
    let unavailable = MemoryKeys {
        fail: true,
        ..Default::default()
    };
    assert!(save(&conn, input("deepseek", Some("new-key")), &unavailable).is_err());
    assert_eq!(
        settings(&conn, &keys).unwrap().connection.unwrap().provider,
        "openai"
    );
    assert!(remove(&conn, "openai", &unavailable).is_err());
    assert!(config(&conn, "openai").is_ok());
}
#[test]
fn invalid_settings_are_rejected_before_mutating_state() {
    let conn = database();
    let keys = MemoryKeys::default();
    for name in ["unknown", "", "OPENAI"] {
        assert!(save(&conn, input(name, Some("key")), &keys).is_err());
    }
    let mut bad = input("openai", Some("key"));
    bad.model = "has space".into();
    assert!(save(&conn, bad, &keys).is_err());
    assert!(save(&conn, input("openai", Some("key\nvalue")), &keys).is_err());
    assert!(settings(&conn, &keys).unwrap().connection.is_none());
    assert!(keys.values.borrow().is_empty());
}
