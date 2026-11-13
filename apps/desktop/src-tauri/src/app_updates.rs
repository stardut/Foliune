use serde::Serialize;
use tauri::{AppHandle, Manager, Webview};

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod macos;

const DISABLED: &str = "当前构建未启用应用更新。";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInfo {
    current_version: String,
    enabled: bool,
}

#[derive(Serialize)]
#[serde(tag = "stage", rename_all = "camelCase")]
pub(crate) enum UpdateProgress {
    Downloading { downloaded: u64, total: Option<u64> },
    Verifying,
    Installing,
    Restarting,
}

#[derive(Serialize)]
pub(crate) struct UpdateError {
    stage: &'static str,
    message: String,
}

impl UpdateError {
    fn new(stage: &'static str, message: impl Into<String>) -> Self {
        Self {
            stage,
            message: message.into(),
        }
    }
}

fn require_main(webview: &Webview) -> Result<(), String> {
    if webview.label() != "main" {
        return Err("请在主窗口操作应用更新。".into());
    }
    Ok(())
}

pub(crate) fn setup(_app: &AppHandle) {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    macos::setup(_app);
}

#[tauri::command]
pub(crate) fn app_update_info(app: AppHandle, webview: Webview) -> Result<UpdateInfo, String> {
    require_main(&webview)?;
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let enabled = app.try_state::<macos::AppUpdates>().is_some();
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    let enabled = false;
    Ok(UpdateInfo {
        current_version: app.package_info().version.to_string(),
        enabled,
    })
}

#[tauri::command]
pub(crate) async fn check_app_update(
    app: AppHandle,
    webview: Webview,
) -> Result<Option<String>, String> {
    require_main(&webview)?;
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return macos::check(&app).await;
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = app;
        Err(DISABLED.into())
    }
}

#[tauri::command]
pub(crate) async fn install_app_update(
    app: AppHandle,
    webview: Webview,
    version: String,
    progress: tauri::ipc::Channel<UpdateProgress>,
) -> Result<(), UpdateError> {
    require_main(&webview).map_err(|error| UpdateError::new("install", error))?;
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return macos::install_and_restart(&app, &version, progress).await;
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = (app, version, progress);
        Err(UpdateError::new("install", DISABLED))
    }
}
