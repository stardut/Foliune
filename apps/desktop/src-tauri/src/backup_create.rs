use super::{recorded_filename, BackupResult, Manifest, ManifestFile, MAX_MANIFEST_BYTES};
use crate::{
    db::{self, Store},
    local_photo, work_directory,
};
use rusqlite::{params, Connection};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Read, Seek, Write},
    path::Path,
};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter, ZIP64_BYTES_THR};

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackupMode {
    Metadata,
    Full,
    #[cfg(test)]
    #[serde(skip)]
    Legacy,
}

// Existing restore tests can still produce archives with the old mix of
// managed originals and external references.
#[cfg(test)]
pub(crate) fn create(store: &Store, path: &Path) -> Result<BackupResult, String> {
    create_with_mode(store, path, BackupMode::Legacy)
}

pub(crate) fn create_with_mode(
    store: &Store,
    path: &Path,
    mode: BackupMode,
) -> Result<BackupResult, String> {
    if path.extension().and_then(|value| value.to_str()) != Some("zip") {
        return Err("备份文件请使用 .zip 扩展名".into());
    }
    let output = path
        .parent()
        .ok_or("备份目录无效")?
        .join(format!(".foliune-backup-{}.tmp", Uuid::new_v4()));
    let conn = store.connection.lock().map_err(|error| error.to_string())?;
    let root = db::library_root(&conn)?;
    let temporary = root.join(format!(".backup-{}", Uuid::new_v4()));
    fs::create_dir(&temporary).map_err(|error| error.to_string())?;
    let mut output_created = false;
    let mut result: Result<BackupResult, String> = (|| {
        let database = temporary.join("library.sqlite");
        conn.backup("main", &database, None)
            .map_err(|error| error.to_string())?;
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output)
            .map_err(|error| error.to_string())?;
        output_created = true;
        let photo_count = write_archive(&conn, &database, file, mode)?;
        fs::rename(&output, path).map_err(|error| error.to_string())?;
        Ok(BackupResult {
            path: path.to_string_lossy().into_owned(),
            photo_count,
        })
    })();
    let cleanup = fs::remove_dir_all(&temporary);
    if let (Err(error), true) = (&mut result, output_created) {
        if let Err(cleanup) = fs::remove_file(output) {
            error.push_str(&format!("；清理未完成的备份失败：{cleanup}"));
        }
    }
    match (result, cleanup) {
        (Err(error), Err(cleanup)) => Err(format!("{error}；清理备份暂存失败：{cleanup}")),
        (Ok(result), Err(cleanup)) => {
            eprintln!("备份已写入，清理备份暂存失败：{cleanup}");
            Ok(result)
        }
        (result, Ok(())) => result,
    }
}

fn write_archive(
    live: &Connection,
    database: &Path,
    output: File,
    mode: BackupMode,
) -> Result<usize, String> {
    let mut archive = ZipWriter::new(output);
    let mut manifest = Manifest {
        format: "foliune-library".into(),
        version: 1,
        files: Vec::new(),
    };
    let mut written = HashMap::new();
    let photo_count = {
        let mut copy = Connection::open(database).map_err(|error| error.to_string())?;
        // Only the main SQLite file is archived, so commit changes directly to it.
        let journal: String = copy
            .pragma_update_and_check(None, "journal_mode", "DELETE", |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if journal != "delete" {
            return Err("无法将备份数据库保存为单个文件".into());
        }
        work_directory::discard_sync_jobs(&copy)?;
        let tx = copy.transaction().map_err(|error| error.to_string())?;
        let photos = {
            let mut query = tx
                .prepare("SELECT id,title,original_path,thumbnail_path,hidden_after_album_delete FROM photos ORDER BY id")
                .map_err(|error| error.to_string())?;
            let photos = query
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, bool>(4)?,
                    ))
                })
                .map_err(|error| error.to_string())?;
            photos
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| error.to_string())?
        };
        let mut count = 0;
        for (id, title, original, thumbnail, hidden) in photos {
            let external =
                work_directory::is_locator(&original) || local_photo::is_locator(&original);
            let archived_path = if mode == BackupMode::Metadata {
                (!external).then_some(local_photo::PREFIX.to_owned())
            } else if mode == BackupMode::Full || !external {
                write_original(
                    live,
                    &mut archive,
                    &mut manifest,
                    &mut written,
                    &id,
                    &original,
                    external,
                )
                .map_err(|error| format!("无法备份「{title}」的原片：{error}"))?
            } else {
                None
            };
            if let Some(archived_path) = archived_path {
                tx.execute(
                    "UPDATE photos SET original_path=?1 WHERE id=?2",
                    params![archived_path, id],
                )
                .map_err(|error| error.to_string())?;
            }
            let thumbnail_entry = (|| {
                let name = format!("thumbnails/{}", recorded_filename(&thumbnail)?);
                if new_entry(&mut written, &name, &thumbnail)? {
                    let mut source = work_directory::open_file_at_path(Path::new(&thumbnail))
                        .map_err(|error| error.to_string())?;
                    manifest
                        .files
                        .push(write_entry(&mut archive, name, &mut source)?);
                }
                Ok::<_, String>(())
            })();
            thumbnail_entry.map_err(|error| format!("无法备份「{title}」的缩略图：{error}"))?;
            count += usize::from(!hidden);
        }
        if mode == BackupMode::Full {
            // The corresponding photos and albums now work without the external binding.
            tx.execute_batch(
                "DELETE FROM work_directory_ignored_files;
                 DELETE FROM work_directory_photos;
                 DELETE FROM work_directory_folders;
                 DELETE FROM work_directory_roots;",
            )
            .map_err(|error| error.to_string())?;
        }
        tx.commit().map_err(|error| error.to_string())?;
        count
    };
    let mut database = File::open(database).map_err(|error| error.to_string())?;
    manifest.files.push(write_entry(
        &mut archive,
        "library.sqlite".into(),
        &mut database,
    )?);
    let manifest = serde_json::to_vec(&manifest).map_err(|error| error.to_string())?;
    if manifest.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("备份清单过大".into());
    }
    archive
        .start_file("manifest.json", zip_options())
        .map_err(|error| error.to_string())?;
    archive
        .write_all(&manifest)
        .map_err(|error| error.to_string())?;
    archive
        .finish()
        .map_err(|error| error.to_string())?
        .sync_all()
        .map_err(|error| error.to_string())?;
    Ok(photo_count)
}

fn write_original(
    conn: &Connection,
    archive: &mut ZipWriter<File>,
    manifest: &mut Manifest,
    written: &mut HashMap<String, String>,
    id: &str,
    locator: &str,
    external: bool,
) -> Result<Option<String>, String> {
    let original = work_directory::original(conn, id, locator)?;
    let mut source = original.open()?;
    let revision = work_directory::stat_signature(&source).ok_or("无法确认原件状态")?;
    let name = if external {
        let id = Uuid::parse_str(id).map_err(|_| "照片 ID 无效")?;
        let mut header = [0; 12];
        source
            .read_exact(&mut header)
            .map_err(|error| error.to_string())?;
        source.rewind().map_err(|error| error.to_string())?;
        let extension = match local_photo::image_content_type(&header) {
            Some("image/jpeg") => "jpg",
            Some("image/png") => "png",
            Some("image/webp") => "webp",
            _ => return Err("照片原件格式无法识别".into()),
        };
        format!("originals/{id}.{extension}")
    } else {
        format!("originals/{}", recorded_filename(locator)?)
    };
    if new_entry(written, &name, locator)? {
        let entry = write_entry(archive, name.clone(), &mut source)?;
        original.verify_content_hash(&entry.sha256)?;
        if work_directory::stat_signature(&source).as_deref() != Some(&revision) {
            return Err("备份时原件发生变化，请重试".into());
        }
        manifest.files.push(entry);
    }
    Ok(external.then_some(name))
}

fn new_entry(
    written: &mut HashMap<String, String>,
    name: &str,
    source: &str,
) -> Result<bool, String> {
    match written.get(name) {
        Some(previous) if previous == source => Ok(false),
        Some(_) => Err("备份文件名重复".into()),
        None => {
            written.insert(name.to_owned(), source.to_owned());
            Ok(true)
        }
    }
}

fn zip_options() -> SimpleFileOptions {
    SimpleFileOptions::default().compression_method(CompressionMethod::Stored)
}

fn write_entry(
    archive: &mut ZipWriter<File>,
    name: String,
    source: &mut File,
) -> Result<ManifestFile, String> {
    let size = source.metadata().map_err(|error| error.to_string())?.len();
    archive
        .start_file(&name, zip_options().large_file(size >= ZIP64_BYTES_THR))
        .map_err(|error| error.to_string())?;
    let mut source = source.take(size);
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        let bytes = &buffer[..read];
        archive
            .write_all(bytes)
            .map_err(|error| error.to_string())?;
        hash.update(bytes);
    }
    if source.limit() != 0 {
        return Err("备份时文件大小发生变化，请重试".into());
    }
    Ok(ManifestFile {
        path: name,
        size,
        sha256: format!("{:x}", hash.finalize()),
    })
}
