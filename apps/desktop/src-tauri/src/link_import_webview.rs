use super::{
    input::{media_allowed, page_allowed, Platform, Target},
    Session,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use std::{
    collections::HashSet,
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};
use tauri::{
    utils::config::BackgroundThrottlingPolicy, Manager, Url, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Deserialize)]
struct Report {
    status: String,
    id: String,
    images: Vec<String>,
    expected: usize,
}
fn report(url: &Url, nonce: &str, target: &Target) -> Result<Vec<String>, String> {
    if url.scheme() != "foliune-link"
        || url.host_str() != Some(nonce)
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().starts_with("/result/")
        || url.path().len() > 500_000
    {
        return Err("链接解析返回地址校验失败。".into());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(&url.path()[8..])
        .map_err(|_| "链接解析返回编码无效")?;
    let report: Report = serde_json::from_slice(&bytes).map_err(|_| "链接解析返回内容无效")?;
    if report.id != target.id {
        return Err("链接解析返回的帖子不匹配。".into());
    }
    if report.status != "complete" {
        return Err(match report.status.as_str() {
            "video" => "这篇帖子没有可导入的照片。",
            "login_required" => "该帖子需要网页登录后查看；当前无痕导入不使用账号 Cookie。",
            "blocked" => "平台要求安全验证或限制访问，无法导入该帖子。",
            "unavailable" => "帖子不存在、不可见或平台暂时无法展示。",
            _ => "未能验证帖子的完整图片列表，请稍后重试或改用本地照片。",
        }
        .into());
    }
    if report.images.is_empty()
        || report.images.len() > 100
        || report.expected != report.images.len()
    {
        return Err("帖子图片列表不完整或数量超过限制。".into());
    }
    let mut seen = HashSet::new();
    for image in &report.images {
        let url = Url::parse(image).map_err(|_| "帖子图片地址无效")?;
        if !media_allowed(&url, target.platform) || !seen.insert(image) {
            return Err("帖子图片地址无效、重复或超出平台 CDN 范围。".into());
        }
    }
    Ok(report.images)
}

pub(super) async fn extract(
    app: &tauri::AppHandle,
    target: Target,
    session: &Arc<Session>,
) -> Result<Vec<String>, String> {
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let script = include_str!("link_import_extract.js").replace("__FOLIUNE_CONFIG__", &serde_json::json!({ "nonce": nonce, "id": target.id, "platform": if target.platform == Platform::Xhs { "xhs" } else { "instagram" } }).to_string());
    let (sender, receiver) = mpsc::sync_channel(1);
    let label = session.label.clone();
    let handle = app.clone();
    let session_create = session.clone();
    app.run_on_main_thread(move || {
        if session_create.check().is_err() {
            let _ = sender.try_send(Err("链接导入已取消。".into()));
            return;
        }
        let nav_sender = sender.clone();
        let nav_session = session_create.clone();
        let nav_target = target.clone();
        let result =
            WebviewWindowBuilder::new(&handle, &label, WebviewUrl::External(target.url.clone()))
                .title("Foliune 照片来源")
                .inner_size(1260.0, 900.0)
                .visible(false)
                .incognito(true)
                // The extractor waits for the post to settle while this window stays hidden.
                .background_throttling(BackgroundThrottlingPolicy::Disabled)
                .initialization_script(script)
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .on_navigation(move |url| {
                    if nav_session.check().is_err() {
                        return false;
                    }
                    if url.scheme() == "foliune-link" {
                        if url.host_str() == Some(&nonce) {
                            let _ = nav_sender.try_send(report(url, &nonce, &nav_target));
                        }
                        return false;
                    }
                    // This hook also sees subframes, including about:blank. Deny
                    // unrelated URLs without letting an iframe finish the request.
                    page_allowed(url, nav_target.platform)
                })
                .build();
        if let Err(error) = result {
            let _ = sender.try_send(Err(format!("无法创建无痕解析窗口：{error}")));
        } else if session_create.check().is_err() {
            if let Some(window) = handle.get_webview_window(&label) {
                let _ = window.destroy();
            }
        }
    })
    .map_err(|e| format!("无法启动链接解析：{e}"))?;
    let check_session = session.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        loop {
            check_session.check()?;
            match receiver.recv_timeout(Duration::from_millis(150)) {
                Ok(result) => return result,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("链接解析窗口已关闭。".into())
                }
                Err(mpsc::RecvTimeoutError::Timeout)
                    if started.elapsed() > Duration::from_secs(75) =>
                {
                    return Err("链接解析超时，未导入任何照片。".into())
                }
                Err(_) => {}
            }
        }
    })
    .await
    .map_err(|_| "链接解析任务失败".to_string())?;
    if let Some(window) = app.get_webview_window(&session.label) {
        let _ = window.destroy();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn terminal_payload_requires_nonce_target_count_and_cdn() {
        let target =
            super::super::input::target(Url::parse("https://www.instagram.com/p/Abc_12/").unwrap())
                .unwrap();
        let payload = serde_json::json!({"status":"complete","id":"Abc_12","images":["https://s.cdninstagram.com/photo.jpg?sig=x"],"expected":1});
        let url = Url::parse(&format!(
            "foliune-link://nonce/result/{}",
            URL_SAFE_NO_PAD.encode(payload.to_string())
        ))
        .unwrap();
        assert_eq!(report(&url, "nonce", &target).unwrap().len(), 1);
        assert!(report(&url, "other", &target).is_err());
        for invalid in [
            serde_json::json!({"expected":2}),
            serde_json::json!({"id":"other"}),
            serde_json::json!({"images":["https://cdninstagram.com.evil.test/p"]}),
        ] {
            let mut changed = payload.clone();
            for (key, value) in invalid.as_object().unwrap() {
                changed[key] = value.clone();
            }
            let url = Url::parse(&format!(
                "foliune-link://nonce/result/{}",
                URL_SAFE_NO_PAD.encode(changed.to_string())
            ))
            .unwrap();
            assert!(report(&url, "nonce", &target).is_err());
        }
    }
}
