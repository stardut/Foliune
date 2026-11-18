use crate::locale::{display_format, tr};
use crate::{
    ai_settings::{self, AiSettings, SettingsInput, SystemCredentials},
    credentials,
    db::Store,
};
pub use ai_settings::{config, init, provider};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::params;
use serde::Serialize;
use serde_json::{json, Value};
use std::{fs, time::Duration};
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub photo_id: String,
    pub provider: String,
    pub model: String,
    pub text: String,
    pub analyzed_at: String,
}

fn request_body(provider: &str, model: &str, prompt: &str, image: Option<&str>) -> Value {
    match provider {
        "openai" => {
            let mut content = vec![json!({"type":"input_text","text":prompt})];
            if let Some(data) = image {
                content.push(json!({"type":"input_image","image_url":format!("data:image/jpeg;base64,{data}")}));
            }
            json!({"model":model,"store":false,"max_output_tokens":1800,"input":[{"role":"user","content":content}]})
        }
        "anthropic" => {
            let mut content = Vec::new();
            if let Some(data) = image {
                content.push(json!({"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":data}}));
            }
            content.push(json!({"type":"text","text":prompt}));
            json!({"model":model,"max_tokens":1800,"messages":[{"role":"user","content":content}]})
        }
        _ => {
            let mut content = vec![json!({"type":"text","text":prompt})];
            if let Some(data) = image {
                content.push(json!({"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{data}")}}));
            }
            json!({"model":model,"max_tokens":1800,"thinking":{"type":"disabled"},"messages":[{"role":"user","content":content}]})
        }
    }
}

fn response_text(provider: &str, value: &Value) -> Result<String, String> {
    let truncated = match provider {
        "openai" => value["status"] == "incomplete",
        "anthropic" => value["stop_reason"] == "max_tokens",
        _ => value
            .pointer("/choices/0/finish_reason")
            .is_some_and(|reason| reason == "length"),
    };
    if truncated {
        return Err(
            tr("AI 输出未完整结束，请缩短分析方向或选择适合的模型重试；本次结果未保存。", "The AI response was cut short. Try a shorter prompt or a different model. The result was not saved.").into(),
        );
    }
    let text = match provider {
        "openai" => value
            .get("output")
            .and_then(Value::as_array)
            .map(|outputs| {
                outputs
                    .iter()
                    .filter_map(|item| item.get("content").and_then(Value::as_array))
                    .flatten()
                    .filter(|part| part["type"] == "output_text")
                    .filter_map(|part| part["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("\n")
            }),
        "anthropic" => value.get("content").and_then(Value::as_array).map(|parts| {
            parts
                .iter()
                .filter(|part| part["type"] == "text")
                .filter_map(|part| part["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n")
        }),
        _ => value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
    .ok_or(tr(
        "AI 服务未返回可读取文本",
        "The AI service did not return readable text",
    ))?;
    if text.trim().is_empty() {
        return Err(tr(
            "AI 服务返回空内容或拒绝回答，请检查请求",
            "The AI service returned no answer. Check the request.",
        )
        .into());
    }
    Ok(text)
}

async fn request(
    provider: &str,
    model: &str,
    key: &str,
    prompt: &str,
    image: Option<&str>,
) -> Result<String, String> {
    if prompt.trim().is_empty() || prompt.chars().count() > 12000 {
        return Err(tr(
            "提示词应为 1–12000 个字符",
            "The prompt must be 1–12,000 characters",
        )
        .into());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| {
            tr(
                "无法创建 AI 网络客户端",
                "Could not initialize the AI network client",
            )
        })?;
    let endpoint = match provider {
        "openai" => "https://api.openai.com/v1/responses",
        "anthropic" => "https://api.anthropic.com/v1/messages",
        _ => "https://api.deepseek.com/chat/completions",
    };
    let mut builder = client
        .post(endpoint)
        .json(&request_body(provider, model, prompt, image));
    builder = if provider == "anthropic" {
        builder
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
    } else {
        builder.bearer_auth(key)
    };
    let mut response = builder.send().await.map_err(|error| {
        if error.is_timeout() {
            tr(
                "AI 请求超时，请稍后重试",
                "The AI request timed out. Try again later.",
            )
        } else {
            tr(
                "AI 网络请求失败，请检查网络",
                "The AI request failed. Check your network connection.",
            )
        }
    })?;
    if !response.status().is_success() {
        return Err(display_format!(
            "AI 服务返回 HTTP {}，请检查 Key、模型、额度或服务状态。",
            "The AI service returned HTTP {}. Check your API key, model, quota, or service status.",
            response.status().as_u16()
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| tr("读取 AI 响应失败", "Could not read the AI response"))?
    {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err(tr(
                "AI 响应超过大小限制",
                "The AI response exceeds the size limit",
            )
            .into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| tr("AI 响应不是有效 JSON", "The AI response is not valid JSON"))?;
    response_text(provider, &value)
}

#[tauri::command]
pub async fn ai_settings(app: tauri::AppHandle) -> Result<AiSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ai_settings::settings(
            &*app
                .state::<Store>()
                .connection
                .lock()
                .map_err(|e| e.to_string())?,
            &SystemCredentials,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn ai_save_settings(
    app: tauri::AppHandle,
    input: SettingsInput,
) -> Result<AiSettings, String> {
    crate::db::with_connection(app, move |conn| {
        ai_settings::save(conn, input, &SystemCredentials)
    })
    .await
}
#[tauri::command]
pub async fn ai_remove_settings(
    app: tauri::AppHandle,
    provider: String,
) -> Result<AiSettings, String> {
    crate::db::with_connection(app, move |conn| {
        ai_settings::remove(conn, &provider, &SystemCredentials)
    })
    .await
}
#[tauri::command]
pub fn ai_list_analyses(store: tauri::State<'_, Store>) -> Result<Vec<Analysis>, String> {
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    let mut stmt=conn.prepare("SELECT photo_id,provider,model,text,analyzed_at FROM photo_analyses ORDER BY analyzed_at DESC").map_err(|e|e.to_string())?;
    let result = stmt
        .query_map([], |row| {
            Ok(Analysis {
                photo_id: row.get(0)?,
                provider: row.get(1)?,
                model: row.get(2)?,
                text: row.get(3)?,
                analyzed_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(result)
}
#[tauri::command]
pub async fn ai_analyze_photo(
    app: tauri::AppHandle,
    photo_id: String,
    provider: String,
    prompt: Option<String>,
) -> Result<Analysis, String> {
    let store = app.state::<Store>();
    let _active = store.restart_gate.require_work()?;
    let cloned = app.clone();
    let selected = photo_id.clone();
    let service = provider.clone();
    let (model, key, image, root, revision) = tauri::async_runtime::spawn_blocking(move || {
        let state = cloned.state::<Store>();
        let conn = state.connection.lock().map_err(|e| e.to_string())?;
        let (model, vision) = config(&conn, &service)?;
        if !vision {
            return Err(tr(
                "当前模型未启用图像输入，请修改设置或使用文本任务",
                "Image input is disabled for this model. Update Settings or use a text task.",
            )
            .into());
        }
        let path: String = conn
            .query_row(
                "SELECT thumbnail_path FROM photos WHERE id=?1",
                [selected],
                |row| row.get(0),
            )
            .map_err(|_| tr("照片不存在", "Photo not found"))?;
        let bytes = fs::read(&path).map_err(|_| {
            tr(
                "缩略图缺失，请重新定位照片后重试",
                "The thumbnail is missing. Relocate the photo and try again.",
            )
        })?;
        Ok::<_, String>((
            model,
            credentials::get(&service)?,
            STANDARD.encode(bytes),
            crate::db::library_root(&conn)?,
            path,
        ))
    })
    .await
    .map_err(|e| e.to_string())??;
    let text=request(&provider,&model,&key,prompt.as_deref().unwrap_or("请用中文分析这张摄影作品的主体、色彩、光线、构图、氛围与可搜索关键词。区分观察与推测，不识别人物身份，不猜测精确拍摄地点。"),Some(&image)).await?;
    let analysis = Analysis {
        photo_id,
        provider,
        model,
        text,
        analyzed_at: chrono::Utc::now().to_rfc3339(),
    };
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    if crate::db::library_root(&conn)? != root {
        return Err(tr(
            "图库已切换，AI 结果未写入其他图库",
            "The library changed. The AI result was not saved.",
        )
        .into());
    }
    let current_path: String = conn
        .query_row(
            "SELECT thumbnail_path FROM photos WHERE id=?1",
            [&analysis.photo_id],
            |row| row.get(0),
        )
        .map_err(|_| {
            tr(
                "照片已不可用，AI 结果未保存",
                "The photo is no longer available. The AI result was not saved.",
            )
        })?;
    if current_path != revision {
        return Err(tr(
            "照片已被替换，旧照片的 AI 结果未保存",
            "The photo was replaced. The AI result for the old photo was not saved.",
        )
        .into());
    }
    conn.execute("INSERT INTO photo_analyses(photo_id,provider,model,text,analyzed_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(photo_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,text=excluded.text,analyzed_at=excluded.analyzed_at",params![analysis.photo_id,analysis.provider,analysis.model,analysis.text,analysis.analyzed_at]).map_err(|e|e.to_string())?;
    Ok(analysis)
}
#[tauri::command]
pub async fn ai_run_text(
    app: tauri::AppHandle,
    provider: String,
    prompt: String,
) -> Result<String, String> {
    let service = provider.clone();
    let (model, key) = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Store>();
        let conn = state.connection.lock().map_err(|e| e.to_string())?;
        let (model, _) = config(&conn, &service)?;
        Ok::<_, String>((model, credentials::get(&service)?))
    })
    .await
    .map_err(|e| e.to_string())??;
    request(&provider, &model, &key, &prompt, None).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_requests_have_correct_provider_structures() {
        for provider in ["openai", "anthropic", "deepseek"] {
            let body = request_body(provider, "model", "看图", Some("abc"));
            let text = body.to_string();
            assert!(text.contains("abc") && text.contains("看图"));
            assert!(!text.contains("apiKey"));
        }
        assert_eq!(request_body("openai", "m", "text", None)["store"], false);
    }
    #[test]
    fn parses_text_and_rejects_empty_or_malformed_responses() {
        assert_eq!(
            response_text(
                "openai",
                &json!({"output":[{"content":[{"type":"output_text","text":"晴天"}]}]})
            )
            .unwrap(),
            "晴天"
        );
        assert_eq!(
            response_text(
                "anthropic",
                &json!({"content":[{"type":"text","text":"晴天"}]})
            )
            .unwrap(),
            "晴天"
        );
        assert_eq!(
            response_text(
                "deepseek",
                &json!({"choices":[{"message":{"content":"晴天"}}]})
            )
            .unwrap(),
            "晴天"
        );
        assert!(response_text("openai", &json!({"output":[]})).is_err());
    }
}
