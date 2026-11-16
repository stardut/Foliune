use crate::models::{AlbumCover, Group, Membership, Photo, Snapshot};
use rusqlite::{Connection, OpenFlags, OptionalExtension, Row};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

pub struct Store {
    pub root: PathBuf,
    pub connection: Mutex<Connection>,
    pub(crate) restart_gate: crate::restart_gate::RestartGate,
}

impl Store {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let library = installed_library(&root)?;
        Self::open_at(root, library)
    }

    pub fn open_direct(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        Self::open_at(root.clone(), root)
    }

    fn open_at(root: PathBuf, actual: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(actual.join("originals")).map_err(|e| e.to_string())?;
        fs::create_dir_all(actual.join("thumbnails")).map_err(|e| e.to_string())?;
        let conn = Connection::open(actual.join("library.sqlite")).map_err(|e| e.to_string())?;
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS photos (
               id TEXT PRIMARY KEY, library TEXT NOT NULL CHECK(library IN ('collection','work')),
               title TEXT NOT NULL, original_name TEXT NOT NULL,
               original_path TEXT NOT NULL, thumbnail_path TEXT NOT NULL,
               width INTEGER NOT NULL, height INTEGER NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
               annotation TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
               captured_at TEXT, location TEXT NOT NULL DEFAULT '', project TEXT NOT NULL DEFAULT '',
               imported_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS groups (
               id TEXT PRIMARY KEY, library TEXT NOT NULL CHECK(library IN ('collection','work')),
               name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
               capacity INTEGER CHECK(capacity IS NULL OR capacity > 0), created_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS memberships (
               group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
               photo_id TEXT NOT NULL REFERENCES photos(id),
               status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','discarded')),
               position INTEGER NOT NULL,
               PRIMARY KEY(group_id,photo_id)
             );",
        ).map_err(|e| e.to_string())?;
        migrate_photos(&conn)?;
        crate::groups::init_covers(&conn)?;
        crate::books::init(&conn)?;
        crate::ai::init(&conn)?;
        crate::model_profiles::init(&conn)?;
        crate::social::init(&conn)?;
        crate::planning::init(&conn)?;
        crate::work_directory::init(&conn)?;
        Ok(Self {
            root,
            connection: Mutex::new(conn),
            restart_gate: Default::default(),
        })
    }
}

// Earlier installations stored their active library here. Keep opening that
// location so managed photos and their recorded paths stay together on upgrade.
fn installed_library(root: &Path) -> Result<PathBuf, String> {
    let bytes = match fs::read(root.join("library-selection.json")) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(root.to_path_buf()),
        Err(error) => return Err(error.to_string()),
    };
    let id: String = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    uuid::Uuid::parse_str(&id).map_err(|_| "图库位置配置无效")?;
    let library = root.join("libraries").join(id);
    let database = library.join("library.sqlite");
    if !fs::symlink_metadata(&database).is_ok_and(|metadata| metadata.is_file()) {
        return Err("当前图库数据库不存在或路径无效".into());
    }
    if database.canonicalize().map_err(|e| e.to_string())? != database {
        return Err("当前图库数据库路径无效".into());
    }
    Ok(library)
}

pub(crate) fn open_existing(root: &Path, writable: bool) -> Result<Connection, String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let database = installed_library(&root)?.join("library.sqlite");
    let flags = if writable {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    } else {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    };
    let conn = Connection::open_with_flags(database, flags).map_err(|error| error.to_string())?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|error| error.to_string())?;
    crate::work_directory::init_availability(&conn)?;
    Ok(conn)
}

pub(crate) const REVISION_CONFLICT: &str = "记录已被修改，请重新读取后再保存";

pub(crate) fn check_revision(current: &str, expected: &str) -> Result<(), String> {
    if current == expected {
        Ok(())
    } else {
        Err(REVISION_CONFLICT.into())
    }
}

pub(crate) fn next_revision(previous: Option<&str>) -> String {
    let now = chrono::Utc::now();
    previous
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .and_then(|value| {
            value
                .to_utc()
                .checked_add_signed(chrono::Duration::nanoseconds(1))
        })
        .map_or(now, |value| value.max(now))
        .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true)
}

pub(crate) fn write<T>(
    conn: &mut Connection,
    operation: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|error| error.to_string())?;
    let result = operation(conn).and_then(|value| {
        conn.execute_batch("COMMIT")
            .map_err(|error| error.to_string())?;
        Ok(value)
    });
    if result.is_err() {
        conn.execute_batch("ROLLBACK")
            .map_err(|error| error.to_string())?;
    }
    result
}

pub(crate) fn migrate_photos(conn: &Connection) -> Result<(), String> {
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if version >= 3 {
        return Ok(());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if version < 2 {
        tx.execute_batch("ALTER TABLE photos ADD COLUMN regions TEXT NOT NULL DEFAULT '[]';")
            .map_err(|e| e.to_string())?;
    }
    tx.execute_batch(
        "ALTER TABLE photos ADD COLUMN hidden_after_album_delete INTEGER NOT NULL DEFAULT 0
           CHECK(hidden_after_album_delete IN (0,1));
         PRAGMA user_version=3;",
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// Keep connection waits and external availability checks off the native UI thread.
pub(crate) async fn with_connection<T: Send + 'static>(
    app: AppHandle,
    operation: impl FnOnce(&mut Connection) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let _active = store.restart_gate.require_work()?;
        let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
        operation(&mut conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn library_root(conn: &Connection) -> Result<PathBuf, String> {
    conn.path()
        .and_then(|path| std::path::Path::new(path).parent())
        .map(|path| path.to_path_buf())
        .ok_or_else(|| "图库路径不可用".into())
}

pub fn snapshot(conn: &Connection) -> Result<Snapshot, String> {
    read_snapshot(conn, false)
}

/// Backup and restore include every retained photo and its files, even when hidden from the UI.
pub(crate) fn snapshot_with_hidden(conn: &Connection) -> Result<Snapshot, String> {
    read_snapshot(conn, true)
}

pub(crate) const GROUP_SELECT: &str =
    "SELECT g.id,g.library,g.name,g.description,g.capacity,g.created_at,f.folder,
            c.photo_id,c.offset_x,c.offset_y,c.zoom
     FROM groups g LEFT JOIN work_directory_folders f ON f.album_id=g.id
     LEFT JOIN album_covers c ON c.group_id=g.id";

pub(crate) fn group_from_row(row: &Row<'_>) -> rusqlite::Result<Group> {
    let cover = match row.get(7)? {
        Some(photo_id) => Some(AlbumCover {
            photo_id,
            offset_x: row.get(8)?,
            offset_y: row.get(9)?,
            zoom: row.get(10)?,
        }),
        None => None,
    };
    Ok(Group {
        id: row.get(0)?,
        library: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        capacity: row.get(4)?,
        created_at: row.get(5)?,
        bound_folder: row.get(6)?,
        cover,
    })
}

pub(crate) fn read_group(conn: &Connection, id: &str) -> Result<Group, String> {
    find_group(conn, id)?.ok_or_else(|| rusqlite::Error::QueryReturnedNoRows.to_string())
}

pub(crate) fn find_group(conn: &Connection, id: &str) -> Result<Option<Group>, String> {
    conn.query_row(
        &format!("{GROUP_SELECT} WHERE g.id=?1"),
        [id],
        group_from_row,
    )
    .optional()
    .map_err(|error| error.to_string())
}

pub(crate) const PHOTO_SELECT: &str =
    "SELECT p.id,p.library,p.title,p.original_name,p.original_path,p.thumbnail_path,p.width,p.height,
            p.tags,p.annotation,p.source,p.captured_at,p.location,p.project,p.imported_at,p.regions
     FROM photos p";

pub(crate) fn photo_from_row(row: &Row<'_>) -> rusqlite::Result<Photo> {
    let tags: String = row.get(8)?;
    let tags = serde_json::from_str(&tags).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(8, rusqlite::types::Type::Text, Box::new(error))
    })?;
    let original_path: String = row.get(4)?;
    let thumbnail_path: String = row.get(5)?;
    let id: String = row.get(0)?;
    let regions: String = row.get(15)?;
    let regions = serde_json::from_str(&regions).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(15, rusqlite::types::Type::Text, Box::new(error))
    })?;
    Ok(Photo {
        id,
        library: row.get(1)?,
        title: row.get(2)?,
        original_name: row.get(3)?,
        original_path,
        thumbnail_path,
        original_available: false,
        thumbnail_available: false,
        availability: None,
        width: row.get(6)?,
        height: row.get(7)?,
        tags,
        regions,
        annotation: row.get(9)?,
        source: row.get(10)?,
        captured_at: row.get(11)?,
        location: row.get(12)?,
        project: row.get(13)?,
        imported_at: row.get(14)?,
    })
}

pub(crate) fn membership_from_row(row: &Row<'_>) -> rusqlite::Result<Membership> {
    Ok(Membership {
        group_id: row.get(0)?,
        photo_id: row.get(1)?,
        status: row.get(2)?,
        position: row.get(3)?,
    })
}

fn read_snapshot(conn: &Connection, include_hidden: bool) -> Result<Snapshot, String> {
    let mut statement = conn
        .prepare(&format!(
            "{PHOTO_SELECT} WHERE ?1 OR p.hidden_after_album_delete=0 ORDER BY p.imported_at DESC,p.id"
        ))
        .map_err(|e| e.to_string())?;
    let photos = statement
        .query_map([include_hidden], |row| {
            let mut photo = photo_from_row(row)?;
            (photo.original_available, photo.availability) =
                crate::work_directory::original_status(conn, &photo.id, &photo.original_path)
                    .map_err(rusqlite::Error::InvalidParameterName)?;
            photo.thumbnail_available = Path::new(&photo.thumbnail_path).is_file();
            Ok(photo)
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare(&format!("{GROUP_SELECT} ORDER BY g.created_at,g.id"))
        .map_err(|e| e.to_string())?;
    let groups = statement
        .query_map([], group_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare(
            "SELECT group_id,photo_id,status,position FROM memberships ORDER BY group_id,position,photo_id",
        )
        .map_err(|e| e.to_string())?;
    let memberships = statement
        .query_map([], membership_from_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare("SELECT id FROM photos WHERE hidden_after_album_delete=1 ORDER BY id")
        .map_err(|e| e.to_string())?;
    let hidden_photo_ids = statement
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Snapshot {
        photos,
        groups,
        memberships,
        hidden_photo_ids,
    })
}
