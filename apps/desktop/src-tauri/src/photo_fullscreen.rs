use std::ffi::c_void;
use tauri::{App, Emitter, EventTarget, Manager, WebviewWindow};

extern "C" {
    fn foliune_observe_fullscreen(
        window: *mut c_void,
        context: *mut c_void,
        changed: extern "C" fn(*const c_void, bool),
        release: extern "C" fn(*mut c_void),
    );
}

extern "C" fn changed(context: *const c_void, fullscreen: bool) {
    let window = unsafe { &*context.cast::<WebviewWindow>() };
    let target = EventTarget::window(window.label());
    if let Err(error) = window.emit_to(target, "review-fullscreen-changed", fullscreen) {
        eprintln!("无法发送窗口全屏状态：{error}");
    }
}

extern "C" fn release(context: *mut c_void) {
    drop(unsafe { Box::from_raw(context.cast::<WebviewWindow>()) });
}

pub fn observe(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| std::io::Error::other("找不到主窗口"))?;
    let native_window = window.ns_window()?;
    unsafe {
        foliune_observe_fullscreen(
            native_window,
            Box::into_raw(Box::new(window)).cast(),
            changed,
            release,
        );
    }
    Ok(())
}
