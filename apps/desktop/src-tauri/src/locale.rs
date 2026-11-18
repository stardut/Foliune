use serde::Deserialize;
use std::cell::Cell;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Webview};

#[derive(Clone, Copy, Deserialize)]
pub(crate) enum Locale {
    #[serde(rename = "zh-CN")]
    Chinese,
    #[serde(rename = "en")]
    English,
}

impl Locale {
    pub(crate) fn is_chinese(self) -> bool {
        matches!(self, Self::Chinese)
    }

    pub(crate) fn text(self, chinese: &'static str, english: &'static str) -> &'static str {
        if self.is_chinese() {
            chinese
        } else {
            english
        }
    }
}

// The standalone CLI shares the library code and retains its existing messages.
static ENGLISH: AtomicBool = AtomicBool::new(false);

thread_local! {
    static STORING_SYNC_MESSAGES: Cell<bool> = const { Cell::new(false) };
}

pub(crate) fn current() -> Locale {
    if STORING_SYNC_MESSAGES.get() || !ENGLISH.load(Ordering::Relaxed) {
        Locale::Chinese
    } else {
        Locale::English
    }
}

pub(crate) fn tr(chinese: &'static str, english: &'static str) -> &'static str {
    current().text(chinese, english)
}

macro_rules! display_format {
    ($chinese:literal, $english:literal $($args:tt)*) => {
        if $crate::locale::current().is_chinese() {
            format!($chinese $($args)*)
        } else {
            format!($english $($args)*)
        }
    };
}
pub(crate) use display_format;

pub(crate) fn preserve_sync_messages() {
    // The sync worker owns its thread and stores errors for presentation on future launches.
    STORING_SYNC_MESSAGES.set(true);
}

#[tauri::command]
pub(crate) async fn set_interface_locale(
    app: AppHandle,
    webview: Webview,
    locale: Locale,
) -> Result<(), String> {
    if webview.label() != "main" {
        return Err(tr(
            "请在主窗口设置语言",
            "Set the language from the main window",
        )
        .into());
    }
    ENGLISH.store(!locale.is_chinese(), Ordering::Relaxed);
    #[cfg(target_os = "macos")]
    app.set_menu(app_menu(&app, locale).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

#[cfg(target_os = "macos")]
fn app_menu(app: &AppHandle, locale: Locale) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{
        AboutMetadata, Menu, PredefinedMenuItem as Item, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    };

    let package = app.package_info();
    let bundle = &app.config().bundle;
    let metadata = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        copyright: bundle.copyright.clone(),
        authors: bundle.publisher.clone().map(|publisher| vec![publisher]),
        ..Default::default()
    };

    let label = |chinese, english| Some(locale.text(chinese, english));
    let app_submenu = Submenu::with_items(
        app,
        &package.name,
        true,
        &[
            &Item::about(app, label("关于 Foliune", "About Foliune"), Some(metadata))?,
            &Item::separator(app)?,
            &Item::services(app, label("服务", "Services"))?,
            &Item::separator(app)?,
            &Item::hide(app, label("隐藏 Foliune", "Hide Foliune"))?,
            &Item::hide_others(app, label("隐藏其他应用", "Hide Others"))?,
            &Item::separator(app)?,
            &Item::quit(app, label("退出 Foliune", "Quit Foliune"))?,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        locale.text("文件", "File"),
        true,
        &[&Item::close_window(app, label("关闭窗口", "Close Window"))?],
    )?;
    let edit = Submenu::with_items(
        app,
        locale.text("编辑", "Edit"),
        true,
        &[
            &Item::undo(app, label("撤销", "Undo"))?,
            &Item::redo(app, label("重做", "Redo"))?,
            &Item::separator(app)?,
            &Item::cut(app, label("剪切", "Cut"))?,
            &Item::copy(app, label("复制", "Copy"))?,
            &Item::paste(app, label("粘贴", "Paste"))?,
            &Item::select_all(app, label("全选", "Select All"))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        locale.text("显示", "View"),
        true,
        &[&Item::fullscreen(
            app,
            label("切换全屏", "Toggle Full Screen"),
        )?],
    )?;
    let window = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        locale.text("窗口", "Window"),
        true,
        &[
            &Item::minimize(app, label("最小化", "Minimize"))?,
            &Item::maximize(app, label("缩放", "Zoom"))?,
            &Item::separator(app)?,
            &Item::close_window(app, label("关闭窗口", "Close Window"))?,
        ],
    )?;
    let help = Submenu::with_id(app, HELP_SUBMENU_ID, locale.text("帮助", "Help"), true)?;
    Menu::with_items(app, &[&app_submenu, &file, &edit, &view, &window, &help])
}
