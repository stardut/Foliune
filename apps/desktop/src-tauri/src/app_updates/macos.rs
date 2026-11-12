use super::{DownloadProgress, InstallError, DISABLED};
use crate::{db::Store, restart_gate::RestartGate, work_directory::runtime};
use std::{
    ffi::{c_void, OsStr},
    io::ErrorKind,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use tauri::{async_runtime::Mutex, ipc::Channel, AppHandle, Manager};
use tauri_plugin_updater::{Builder, Config, Error, Update, UpdaterExt};

const BUSY: &str = "请等待图库处理完成后再安装。";

extern "C" {
    fn foliune_observe_update_termination(
        context: *mut c_void,
        installing: extern "C" fn(*const c_void) -> bool,
        release: extern "C" fn(*mut c_void),
    ) -> bool;
}

extern "C" fn installing(context: *const c_void) -> bool {
    unsafe { &*context.cast::<RestartGate>() }.is_installing()
}

extern "C" fn release_gate(context: *mut c_void) {
    drop(unsafe { Box::from_raw(context.cast::<RestartGate>()) });
}

pub(super) struct AppUpdates {
    allow_http: bool,
    pending: Mutex<Option<PendingUpdate>>,
}

struct PendingUpdate {
    update: Update,
    package: Option<Vec<u8>>,
    installed: bool,
}

pub(super) fn setup(app: &AppHandle) {
    let Some(value) = app.config().plugins.0.get("updater") else {
        return;
    };
    let config = match serde_json::from_value::<Config>(value.clone()) {
        Ok(config) if !config.pubkey.trim().is_empty() && !config.endpoints.is_empty() => config,
        Ok(_) => return,
        Err(error) => {
            eprintln!("应用更新配置无效：{error}");
            return;
        }
    };
    let updater = Builder::new()
        .default_version_comparator(|current, candidate| candidate.version > current)
        .build();
    if let Err(error) = app.plugin(updater) {
        eprintln!("无法启用应用更新：{error}");
        return;
    }
    let context = Box::into_raw(Box::new(app.state::<Store>().restart_gate.clone())).cast();
    if !unsafe { foliune_observe_update_termination(context, installing, release_gate) } {
        release_gate(context);
        eprintln!("无法启用应用更新的 macOS 退出保护。");
        return;
    }
    app.manage(AppUpdates {
        allow_http: config.dangerous_insecure_transport_protocol,
        pending: Mutex::new(None),
    });
}

pub(super) async fn check(app: &AppHandle) -> Result<Option<String>, String> {
    let state = app.try_state::<AppUpdates>().ok_or(DISABLED)?;
    let mut pending = state.pending.try_lock().map_err(|_| "正在处理应用更新。")?;
    let allow_http = state.allow_http;
    let mut update = app
        .updater_builder()
        .timeout(Duration::from_secs(20))
        .configure_client(move |client| client.https_only(!allow_http))
        .build()
        .map_err(check_error)?
        .check()
        .await
        .map_err(check_error)?;
    if let Some(candidate) = &mut update {
        candidate.timeout = Some(Duration::from_secs(300));
    }
    let version = update.as_ref().map(|update| update.version.clone());
    *pending = update.map(|update| PendingUpdate {
        update,
        package: None,
        installed: false,
    });
    Ok(version)
}

pub(super) async fn download(
    app: &AppHandle,
    version: &str,
    progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let state = app.try_state::<AppUpdates>().ok_or(DISABLED)?;
    let mut pending = state.pending.try_lock().map_err(|_| "正在处理应用更新。")?;
    let pending = pending
        .as_mut()
        .filter(|item| item.update.version == version)
        .ok_or("更新版本已变化，请重新检查更新。")?;
    if pending.package.is_some() || pending.installed {
        return Ok(());
    }
    let mut downloaded = 0;
    let mut last = None::<Instant>;
    let package = pending
        .update
        .download(
            |size, total| {
                downloaded += size as u64;
                if last.is_none_or(|time| time.elapsed() >= Duration::from_millis(100))
                    || total == Some(downloaded)
                {
                    let _ = progress.send(DownloadProgress { downloaded, total });
                    last = Some(Instant::now());
                }
            },
            || {},
        )
        .await
        .map_err(download_error)?;
    pending.package = Some(package);
    Ok(())
}

pub(super) fn install_and_restart(app: &AppHandle, version: &str) -> Result<(), InstallError> {
    let state = app
        .try_state::<AppUpdates>()
        .ok_or_else(|| InstallError::new("install", DISABLED))?;
    let mut pending = state
        .pending
        .try_lock()
        .map_err(|_| InstallError::new("install", "正在处理应用更新。"))?;
    let pending = pending
        .as_mut()
        .filter(|item| item.update.version == version)
        .ok_or_else(|| InstallError::new("install", "更新版本已变化，请重新检查更新。"))?;
    if pending.package.is_none() && !pending.installed {
        return Err(InstallError::new("install", "请先下载更新。"));
    }
    let store = app.state::<Store>();
    let reservation = store
        .restart_gate
        .begin_install()
        .ok_or_else(|| InstallError::new("busy", BUSY))?;
    let result = (|| {
        if runtime::has_active_jobs(app).map_err(|error| InstallError::new("busy", error))? {
            return Err(InstallError::new("busy", BUSY));
        }
        let _connection = store
            .connection
            .try_lock()
            .map_err(|_| InstallError::new("busy", BUSY))?;
        let bundle = installed_bundle(app).map_err(|error| InstallError::new("install", error))?;
        if let Some(package) = &pending.package {
            pending.update.install(package).map_err(install_error)?;
            pending.installed = true;
            pending.package = None;
        }
        relaunch(app, &bundle)
    })();
    if result.is_ok() {
        reservation.restarting();
        app.exit(0);
    } else {
        drop(reservation);
        runtime::resume_background_work(app);
    }
    result
}

fn installed_bundle(app: &AppHandle) -> Result<PathBuf, String> {
    let binary = tauri::process::current_binary(&app.env())
        .map_err(|error| format!("无法定位已安装的 Foliune：{error}"))?;
    binary
        .parent()
        .filter(|directory| directory.ends_with("Contents/MacOS"))
        .and_then(Path::parent)
        .and_then(Path::parent)
        .filter(|bundle| bundle.extension() == Some(OsStr::new("app")))
        .map(Path::to_path_buf)
        .ok_or_else(|| "请在已安装的 Foliune.app 中安装更新。".into())
}

fn relaunch(app: &AppHandle, bundle: &Path) -> Result<(), InstallError> {
    // LaunchServices starts a new instance in its own process group and gives us
    // the launch result before we decide whether to exit the existing process.
    let output = Command::new("/usr/bin/open")
        .arg("-n")
        .arg(bundle)
        .arg("--args")
        .args(app.env().args_os.iter().skip(1))
        .stdin(Stdio::null())
        .output();
    let detail = match output {
        Ok(output) if output.status.success() => return Ok(()),
        Ok(output) => String::from_utf8_lossy(&output.stderr).trim().to_string(),
        Err(error) => error.to_string(),
    };
    eprintln!("无法重新启动更新后的 Foliune：{detail}");
    Err(InstallError::new(
        "restart",
        "更新已安装，无法重新启动。可重试，或退出后重新打开 Foliune。",
    ))
}

fn download_error(error: Error) -> String {
    match error {
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::MissingSignedVersion
        | Error::SignedVersionMismatch { .. } => "更新包的签名验证失败，请重试。".into(),
        other => {
            eprintln!("下载更新失败：{other}");
            "下载更新失败，请检查网络后重试。".into()
        }
    }
}

fn check_error(error: Error) -> String {
    eprintln!("无法检查更新：{error}");
    "暂时无法检查更新，请稍后重试。".into()
}

fn install_error(error: Error) -> InstallError {
    let message = match error {
        Error::Io(ref io)
            if io.kind() == ErrorKind::PermissionDenied
                || io.raw_os_error() == Some(libc::EROFS) =>
        {
            "系统未允许安装。请检查应用位置的写入权限，或将 Foliune 移到「应用程序」后重新打开。"
                .into()
        }
        Error::TempDirNotOnSameMountPoint => {
            "无法在应用所在磁盘准备更新。请将 Foliune 移到「应用程序」后重新打开。".into()
        }
        Error::PreviousAppNotRestored(path) => {
            format!("安装失败。原来的 Foliune 已保存在「{}」。", path.display())
        }
        other => format!("无法安装更新：{other}"),
    };
    InstallError::new("install", message)
}
