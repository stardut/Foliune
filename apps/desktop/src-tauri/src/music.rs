use crate::db::Store;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

#[derive(Serialize)]
pub struct Track {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Default)]
pub struct MusicCache(Mutex<HashMap<String, PathBuf>>);
impl Drop for MusicCache {
    fn drop(&mut self) {
        if let Ok(files) = self.0.get_mut() {
            for path in files.values() {
                let _ = fs::remove_file(path);
            }
        }
    }
}

#[tauri::command]
pub async fn music_import(app: tauri::AppHandle, path: String) -> Result<Track, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let _active = store.restart_gate.require_work()?;
        let source = Path::new(&path);
        let extension = source
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !["mp3", "m4a", "wav", "ogg", "aac", "flac"].contains(&extension.as_str())
            || !source.is_file()
        {
            return Err("请选择有效的本地音乐文件".into());
        }
        let dir = store.root.join("audio");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let target = dir.join(format!("{id}.{extension}"));
        if let Err(error) = fs::copy(source, &target) {
            if target.exists() {
                fs::remove_file(&target)
                    .map_err(|cleanup| format!("复制音乐失败：{error}；清理失败：{cleanup}"))?;
            }
            return Err(format!("复制音乐失败：{error}"));
        }
        app.state::<MusicCache>()
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), target.clone());
        Ok(Track {
            id,
            name: source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("本地音乐")
                .into(),
            path: target.to_string_lossy().into(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn music_release(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let _active = store.restart_gate.require_work()?;
        let cache = app.state::<MusicCache>();
        let mut files = cache.0.lock().map_err(|e| e.to_string())?;
        if let Some(path) = files.get(&id) {
            if path.exists() {
                fs::remove_file(path).map_err(|e| format!("清理音乐缓存失败：{e}"))?;
            }
            files.remove(&id);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
