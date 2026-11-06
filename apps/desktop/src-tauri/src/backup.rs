use crate::{
    db::{self, Store},
    libraries::LibraryInfo,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Component, Path},
};
use tauri::Manager;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

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
    pub library: LibraryInfo,
    pub photo_count: usize,
}

fn safe_name(name: &str) -> bool {
    let path = Path::new(name);
    let parts: Vec<_> = path.components().collect();
    if parts
        .iter()
        .any(|part| !matches!(part, Component::Normal(_)))
        || name.contains('\\')
        || name.contains(':')
    {
        return false;
    }
    name == "library.sqlite"
        || (parts.len() == 2
            && ["originals", "thumbnails"].contains(&parts[0].as_os_str().to_str().unwrap_or("")))
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

pub fn create(store: &Store, path: &Path) -> Result<BackupResult, String> {
    if path.extension().and_then(|v| v.to_str()) != Some("zip") {
        return Err("备份文件请使用 .zip 扩展名".into());
    }
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    let temporary = store.root.join(format!(".backup-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&temporary).map_err(|e| e.to_string())?;
    let output = path
        .parent()
        .ok_or("备份目录无效")?
        .join(format!(".foliune-backup-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let database = temporary.join("library.sqlite");
        conn.backup("main", &database, None)
            .map_err(|e| e.to_string())?;
        let state = {
            let copy = Connection::open(&database).map_err(|e| e.to_string())?;
            crate::work_directory::discard_sync_jobs(&copy)?;
            db::snapshot_with_hidden(&copy)?
        };
        let mut files = vec![("library.sqlite".to_string(), database)];
        let mut names = HashSet::new();
        names.insert("library.sqlite".to_string());
        for photo in &state.photos {
            let external = crate::work_directory::is_locator(&photo.original_path)
                || crate::local_photo::is_locator(&photo.original_path);
            for (directory, source) in [
                ("originals", &photo.original_path),
                ("thumbnails", &photo.thumbnail_path),
            ] {
                if external && directory == "originals" {
                    continue;
                }
                let source = Path::new(source);
                let filename = source
                    .file_name()
                    .and_then(|v| v.to_str())
                    .ok_or("照片路径无效")?;
                let name = format!("{directory}/{filename}");
                if !source.is_file() || !safe_name(&name) {
                    return Err(format!(
                        "照片原件或缩略图缺失，无法建立完整备份：{}",
                        photo.title
                    ));
                }
                if names.insert(name.clone()) {
                    files.push((name, source.to_path_buf()));
                }
            }
        }
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output)
            .map_err(|e| e.to_string())?;
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let mut manifest = Manifest {
            format: "foliune-library".into(),
            version: 1,
            files: Vec::new(),
        };
        for (name, source) in files {
            let (size, sha256) = digest(&source)?;
            archive
                .start_file(&name, options)
                .map_err(|e| e.to_string())?;
            std::io::copy(
                &mut fs::File::open(&source).map_err(|e| e.to_string())?,
                &mut archive,
            )
            .map_err(|e| e.to_string())?;
            manifest.files.push(ManifestFile {
                path: name,
                size,
                sha256,
            });
        }
        archive
            .start_file("manifest.json", options)
            .map_err(|e| e.to_string())?;
        archive
            .write_all(&serde_json::to_vec(&manifest).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        archive
            .finish()
            .map_err(|e| e.to_string())?
            .sync_all()
            .map_err(|e| e.to_string())?;
        fs::rename(&output, path).map_err(|e| e.to_string())?;
        Ok(BackupResult {
            path: path.to_string_lossy().into(),
            photo_count: state.photos.len() - state.hidden_photo_ids.len(),
        })
    })();
    let cleanup = fs::remove_dir_all(&temporary).map_err(|e| e.to_string());
    if result.is_err() && output.exists() {
        fs::remove_file(output).map_err(|e| e.to_string())?;
    }
    cleanup?;
    result
}

pub fn restore(store: &Store, path: &Path) -> Result<RestoreResult, String> {
    let mut archive = ZipArchive::new(fs::File::open(path).map_err(|e| e.to_string())?)
        .map_err(|_| "不是有效的 Foliune ZIP 备份")?;
    let manifest: Manifest = {
        let mut file = archive
            .by_name("manifest.json")
            .map_err(|_| "备份缺少清单")?;
        if file.size() > 16 * 1024 * 1024 {
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
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("备份包含非法路径、链接或额外文件".into());
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let parent = store.root.join("libraries");
    fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let temporary = parent.join(format!(".restoring-{id}"));
    let destination = parent.join(&id);
    fs::create_dir(&temporary).map_err(|e| e.to_string())?;
    let result = (|| {
        for entry in &manifest.files {
            let mut source = archive.by_name(&entry.path).map_err(|e| e.to_string())?;
            if source.size() != entry.size {
                return Err("备份文件大小与清单不符".into());
            }
            let target = temporary.join(&entry.path);
            fs::create_dir_all(target.parent().ok_or("备份路径无效")?)
                .map_err(|e| e.to_string())?;
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
        let mut conn =
            Connection::open(temporary.join("library.sqlite")).map_err(|e| e.to_string())?;
        let integrity: String = conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        if integrity != "ok" {
            return Err("备份数据库完整性检查失败".into());
        }
        let has_triggers: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='trigger')",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if has_triggers {
            return Err("备份数据库包含不支持的触发器".into());
        }
        // Only backups with none of the editorial tables predate these modules.
        // A partial schema can indicate lost records/references and must not be repaired as empty.
        let editorial_tables: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('model_profiles','model_photos','social_drafts','social_photos')",
            [], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if editorial_tables != 0 && editorial_tables != 4 {
            return Err("备份的模特或排版数据表不完整".into());
        }
        let planning_tables: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('shoot_plans','shoot_plan_photos')",
            [], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if planning_tables != 0 && planning_tables != 2 {
            return Err("备份的拍摄策划数据表不完整".into());
        }
        db::migrate_photos(&conn)?;
        crate::model_profiles::init(&conn)?;
        crate::social::init(&conn)?;
        crate::planning::init(&conn)?;
        crate::work_directory::prepare_restore(&conn)?;
        // An archive cannot grant access to a local path on the restore host.
        conn.execute(
            "UPDATE photos SET original_path=?1 WHERE substr(original_path, 1, length(?1))=?1",
            [crate::local_photo::PREFIX],
        )
        .map_err(|e| e.to_string())?;
        let state = db::snapshot_with_hidden(&conn)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut used = HashSet::from(["library.sqlite".to_string()]);
        for photo in &state.photos {
            let mut paths = Vec::new();
            for (directory, old) in [
                ("originals", &photo.original_path),
                ("thumbnails", &photo.thumbnail_path),
            ] {
                if directory == "originals"
                    && (crate::work_directory::is_locator(old)
                        || crate::local_photo::is_locator(old))
                {
                    paths.push(old.clone());
                    continue;
                }
                let filename = recorded_filename(old)?;
                let relative = format!("{directory}/{filename}");
                if !expected.contains(&relative) {
                    return Err("备份缺少照片文件".into());
                }
                used.insert(relative.clone());
                let decoded = image::ImageReader::open(temporary.join(&relative))
                    .map_err(|e| e.to_string())?
                    .with_guessed_format()
                    .map_err(|e| e.to_string())?;
                if !matches!(
                    decoded.format(),
                    Some(
                        image::ImageFormat::Jpeg
                            | image::ImageFormat::Png
                            | image::ImageFormat::WebP
                    )
                ) {
                    return Err("备份中照片格式不受支持".into());
                }
                decoded.decode().map_err(|_| "备份中照片无法解码")?;
                paths.push(destination.join(relative).to_string_lossy().into_owned());
            }
            tx.execute(
                "UPDATE photos SET original_path=?1,thumbnail_path=?2 WHERE id=?3",
                params![paths[0], paths[1], photo.id],
            )
            .map_err(|e| e.to_string())?;
        }
        if used != expected {
            return Err("备份包含数据库未引用的文件".into());
        }
        let bad_foreign_key: bool = tx
            .prepare("PRAGMA foreign_key_check")
            .map_err(|e| e.to_string())?
            .exists([])
            .map_err(|e| e.to_string())?;
        if bad_foreign_key {
            return Err("备份数据库引用不完整".into());
        }
        let hidden_album_member: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM memberships m JOIN photos p ON p.id=m.photo_id
                               WHERE p.hidden_after_album_delete=1)",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if hidden_album_member {
            return Err("备份的相簿引用了已移出图库的照片".into());
        }
        crate::books::validate_archive(&tx)?;
        crate::model_profiles::validate_all(&tx)?;
        crate::social::validate_all(&tx)?;
        crate::planning::validate_all(&tx)?;
        let authorized: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM work_directory_roots WHERE authorized<>0)",
                [],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if authorized {
            return Err("恢复的作品目录尚未授权".into());
        }
        tx.commit().map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| e.to_string())?;
        drop(conn);
        let library = LibraryInfo {
            id: id.clone(),
            name: format!(
                "恢复图库 · {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M")
            ),
            path: destination.to_string_lossy().into(),
        };
        fs::write(
            temporary.join("library-info.json"),
            serde_json::to_vec(&library).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(&temporary, &destination).map_err(|e| e.to_string())?;
        Ok(RestoreResult {
            library,
            photo_count: state.photos.len() - state.hidden_photo_ids.len(),
        })
    })();
    if result.is_err() && temporary.exists() {
        fs::remove_dir_all(temporary).map_err(|e| format!("恢复失败且临时库清理失败：{e}"))?;
    }
    result
}

#[tauri::command]
pub async fn backup_create(app: tauri::AppHandle, path: String) -> Result<BackupResult, String> {
    tauri::async_runtime::spawn_blocking(move || create(&app.state::<Store>(), Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn backup_restore(app: tauri::AppHandle, path: String) -> Result<RestoreResult, String> {
    tauri::async_runtime::spawn_blocking(move || restore(&app.state::<Store>(), Path::new(&path)))
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
