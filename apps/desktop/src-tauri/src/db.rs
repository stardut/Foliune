use crate::models::{AlbumCover, Group, Membership, Photo, Snapshot};
use rusqlite::{Connection, Row};
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

const GROUP_SELECT: &str =
    "SELECT g.id,g.library,g.name,g.description,g.capacity,g.created_at,f.folder,
            c.photo_id,c.offset_x,c.offset_y,c.zoom
     FROM groups g LEFT JOIN work_directory_folders f ON f.album_id=g.id
     LEFT JOIN album_covers c ON c.group_id=g.id";

fn group_from_row(row: &Row<'_>) -> rusqlite::Result<Group> {
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
    conn.query_row(
        &format!("{GROUP_SELECT} WHERE g.id=?1"),
        [id],
        group_from_row,
    )
    .map_err(|error| error.to_string())
}

fn read_snapshot(conn: &Connection, include_hidden: bool) -> Result<Snapshot, String> {
    let mut statement = conn.prepare("SELECT id,library,title,original_name,original_path,thumbnail_path,width,height,tags,annotation,source,captured_at,location,project,imported_at,regions FROM photos WHERE ?1 OR hidden_after_album_delete=0 ORDER BY imported_at DESC,id").map_err(|e| e.to_string())?;
    let photos = statement
        .query_map([include_hidden], |row| {
            let tags: String = row.get(8)?;
            let tags = serde_json::from_str(&tags).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            let original_path: String = row.get(4)?;
            let thumbnail_path: String = row.get(5)?;
            let id: String = row.get(0)?;
            let (original_available, availability) =
                crate::work_directory::original_status(conn, &id, &original_path)
                    .map_err(rusqlite::Error::InvalidParameterName)?;
            let thumbnail_available = std::path::Path::new(&thumbnail_path).is_file();
            let regions: String = row.get(15)?;
            let regions = serde_json::from_str(&regions).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    15,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(Photo {
                id,
                library: row.get(1)?,
                title: row.get(2)?,
                original_name: row.get(3)?,
                original_path,
                thumbnail_path,
                original_available,
                thumbnail_available,
                availability,
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
        .query_map([], |row| {
            Ok(Membership {
                group_id: row.get(0)?,
                photo_id: row.get(1)?,
                status: row.get(2)?,
                position: row.get(3)?,
            })
        })
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
