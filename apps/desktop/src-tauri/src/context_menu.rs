use crate::locale::tr;
use tauri::{menu::Menu, Manager, ResourceId, Webview};

#[cfg(target_os = "macos")]
extern "C" {
    fn foliune_observe_context_menu(window: *mut std::ffi::c_void) -> bool;
    fn foliune_popup_context_menu(
        menu: *mut std::ffi::c_void,
        view: *mut std::ffi::c_void,
        x: f64,
        y: f64,
    ) -> bool;
}

#[cfg(target_os = "macos")]
pub fn observe(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app.get_webview_window("main").ok_or_else(|| {
        std::io::Error::other(tr("找不到主窗口", "Could not find the main window"))
    })?;
    if unsafe { foliune_observe_context_menu(window.ns_window()?) } {
        Ok(())
    } else {
        Err(std::io::Error::other(tr(
            "无法接收上下文菜单事件",
            "Could not listen for context menu events",
        ))
        .into())
    }
}

#[cfg(target_os = "macos")]
fn native_menu_pointer<T: tauri::menu::ContextMenu>(menu: &T) -> *mut std::ffi::c_void {
    menu.inner_context().ns_menu()
}

#[tauri::command]
pub async fn popup_context_menu(
    webview: Webview,
    rid: ResourceId,
    x: f64,
    y: f64,
) -> Result<(), String> {
    if !x.is_finite() || !y.is_finite() {
        return Err(tr("菜单位置无效", "Invalid menu position").into());
    }
    let window = webview.window().clone();
    if window.label() != "main" {
        return Err(tr(
            "当前窗口不支持操作菜单",
            "This window does not support action menus",
        )
        .into());
    }
    let menu = webview
        .resources_table()
        .get::<Menu<tauri::Wry>>(rid)
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let (send, receive) = std::sync::mpsc::sync_channel(1);
            let target = window.clone();
            window
                .run_on_main_thread(move || {
                    // Keep the Menu (and its raw item targets) alive until native
                    // tracking ends. The pointer is used only on this main thread.
                    let result = target
                        .ns_view()
                        .map_err(|error| error.to_string())
                        .and_then(|view| {
                            if unsafe {
                                foliune_popup_context_menu(
                                    native_menu_pointer(menu.as_ref()),
                                    view,
                                    x,
                                    y,
                                )
                            } {
                                Ok(())
                            } else {
                                Err(tr(
                                    "菜单请求已失效，请重新右键",
                                    "The menu request expired. Open the context menu again.",
                                )
                                .into())
                            }
                        });
                    let _ = send.send(result);
                })
                .map_err(|error| error.to_string())?;
            receive.recv().map_err(|error| error.to_string())?
        })
        .await
        .map_err(|error| error.to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        use tauri::menu::ContextMenu;
        menu.popup_at(window, tauri::LogicalPosition::new(x, y))
            .map_err(|error| error.to_string())
    }
}
