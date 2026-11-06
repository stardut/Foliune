use rusqlite::{Connection, OpenFlags};
use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const PUBLICATION: &str = "published-thumbnails.json";

pub(super) fn root(library: &Path) -> PathBuf {
    library.join("staging").join("work-directory")
}

pub(super) fn record_publication(staging: &Path, names: &[String]) -> Result<(), String> {
    let temporary = staging.join("publication.tmp");
    let manifest = serde_json::to_vec(names).map_err(|e| e.to_string())?;
    fs::write(&temporary, manifest)
        .and_then(|()| fs::rename(temporary, staging.join(PUBLICATION)))
        .map_err(|e| format!("无法记录作品缩略图发布清单：{e}"))
}

pub(super) fn clean_abandoned_staging(base: &Path) -> Result<(), String> {
    clean_library(base)?;
    let libraries = base.join("libraries");
    if fs::symlink_metadata(&libraries).is_ok_and(|metadata| metadata.is_dir()) {
        for entry in fs::read_dir(libraries).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_dir()
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| Uuid::parse_str(name).is_ok())
            {
                clean_library(&entry.path())?;
            }
        }
    }
    Ok(())
}

fn clean_library(library: &Path) -> Result<(), String> {
    let directory = root(library);
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let mut publications = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir()
            || !entry
                .file_name()
                .to_str()
                .is_some_and(|name| Uuid::parse_str(name).is_ok())
        {
            continue;
        }
        let manifest = entry.path().join(PUBLICATION);
        if fs::symlink_metadata(&manifest).is_ok_and(|metadata| metadata.is_file()) {
            let manifest = fs::read(manifest).map_err(|e| e.to_string())?;
            let names: Vec<String> =
                serde_json::from_slice(&manifest).map_err(|e| e.to_string())?;
            publications.extend(names);
        }
    }
    if !publications.is_empty() {
        if publications.iter().any(|name| {
            !name
                .strip_suffix(".jpg")
                .is_some_and(|id| Uuid::parse_str(id).is_ok())
        }) {
            return Err("作品缩略图发布清单包含无效文件名".into());
        }
        let conn = Connection::open_with_flags(
            library.join("library.sqlite"),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|e| e.to_string())?;
        let mut statement = conn
            .prepare("SELECT thumbnail_path FROM photos")
            .map_err(|e| e.to_string())?;
        let used: HashSet<PathBuf> = statement
            .query_map([], |row| row.get::<_, String>(0).map(PathBuf::from))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        for name in publications {
            let thumbnail = library.join("thumbnails").join(name);
            if !used.contains(&thumbnail) {
                match fs::remove_file(thumbnail) {
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(error) => return Err(format!("无法清理未提交的作品缩略图：{error}")),
                }
            }
        }
    }
    fs::remove_dir_all(directory).map_err(|e| format!("无法清理作品目录同步暂存：{e}"))
}
