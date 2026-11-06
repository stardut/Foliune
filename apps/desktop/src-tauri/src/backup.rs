use crate::{
    db::{self, Store},
    models::Snapshot,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Component, Path},
};
use tauri::Manager;
use zip::ZipArchive;

#[path = "backup_create.rs"]
mod create_impl;
#[cfg(test)]
pub(crate) use create_impl::{create, create_with_mode, BackupMode};

const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;

#[path = "backup_restore.rs"]
mod restore_impl;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    format: String,
    version: u32,
    files: Vec<ManifestFile>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestFile {
    path: String,
    size: u64,
    sha256: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub path: String,
    pub photo_count: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub snapshot: Snapshot,
    pub photo_count: usize,
    pub skipped_membership_count: usize,
    pub skipped_document_count: usize,
    pub unresolved_work_photo_count: usize,
}

fn safe_name(name: &str) -> bool {
    if name == "library.sqlite" {
        return true;
    }
    let Some((directory, filename)) = name.split_once('/') else {
        return false;
    };
    matches!(directory, "originals" | "thumbnails")
        && !filename.contains(['/', '\\', ':', '\0'])
        && matches!(Path::new(filename).components().collect::<Vec<_>>().as_slice(),
            [Component::Normal(part)] if *part == filename)
}

fn recorded_filename(path: &str) -> Result<&str, String> {
    let name = path.rsplit(['/', '\\']).next().ok_or("备份照片路径无效")?;
    if name.is_empty() || !safe_name(&format!("originals/{name}")) {
        return Err("备份照片文件名无效".into());
    }
    Ok(name)
}

fn digest(path: &Path) -> Result<(u64, String), String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut buffer = [0u8; 65536];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        size += read as u64;
        hash.update(&buffer[..read]);
    }
    Ok((size, format!("{:x}", hash.finalize())))
}

pub fn restore(store: &Store, path: &Path) -> Result<RestoreResult, String> {
    let root = {
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        db::library_root(&conn)?
    };
    let staging = root.join(format!(".restoring-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let result = (|| {
        let expected = unpack_archive(path, &staging)?;
        prepare_database(&staging)?;
        validate_database_files(&staging, &expected)?;
        restore_impl::merge(store, &root, &staging.join("library.sqlite"))
    })();
    match (result, fs::remove_dir_all(&staging)) {
        (Err(error), Err(cleanup)) => Err(format!("{error}；清理恢复暂存失败：{cleanup}")),
        (Ok(result), Err(cleanup)) => {
            eprintln!("恢复已提交，清理恢复暂存失败：{cleanup}");
            Ok(result)
        }
        (result, Ok(())) => result,
    }
}

fn unpack_archive(path: &Path, staging: &Path) -> Result<HashSet<String>, String> {
    let mut archive = ZipArchive::new(fs::File::open(path).map_err(|e| e.to_string())?)
        .map_err(|_| "不是有效的 Foliune ZIP 备份")?;
    let manifest: Manifest = {
        let mut file = archive
            .by_name("manifest.json")
            .map_err(|_| "备份缺少清单")?;
        if file.size() > MAX_MANIFEST_BYTES {
            return Err("备份清单过大".into());
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes).map_err(|_| "备份清单格式无效")?
    };
    if manifest.format != "foliune-library" || manifest.version != 1 {
        return Err("不支持的备份版本".into());
    }
    let mut expected = HashSet::new();
    for entry in &manifest.files {
        if !safe_name(&entry.path)
            || !expected.insert(entry.path.clone())
            || entry.sha256.len() != 64
        {
            return Err("备份包含非法或重复路径".into());
        }
    }
    if !expected.contains("library.sqlite") || archive.len() != expected.len() + 1 {
        return Err("备份文件集合与清单不一致".into());
    }
    let mut seen = HashSet::new();
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = file.name();
        if !seen.insert(name.to_string())
            || !(name == "manifest.json" || expected.contains(name))
            || file.is_dir()
            || file
                .unix_mode()
                .is_some_and(|mode| !matches!(mode & 0o170000, 0 | 0o100000))
        {
            return Err("备份包含非法路径、链接或额外文件".into());
        }
    }
    for entry in &manifest.files {
        let mut source = archive.by_name(&entry.path).map_err(|e| e.to_string())?;
        if source.size() != entry.size {
            return Err("备份文件大小与清单不符".into());
        }
        let target = staging.join(&entry.path);
        fs::create_dir_all(target.parent().ok_or("备份路径无效")?).map_err(|e| e.to_string())?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|e| e.to_string())?;
        let limit = entry.size.checked_add(1).ok_or("备份文件大小无效")?;
        let copied = std::io::copy(&mut source.by_ref().take(limit), &mut file)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        if copied != entry.size || digest(&target)?.1 != entry.sha256 {
            return Err("备份文件校验失败".into());
        }
    }
    Ok(expected)
}

fn prepare_database(staging: &Path) -> Result<(), String> {
    let conn = Connection::open(staging.join("library.sqlite")).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA trusted_schema=OFF;")
        .map_err(|e| e.to_string())?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if integrity != "ok" {
        return Err("备份数据库完整性检查失败".into());
    }
    if conn
        .prepare(
            "SELECT 1 FROM sqlite_schema WHERE type IN ('trigger', 'view')
                     UNION ALL SELECT 1 FROM pragma_table_list WHERE type='virtual'",
        )
        .and_then(|mut statement| statement.exists([]))
        .map_err(|e| e.to_string())?
    {
        return Err("备份数据库包含不支持的触发器、视图或虚拟表".into());
    }
    // Only archives with none of these tables predate the corresponding module.
    // A partial schema can indicate lost records or references.
    let editorial_tables: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name IN
         ('model_profiles','model_photos','social_drafts','social_photos')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if editorial_tables != 0 && editorial_tables != 4 {
        return Err("备份的模特或排版数据表不完整".into());
    }
    let planning_tables: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name IN ('shoot_plans','shoot_plan_photos')",
        [], |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    if planning_tables != 0 && planning_tables != 2 {
        return Err("备份的拍摄策划数据表不完整".into());
    }
    let (has_ai_settings, has_analyses): (bool, bool) = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name IN ('ai_settings','ai_connection')),
                EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='photo_analyses')",
        [], |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;
    if has_ai_settings != has_analyses {
        return Err("备份的 AI 数据表不完整".into());
    }
    db::migrate_photos(&conn)?;
    crate::groups::init_covers(&conn)?;
    crate::ai::init(&conn)?;
    crate::model_profiles::init(&conn)?;
    crate::social::init(&conn)?;
    crate::planning::init(&conn)?;
    crate::work_directory::prepare_restore(&conn)?;
    restore_impl::validate_data(&conn)
}

fn validate_database_files(staging: &Path, expected: &HashSet<String>) -> Result<(), String> {
    let mut conn = Connection::open(staging.join("library.sqlite")).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA trusted_schema=OFF;")
        .map_err(|e| e.to_string())?;
    // Rebase paths before reading the archive as a snapshot, which probes file availability.
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let photos = {
        let mut statement = tx
            .prepare("SELECT id,original_path,thumbnail_path FROM photos")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    let mut used = HashSet::from(["library.sqlite".to_string()]);
    for (id, original, thumbnail) in photos {
        let mut path_for = |directory, old| {
            let relative = format!("{directory}/{}", recorded_filename(old)?);
            if !expected.contains(&relative) {
                return Err("备份缺少照片文件".into());
            }
            let path = staging.join(&relative);
            if used.insert(relative) {
                validate_image(&path)?;
            }
            Ok::<_, String>(path.to_string_lossy().into_owned())
        };
        let original = if crate::local_photo::is_locator(&original) {
            crate::local_photo::PREFIX.to_owned()
        } else if crate::work_directory::is_locator(&original) {
            original
        } else {
            path_for("originals", &original)?
        };
        let thumbnail = path_for("thumbnails", &thumbnail)?;
        tx.execute(
            "UPDATE photos SET original_path=?1,thumbnail_path=?2 WHERE id=?3",
            params![original, thumbnail, id],
        )
        .map_err(|e| e.to_string())?;
    }
    if used != *expected {
        return Err("备份包含数据库未引用的文件".into());
    }
    db::snapshot_with_hidden(&tx)?;
    tx.commit().map_err(|e| e.to_string())
}

fn validate_image(path: &Path) -> Result<(), String> {
    let reader = image::ImageReader::open(path)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    if !matches!(
        reader.format(),
        Some(image::ImageFormat::Jpeg | image::ImageFormat::Png | image::ImageFormat::WebP)
    ) {
        return Err("备份中照片格式不受支持".into());
    }
    reader.decode().map_err(|_| "备份中照片无法解码")?;
    Ok(())
}

#[tauri::command]
pub async fn backup_create(
    app: tauri::AppHandle,
    path: String,
    mode: create_impl::BackupMode,
) -> Result<BackupResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        create_impl::create_with_mode(&app.state::<Store>(), Path::new(&path), mode)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn backup_restore(app: tauri::AppHandle, path: String) -> Result<RestoreResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = restore(&app.state::<Store>(), Path::new(&path))?;
        crate::work_directory::wake_monitor(&app);
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_unsafe_archive_paths() {
        for path in [
            "../secret",
            "/absolute",
            "originals/../../secret",
            "originals\\file",
            "originals/a/b",
            "C:/file",
            "audio/song",
            "api-key.json",
        ] {
            assert!(!safe_name(path), "{path}");
        }
        for path in ["library.sqlite", "originals/a.jpg", "thumbnails/a.jpg"] {
            assert!(safe_name(path));
        }
    }
}
