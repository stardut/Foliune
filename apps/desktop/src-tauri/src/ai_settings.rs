use crate::credentials;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSettings {
    pub provider: String,
    pub model: String,
    pub vision: bool,
    pub has_key: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub connection: Option<ConnectionSettings>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsInput {
    pub provider: String,
    pub model: String,
    pub vision: bool,
    pub api_key: Option<String>,
}

pub fn provider(value: &str) -> Result<(), String> {
    if ["openai", "anthropic", "deepseek"].contains(&value) {
        Ok(())
    } else {
        Err("未知 AI 服务".into())
    }
}

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS ai_connection(id INTEGER PRIMARY KEY CHECK(id=1),provider TEXT NOT NULL CHECK(provider IN ('openai','anthropic','deepseek')),model TEXT NOT NULL,vision INTEGER NOT NULL CHECK(vision IN (0,1)));
        CREATE TABLE IF NOT EXISTS photo_analyses(photo_id TEXT PRIMARY KEY REFERENCES photos(id),provider TEXT NOT NULL,model TEXT NOT NULL,text TEXT NOT NULL,analyzed_at TEXT NOT NULL);").map_err(|e| e.to_string())?;
    Ok(())
}

pub trait Credentials {
    fn has(&self, provider: &str) -> Result<bool, String>;
    fn set(&self, provider: &str, key: &str) -> Result<(), String>;
    fn delete(&self, provider: &str) -> Result<(), String>;
}
pub struct SystemCredentials;
impl Credentials for SystemCredentials {
    fn has(&self, provider: &str) -> Result<bool, String> {
        credentials::has(provider)
    }
    fn set(&self, provider: &str, key: &str) -> Result<(), String> {
        credentials::set(provider, key)
    }
    fn delete(&self, provider: &str) -> Result<(), String> {
        credentials::delete(provider)
    }
}

fn connection(conn: &Connection) -> Result<Option<ConnectionSettings>, String> {
    conn.query_row(
        "SELECT provider,model,vision FROM ai_connection WHERE id=1",
        [],
        |row| {
            Ok(ConnectionSettings {
                provider: row.get(0)?,
                model: row.get(1)?,
                vision: row.get(2)?,
                has_key: false,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}
pub fn settings(conn: &Connection, keys: &impl Credentials) -> Result<AiSettings, String> {
    let mut connection = connection(conn)?;
    if let Some(saved) = &mut connection {
        saved.has_key = keys.has(&saved.provider)?;
    }
    Ok(AiSettings { connection })
}
pub fn config(conn: &Connection, requested: &str) -> Result<(String, bool), String> {
    provider(requested)?;
    let saved = connection(conn)?.ok_or("请先在设置中选择并保存一个 AI 接入")?;
    if saved.provider != requested {
        return Err("AI 接入已变更，请重新打开照片后重试".into());
    }
    Ok((saved.model, saved.vision))
}

pub fn save(
    conn: &Connection,
    input: SettingsInput,
    keys: &impl Credentials,
) -> Result<AiSettings, String> {
    provider(&input.provider)?;
    let model = input.model.trim();
    if model.is_empty() || model.len() > 200 || model.contains(char::is_whitespace) {
        return Err("请输入有效的模型标识".into());
    }
    let current = connection(conn)?;
    let new_key = input.api_key.as_deref();
    if let Some(key) = new_key {
        if key.trim().is_empty() || key.contains('\n') || key.contains('\r') {
            return Err("API Key 不能为空或包含换行".into());
        }
    } else if !current
        .as_ref()
        .is_some_and(|saved| saved.provider == input.provider)
        || !keys.has(&input.provider)?
    {
        return Err("请输入此提供方的 API Key".into());
    }
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    transaction.execute("INSERT INTO ai_connection(id,provider,model,vision) VALUES(1,?1,?2,?3) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,model=excluded.model,vision=excluded.vision", params![input.provider, model, input.vision]).map_err(|e| e.to_string())?;
    // 不删除其他提供方的凭据；只有明确的移除操作会删除当前提供方Key。
    if let Some(key) = new_key {
        keys.set(&input.provider, key)?;
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(AiSettings {
        connection: Some(ConnectionSettings {
            provider: input.provider,
            model: model.into(),
            vision: input.vision,
            has_key: true,
        }),
    })
}

pub fn remove(
    conn: &Connection,
    requested: &str,
    keys: &impl Credentials,
) -> Result<AiSettings, String> {
    config(conn, requested)?;
    let transaction = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    transaction
        .execute("DELETE FROM ai_connection", [])
        .map_err(|e| e.to_string())?;
    keys.delete(requested)?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(AiSettings { connection: None })
}

#[cfg(test)]
#[path = "ai_settings_tests.rs"]
mod tests;
