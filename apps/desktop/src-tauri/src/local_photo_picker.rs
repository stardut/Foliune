use tauri::{Manager, WebviewWindow};

#[tauri::command]
pub async fn choose_local_photo_sources(window: WebviewWindow) -> Result<Vec<String>, String> {
    let store = window.state::<crate::db::Store>();
    let _active = store.restart_gate.require_work()?;
    platform::choose(window.clone()).await
}

#[cfg(target_os = "macos")]
mod platform {
    use crate::locale::{current, display_format, tr};
    use std::{
        ffi::{c_char, c_void, CStr},
        slice,
    };
    use tauri::{async_runtime, WebviewWindow};

    type PickerResult = Result<Vec<String>, String>;

    extern "C" {
        fn foliune_choose_local_photo_sources(
            window: *mut c_void,
            chinese: bool,
            context: *mut c_void,
            complete: extern "C" fn(*mut c_void, *const *const c_char, usize),
        );
    }

    extern "C" fn complete(context: *mut c_void, paths: *const *const c_char, count: usize) {
        // AppKit reports one terminal result. The strings live only through this callback.
        let result =
            unsafe { Box::from_raw(context.cast::<async_runtime::Sender<PickerResult>>()) };
        let selection = if count == 0 {
            Ok(Vec::new())
        } else {
            unsafe { slice::from_raw_parts(paths, count) }
                .iter()
                .map(|&path| {
                    if path.is_null() {
                        return Err(tr(
                            "所选项目没有可读取的本地路径",
                            "The selected item has no readable local path",
                        )
                        .into());
                    }
                    unsafe { CStr::from_ptr(path) }
                        .to_str()
                        .map(str::to_owned)
                        .map_err(|_| {
                            tr(
                                "所选项目的路径无法读取",
                                "Could not read the path of the selected item",
                            )
                            .into()
                        })
                })
                .collect()
        };
        let _ = result.try_send(selection);
    }

    pub(super) async fn choose(window: WebviewWindow) -> PickerResult {
        let (result, mut selected) = async_runtime::channel::<PickerResult>(1);
        let source = window.clone();
        window
            .run_on_main_thread(move || match source.ns_window() {
                Ok(parent) => unsafe {
                    foliune_choose_local_photo_sources(
                        parent,
                        current().is_chinese(),
                        Box::into_raw(Box::new(result)).cast(),
                        complete,
                    );
                },
                Err(error) => {
                    let _ = result.try_send(Err(display_format!(
                        "无法打开本地照片选择器：{error}",
                        "Could not open the photo picker: {error}"
                    )));
                }
            })
            .map_err(|error| {
                display_format!(
                    "无法打开本地照片选择器：{error}",
                    "Could not open the photo picker: {error}"
                )
            })?;
        selected.recv().await.ok_or(tr(
            "无法读取系统选片结果",
            "Could not read the photo picker result",
        ))?
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use crate::locale::{current, display_format, tr};
    use std::{ffi::c_void, slice};
    use tauri::{async_runtime, WebviewWindow};

    type PickerResult = Result<Vec<String>, String>;

    extern "C" {
        fn foliune_choose_local_photo_sources_windows(
            parent: *mut c_void,
            chinese: bool,
            context: *mut c_void,
            add_path: extern "C" fn(*mut c_void, *const u16, usize) -> bool,
        ) -> i32;
    }

    extern "C" fn add_path(context: *mut c_void, path: *const u16, length: usize) -> bool {
        // The native dialog passes each UTF-16 path during the synchronous call below.
        let paths = unsafe { &mut *context.cast::<Vec<String>>() };
        match String::from_utf16(unsafe { slice::from_raw_parts(path, length) }) {
            Ok(path) => {
                paths.push(path);
                true
            }
            Err(_) => false,
        }
    }

    pub(super) async fn choose(window: WebviewWindow) -> PickerResult {
        let (result, mut selected) = async_runtime::channel::<PickerResult>(1);
        let source = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = result.try_send(source.hwnd().map_err(|error| error.to_string()).and_then(
                    |parent| {
                        let mut paths = Vec::<String>::new();
                        let status = unsafe {
                            foliune_choose_local_photo_sources_windows(
                                parent.0,
                                current().is_chinese(),
                                (&mut paths as *mut Vec<String>).cast(),
                                add_path,
                            )
                        };
                        if status < 0 {
                            Err(display_format!(
                                "无法读取系统选片结果（0x{:08X}）",
                                "Could not read the photo picker result (0x{:08X})",
                                status as u32
                            ))
                        } else {
                            Ok(paths)
                        }
                    },
                ));
            })
            .map_err(|error| {
                display_format!(
                    "无法打开本地照片选择器：{error}",
                    "Could not open the photo picker: {error}"
                )
            })?;
        selected.recv().await.ok_or(tr(
            "无法读取系统选片结果",
            "Could not read the photo picker result",
        ))?
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use crate::locale::tr;

    pub(super) async fn choose(_window: tauri::WebviewWindow) -> Result<Vec<String>, String> {
        Err(tr(
            "当前平台不支持此本地选片窗口",
            "The photo picker is unavailable on this platform",
        )
        .into())
    }
}
