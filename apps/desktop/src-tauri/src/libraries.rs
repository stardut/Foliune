use crate::{
    curation::{self, CurationStore},
    db::{self, Store},
    models::Snapshot,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{Manager, State};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub id: String,
    pub name: String,
    pub path: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryList {
    pub current_id: String,
    pub libraries: Vec<LibraryInfo>,
}

pub fn info(base: &Path, id: &str) -> Result<LibraryInfo, String> {
    if id == "default" {
        return Ok(LibraryInfo {
            id: id.into(),
            name: "默认图库".into(),
            path: base.to_string_lossy().into(),
        });
    }
    uuid::Uuid::parse_str(id).map_err(|_| "无效图库标识")?;
    let root = base.join("libraries").join(id);
    let meta: LibraryInfo = serde_json::from_slice(
        &fs::read(root.join("library-info.json")).map_err(|_| "图库不存在")?,
    )
    .map_err(|_| "图库信息损坏")?;
    if meta.id != id {
        return Err("图库标识不匹配".into());
    }
    Ok(LibraryInfo {
        path: root.to_string_lossy().into(),
        ..meta
    })
}

pub fn list(store: &Store) -> Result<LibraryList, String> {
    let current = db::library_root(&*store.connection.lock().map_err(|e| e.to_string())?)?;
    let current_id = if current == store.root {
        "default".into()
    } else {
        current
            .file_name()
            .and_then(|id| id.to_str())
            .ok_or("图库路径无效")?
            .into()
    };
    let mut libraries = vec![info(&store.root, "default")?];
    let parent = store.root.join("libraries");
    if parent.exists() {
        for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if uuid::Uuid::parse_str(&id).is_ok()
                && entry.file_type().map_err(|e| e.to_string())?.is_dir()
                && entry.path().join("library-info.json").is_file()
            {
                libraries.push(info(&store.root, &id)?);
            }
        }
    }
    Ok(LibraryList {
        current_id,
        libraries,
    })
}

pub fn switch(store: &Store, drafts: &CurationStore, id: &str) -> Result<Snapshot, String> {
    let library = info(&store.root, id)?;
    let root = PathBuf::from(&library.path);
    if !root.join("library.sqlite").is_file() {
        return Err("图库数据库不存在".into());
    }
    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    if !canonical.starts_with(store.root.canonicalize().map_err(|e| e.to_string())?) {
        return Err("图库路径超出应用目录".into());
    }
    let candidate = Store::open_direct(root)?;
    let mut next = candidate
        .connection
        .into_inner()
        .map_err(|e| e.to_string())?;
    let state = db::snapshot(&next)?;
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    curation::cancel_all(store, drafts)?;
    let pointer = store.root.join("library-selection.json");
    if id == "default" {
        if pointer.exists() {
            fs::remove_file(pointer).map_err(|e| e.to_string())?;
        }
    } else {
        let temp = store
            .root
            .join(format!(".library-selection-{}.tmp", uuid::Uuid::new_v4()));
        fs::write(&temp, serde_json::to_vec(id).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if let Err(error) = fs::rename(&temp, &pointer) {
            let _ = fs::remove_file(temp);
            return Err(error.to_string());
        }
    }
    std::mem::swap(&mut *conn, &mut next);
    Ok(state)
}

#[tauri::command]
pub fn libraries_list(store: State<'_, Store>) -> Result<LibraryList, String> {
    list(&store)
}
#[tauri::command]
pub async fn libraries_switch(app: tauri::AppHandle, id: String) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        switch(&app.state::<Store>(), &app.state::<CurationStore>(), &id)
    })
    .await
    .map_err(|e| e.to_string())?
}
