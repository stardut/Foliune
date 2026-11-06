use crate::models::{Group, Membership, Photo, Snapshot};
use rusqlite::Connection;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager};

pub struct Store {
    pub root: PathBuf,
    pub connection: Mutex<Connection>,
}

impl Store {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        Self::open_selected(root, true)
    }

    pub fn open_direct(root: PathBuf) -> Result<Self, String> {
        Self::open_selected(root, false)
    }

    fn open_selected(root: PathBuf, follow_selection: bool) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        // SQLite 返回规范路径（macOS /var 会解析为 /private/var）；所有库边界以同一规范路径比较。
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let selection = root.join("library-selection.json");
        let actual = if follow_selection && selection.exists() {
            let id: String =
                serde_json::from_slice(&fs::read(selection).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            uuid::Uuid::parse_str(&id).map_err(|_| "图库选择配置无效")?;
            let actual = root.join("libraries").join(id);
            if !actual.join("library.sqlite").is_file() {
                return Err("所选图库不存在，未创建空库替代".into());
            }
            actual
        } else {
            root.clone()
        };
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
        crate::books::init(&conn)?;
        crate::ai::init(&conn)?;
        crate::model_profiles::init(&conn)?;
        crate::social::init(&conn)?;
        crate::planning::init(&conn)?;
        crate::work_directory::init(&conn)?;
        Ok(Self {
            root,
            connection: Mutex::new(conn),
        })
    }
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
    let mut statement = conn.prepare("SELECT g.id,g.library,g.name,g.description,g.capacity,g.created_at,f.folder FROM groups g LEFT JOIN work_directory_folders f ON f.album_id=g.id ORDER BY g.created_at,g.id").map_err(|e| e.to_string())?;
    let groups = statement
        .query_map([], |row| {
            Ok(Group {
                id: row.get(0)?,
                library: row.get(1)?,
                name: row.get(2)?,
                description: row.get(3)?,
                capacity: row.get(4)?,
                created_at: row.get(5)?,
                bound_folder: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare(
            "SELECT group_id,photo_id,status,position FROM memberships ORDER BY group_id,position",
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
