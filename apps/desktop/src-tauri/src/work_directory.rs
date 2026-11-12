#[cfg(target_os = "macos")]
mod jpeg_macos;
mod queue;
pub(crate) mod runtime;
mod source;
mod staging;
mod sync;
mod verification;

pub(crate) use runtime::{serve, start_monitor, wake_monitor};
pub(crate) use source::{
    open_file_at_path, original, original_status, stat_signature, BoundAvailability, Original,
};
pub(crate) use verification::copy_availability;

use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Root {
    id: String,
    path: PathBuf,
    authorized: bool,
}

const LOCATOR_PREFIX: &str = "work-photo:";

pub(crate) fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS work_directory_roots (
           id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE,
           active INTEGER NOT NULL CHECK(active IN (0,1)),
           authorized INTEGER NOT NULL CHECK(authorized IN (0,1))
         );
         CREATE UNIQUE INDEX IF NOT EXISTS work_directory_active ON work_directory_roots(active) WHERE active=1;
         CREATE TABLE IF NOT EXISTS work_directory_folders (
           root_id TEXT NOT NULL REFERENCES work_directory_roots(id),
           folder TEXT NOT NULL, album_id TEXT UNIQUE REFERENCES groups(id) ON DELETE SET NULL,
           PRIMARY KEY(root_id,folder)
         );
         CREATE TABLE IF NOT EXISTS work_directory_photos (
           photo_id TEXT PRIMARY KEY REFERENCES photos(id),
           root_id TEXT NOT NULL, folder TEXT NOT NULL, file_name TEXT NOT NULL, sha256 TEXT NOT NULL, stat_signature TEXT,
           UNIQUE(root_id,folder,file_name),
           FOREIGN KEY(root_id,folder) REFERENCES work_directory_folders(root_id,folder)
         );
         CREATE TABLE IF NOT EXISTS work_directory_ignored_files (
           root_id TEXT NOT NULL, folder TEXT NOT NULL, file_name TEXT NOT NULL,
           PRIMARY KEY(root_id,folder,file_name),
           FOREIGN KEY(root_id,folder) REFERENCES work_directory_folders(root_id,folder)
         );",
    )
    .map_err(|e| e.to_string())?;
    let has_signature: bool = conn
        .query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('work_directory_photos') WHERE name='stat_signature')", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if !has_signature {
        conn.execute(
            "ALTER TABLE work_directory_photos ADD COLUMN stat_signature TEXT",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    queue::init(conn)?;
    verification::init_availability(conn)
}

/// Confirmations belong to the live library and never to a portable archive.
pub(crate) fn discard_sync_jobs(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA secure_delete=ON; DROP TABLE IF EXISTS work_directory_jobs;")
        .map_err(|e| e.to_string())
}

/// Restoring metadata never grants the archive access to a local path.
pub(crate) fn prepare_restore(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN
             ('work_directory_roots','work_directory_folders','work_directory_photos','work_directory_ignored_files')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count != 0 && count != 4 {
        return Err("备份的作品目录数据表不完整".into());
    }
    discard_sync_jobs(conn)?;
    init(conn)?;
    conn.execute("UPDATE work_directory_roots SET authorized=0", [])
        .map_err(|e| e.to_string())?;

    let invalid: bool = conn
        .query_row(
            "SELECT EXISTS(
               SELECT 1 FROM photos p LEFT JOIN work_directory_photos w ON w.photo_id=p.id
               WHERE (w.photo_id IS NULL AND p.original_path LIKE 'work-photo:%')
                 OR (w.photo_id IS NOT NULL AND (p.library<>'work' OR p.original_path<>'work-photo:' || p.id))
               UNION ALL SELECT 1 FROM work_directory_folders f JOIN groups g ON g.id=f.album_id WHERE g.library<>'work'
               UNION ALL SELECT 1 FROM work_directory_roots WHERE active NOT IN (0,1)
             )",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if invalid {
        return Err("备份的作品目录引用无效".into());
    }
    let validate = |query: &str, check: fn(&[String]) -> bool| -> Result<(), String> {
        let mut statement = conn.prepare(query).map_err(|e| e.to_string())?;
        let count = statement.column_count();
        let rows = statement
            .query_map([], |row| {
                (0..count)
                    .map(|i| row.get(i))
                    .collect::<Result<Vec<String>, _>>()
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            if !check(&row.map_err(|e| e.to_string())?) {
                return Err("备份的作品目录路径或文件指纹无效".into());
            }
        }
        Ok(())
    };
    // A foreign-platform absolute path is retained as metadata until the user relinks it.
    validate("SELECT id,path FROM work_directory_roots", |row| {
        Uuid::parse_str(&row[0]).is_ok() && !row[1].is_empty() && !row[1].contains('\0')
    })?;
    validate("SELECT folder FROM work_directory_folders", |row| {
        valid_component(&row[0])
    })?;
    validate(
        "SELECT file_name FROM work_directory_ignored_files",
        |row| supported_file(&row[0]),
    )?;
    validate(
        "SELECT photo_id,file_name,sha256 FROM work_directory_photos",
        |row| {
            Uuid::parse_str(&row[0]).is_ok()
                && supported_file(&row[1])
                && row[2].len() == 64
                && row[2].bytes().all(|byte| byte.is_ascii_hexdigit())
        },
    )?;
    Ok(())
}

pub(crate) fn is_locator(value: &str) -> bool {
    value.starts_with(LOCATOR_PREFIX)
}

fn active(conn: &Connection) -> Result<Option<Root>, String> {
    conn.query_row(
        "SELECT id,path,authorized FROM work_directory_roots WHERE active=1",
        [],
        |row| {
            Ok(Root {
                id: row.get(0)?,
                path: PathBuf::from(row.get::<_, String>(1)?),
                authorized: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn valid_component(value: &str) -> bool {
    !value.contains(['/', '\\', ':', '\0'])
        && matches!(Path::new(value).components().collect::<Vec<_>>().as_slice(), [Component::Normal(part)] if *part == value)
}

fn supported_file(value: &str) -> bool {
    valid_component(value) && crate::photos::supported_extension(Path::new(value))
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct Scan {
    connected: bool,
    folders: BTreeMap<String, BTreeSet<String>>,
}

/// Only immediate, real subdirectories and regular images directly inside them.
#[cfg(test)]
fn scan(root: Option<&Root>) -> Scan {
    let Some(root) = root.filter(|root| root.authorized) else {
        return Scan::default();
    };
    observe_path(&root.path).0
}

fn observe_path(path: &Path) -> (Scan, Option<source::RootStamp>) {
    use source::EntryKind;
    let Ok(directory) = source::RootDirectory::open(path) else {
        return (Scan::default(), None);
    };
    let stamp = directory.identity();
    let Ok(entries) = directory.entries(None) else {
        return (Scan::default(), stamp);
    };
    let mut folders = BTreeMap::new();
    for (folder, kind) in entries {
        if kind != EntryKind::Directory || !valid_component(&folder) {
            continue;
        }
        let Ok(children) = directory.entries(Some(&folder)) else {
            continue;
        };
        let files = children
            .into_iter()
            .filter_map(|(name, kind)| {
                (kind == EntryKind::File && supported_file(&name)).then_some(name)
            })
            .collect();
        folders.insert(folder, files);
    }
    (
        Scan {
            connected: true,
            folders,
        },
        stamp,
    )
}

type FolderEntry = (Option<String>, BTreeSet<String>);

fn folders(conn: &Connection, root: &Root) -> Result<BTreeMap<String, FolderEntry>, String> {
    let mut folders: BTreeMap<String, FolderEntry> = BTreeMap::new();
    let mut stmt = conn
        .prepare("SELECT folder,album_id FROM work_directory_folders WHERE root_id=?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&root.id], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (folder, album) = row.map_err(|e| e.to_string())?;
        folders.insert(folder, (album, BTreeSet::new()));
    }
    let mut stmt = conn
        .prepare(
            "SELECT folder,file_name FROM work_directory_photos WHERE root_id=?1
         UNION SELECT folder,file_name FROM work_directory_ignored_files WHERE root_id=?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&root.id], |row| {
            Ok((row.get::<_, String>(0)?, row.get(1)?))
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (folder, file_name) = row.map_err(|e| e.to_string())?;
        let entry = folders.get_mut(&folder).ok_or("作品目录记录不完整")?;
        entry.1.insert(file_name);
    }
    Ok(folders)
}

fn bind(conn: &Connection, path: &Path) -> Result<(), String> {
    if active(conn)?.is_some() {
        return Err("当前图库已绑定作品目录，请重新定位或先解绑".into());
    }
    let existing = conn
        .query_row(
            "SELECT id,path,authorized FROM work_directory_roots WHERE path=?1",
            [path.to_str().ok_or("作品目录路径不是有效文本")?],
            |row| {
                Ok(Root {
                    id: row.get(0)?,
                    path: PathBuf::from(row.get::<_, String>(1)?),
                    authorized: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(root) = existing {
        let signatures = sync::verify_relink(conn, &root, path)?;
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        sync::save_signatures(&tx, signatures)?;
        tx.execute(
            "UPDATE work_directory_roots SET active=1,authorized=1 WHERE id=?1",
            [&root.id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "INSERT INTO work_directory_roots(id,path,active,authorized) VALUES(?1,?2,1,1)",
            params![Uuid::new_v4().to_string(), path.to_str()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn relink(conn: &Connection, path: &Path) -> Result<(), String> {
    let root = active(conn)?.ok_or("当前图库未绑定作品目录")?;
    let path_text = path.to_str().ok_or("作品目录路径不是有效文本")?;
    let occupied: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM work_directory_roots WHERE path=?1 AND id<>?2)",
            params![path_text, root.id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if occupied {
        return Err("该目录已有保留的作品引用；请先解绑，再选择绑定该目录".into());
    }
    let signatures = sync::verify_relink(conn, &root, path)?;
    let stamp = source::RootDirectory::open(path)
        .ok()
        .and_then(|root| root.identity());
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    sync::save_signatures(&tx, signatures)?;
    if !root.authorized || root.path != path {
        queue::remove_root(&tx, &root.id)?;
    } else {
        queue::retain_same_source(&tx, &root.id, stamp)?;
    }
    tx.execute(
        "UPDATE work_directory_roots SET path=?1,authorized=1 WHERE id=?2",
        params![path_text, root.id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

fn unbind(conn: &Connection) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if let Some(root) = active(&tx)? {
        queue::remove_root(&tx, &root.id)?;
    }
    tx.execute(
        "UPDATE work_directory_roots SET active=0 WHERE active=1",
        [],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

fn choose_path(base: &Path, path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("请选择一个绝对目录路径".into());
    }
    let path = path
        .canonicalize()
        .map_err(|_| "所选作品目录不存在或无法访问")?;
    if path.to_str().is_none() || !source::readable_root(&path) {
        return Err("所选作品目录不可读取".into());
    }
    if path.starts_with(base) {
        return Err("请选择应用数据目录之外的作品目录".into());
    }
    Ok(path)
}

#[cfg(test)]
mod tests;
