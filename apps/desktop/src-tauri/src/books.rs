use crate::{book_layout, content_refs, db, models::Snapshot};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::AppHandle;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookChapter {
    pub id: String,
    pub title: String,
    pub photo_ids: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookItem {
    pub photo_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub crop_x: f64,
    pub crop_y: f64,
    pub fit: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookPage {
    pub id: String,
    pub chapter_id: String,
    pub title: String,
    pub caption: String,
    pub items: Vec<BookItem>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VersionInput {
    // Older snapshots can still contain this field.
    #[serde(rename = "reflowUndoId", default, skip_serializing)]
    pub(crate) _legacy_reflow_undo_id: Option<String>,
    pub label: String,
    pub template: String,
    pub page_width: u32,
    pub page_height: u32,
    pub chapters: Vec<BookChapter>,
    pub pages: Vec<BookPage>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBookInput {
    pub title: String,
    pub template: String,
    pub page_width: u32,
    pub page_height: u32,
    pub chapters: Vec<BookChapter>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookVersion {
    pub id: String,
    pub book_id: String,
    pub created_at: String,
    pub kind: String,
    #[serde(flatten)]
    pub input: VersionInput,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSummary {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub current_version_id: String,
    pub version_count: usize,
    pub photo_count: usize,
    pub cover_photo_id: Option<String>,
}
#[derive(Serialize)]
pub struct BookDetail {
    pub book: BookSummary,
    pub versions: [BookVersion; 1],
}

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS book_versions (id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, created_at TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('automatic','manual')), data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS book_versions_book ON book_versions(book_id);").map_err(|e| e.to_string())
}

fn version_photo_ids(version: &VersionInput) -> impl Iterator<Item = &String> {
    version
        .chapters
        .iter()
        .flat_map(|chapter| &chapter.photo_ids)
        .chain(
            version
                .pages
                .iter()
                .flat_map(|page| &page.items)
                .map(|item| &item.photo_id),
        )
}

pub(crate) fn exclude_currently_referenced_photos(
    conn: &Connection,
    candidates: &mut HashSet<String>,
) -> Result<(), String> {
    if candidates.is_empty() {
        return Ok(());
    }
    let mut statement = conn
        .prepare(
            "SELECT v.data FROM books b
             LEFT JOIN book_versions v ON v.id=b.current_version_id AND v.book_id=b.id",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = statement.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let data = row
            .get::<_, Option<String>>(0)
            .map_err(|e| e.to_string())?
            .ok_or("画册当前内容不存在，无法确认照片是否仍被引用")?;
        let version: VersionInput = serde_json::from_str(&data)
            .map_err(|e| format!("画册内容损坏，无法确认照片是否仍被引用：{e}"))?;
        for id in version_photo_ids(&version) {
            candidates.remove(id);
        }
        if candidates.is_empty() {
            break;
        }
    }
    Ok(())
}

fn title(value: &str) -> Result<&str, String> {
    crate::models::name(value)
}
pub fn get(conn: &Connection, id: &str) -> Result<BookDetail, String> {
    let (mut book, version_created_at, kind, data) = conn
        .query_row(
            "SELECT b.title,b.created_at,b.updated_at,b.current_version_id,
                (SELECT COUNT(*) FROM book_versions WHERE book_id=b.id),
                v.created_at,v.kind,v.data
             FROM books b
             LEFT JOIN book_versions v ON v.id=b.current_version_id AND v.book_id=b.id
             WHERE b.id=?1",
            [id],
            |row| {
                Ok((
                    BookSummary {
                        id: id.into(),
                        title: row.get(0)?,
                        created_at: row.get(1)?,
                        updated_at: row.get(2)?,
                        current_version_id: row.get(3)?,
                        version_count: row.get(4)?,
                        photo_count: 0,
                        cover_photo_id: None,
                    },
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("画册不存在")?;
    let input: VersionInput = serde_json::from_str(&data.ok_or("画册当前内容不存在")?)
        .map_err(|e| format!("画册内容损坏：{e}"))?;
    book.photo_count = input.chapters.iter().map(|c| c.photo_ids.len()).sum();
    book.cover_photo_id = cover_photo_id(conn, &input)?;
    let version = BookVersion {
        id: book.current_version_id.clone(),
        book_id: id.into(),
        created_at: version_created_at.ok_or("画册当前内容不存在")?,
        kind: kind.ok_or("画册当前内容不存在")?,
        input,
    };
    Ok(BookDetail {
        book,
        versions: [version],
    })
}
pub fn list(conn: &Connection) -> Result<Vec<BookSummary>, String> {
    let mut statement = conn
        .prepare(
            "SELECT b.id,b.title,b.created_at,b.updated_at,b.current_version_id,
            (SELECT COUNT(*) FROM book_versions WHERE book_id=b.id),v.data
            FROM books b LEFT JOIN book_versions v ON v.id=b.current_version_id AND v.book_id=b.id
            ORDER BY b.updated_at DESC,b.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                BookSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    current_version_id: row.get(4)?,
                    version_count: row.get(5)?,
                    photo_count: 0,
                    cover_photo_id: None,
                },
                row.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut books = Vec::new();
    for row in rows {
        let (mut book, data) = row.map_err(|e| e.to_string())?;
        let current: VersionInput = serde_json::from_str(&data.ok_or("画册当前内容不存在")?)
            .map_err(|e| format!("画册内容损坏：{e}"))?;
        book.photo_count = current
            .chapters
            .iter()
            .map(|chapter| chapter.photo_ids.len())
            .sum();
        book.cover_photo_id = cover_photo_id(conn, &current)?;
        books.push(book);
    }
    Ok(books)
}

pub(crate) fn validate_archive(conn: &Connection) -> Result<(), String> {
    let mut statement = conn
        .prepare(
            "SELECT v.data, v.id=b.current_version_id, current.id
             FROM books b
             LEFT JOIN book_versions current
                ON current.id=b.current_version_id AND current.book_id=b.id
             LEFT JOIN book_versions v ON v.book_id=b.id
             ",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = statement.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        if row
            .get::<_, Option<String>>(2)
            .map_err(|e| e.to_string())?
            .is_none()
        {
            return Err("画册当前内容不存在".into());
        }
        let data = row.get::<_, String>(0).map_err(|e| e.to_string())?;
        let current = row.get::<_, bool>(1).map_err(|e| e.to_string())?;
        let input: VersionInput =
            serde_json::from_str(&data).map_err(|e| format!("画册内容损坏：{e}"))?;
        book_layout::validate_snapshot(conn, &input, current)?;
    }
    Ok(())
}

fn cover_photo_id(conn: &Connection, current: &VersionInput) -> Result<Option<String>, String> {
    let mut statement = conn
        .prepare_cached("SELECT original_path,thumbnail_path FROM photos WHERE id=?1")
        .map_err(|e| e.to_string())?;
    for item in current.pages.iter().flat_map(|page| &page.items) {
        let paths = statement
            .query_row([&item.photo_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((original, thumbnail)) = paths {
            let (available, _) =
                crate::work_directory::original_status(conn, &item.photo_id, &original)?;
            if available && std::path::Path::new(&thumbnail).is_file() {
                return Ok(Some(item.photo_id.clone()));
            }
        }
    }
    Ok(None)
}
fn insert_version(
    conn: &Connection,
    book_id: &str,
    id: &str,
    kind: &str,
    input: &VersionInput,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO book_versions(id,book_id,created_at,kind,data) VALUES(?1,?2,?3,?4,?5)",
        params![
            id,
            book_id,
            chrono::Utc::now().to_rfc3339(),
            kind,
            serde_json::to_string(input).map_err(|e| e.to_string())?
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn create(conn: &mut Connection, input: CreateBookInput) -> Result<BookDetail, String> {
    let name = title(&input.title)?;
    let layout = book_layout::generate(
        input.chapters,
        &input.template,
        input.page_width,
        input.page_height,
    )?;
    book_layout::validate(conn, &layout)?;
    let id = uuid::Uuid::new_v4().to_string();
    let version_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO books(id,title,current_version_id,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)",params![id,name,version_id,now]).map_err(|e| e.to_string())?;
    insert_version(&tx, &id, &version_id, "automatic", &layout)?;
    tx.commit().map_err(|e| e.to_string())?;
    get(conn, &id)
}
pub fn save_version(
    conn: &mut Connection,
    book_id: &str,
    version_id: &str,
    input: VersionInput,
) -> Result<BookDetail, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let current: String = tx
        .query_row(
            "SELECT current_version_id FROM books WHERE id=?1",
            [book_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("画册不存在")?;
    if current != version_id {
        return Err("画册内容已在其他操作中更改，请重新打开后再试；当前修改仍保留。".into());
    }
    book_layout::validate(&tx, &input)?;
    let id = uuid::Uuid::new_v4().to_string();
    insert_version(&tx, book_id, &id, "manual", &input)?;
    tx.execute(
        "UPDATE books SET current_version_id=?1,updated_at=?2 WHERE id=?3",
        params![id, chrono::Utc::now().to_rfc3339(), book_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get(conn, book_id)
}

pub fn append_photos(
    conn: &mut Connection,
    book_id: &str,
    photo_ids: Vec<String>,
) -> Result<BookDetail, String> {
    let detail = get(conn, book_id)?;
    let [previous] = detail.versions;
    let mut input = previous.input;
    let used: std::collections::HashSet<String> = input
        .chapters
        .iter()
        .flat_map(|c| c.photo_ids.iter().cloned())
        .collect();
    let mut unique = std::collections::HashSet::new();
    let added: Vec<String> = photo_ids
        .into_iter()
        .filter(|id| !used.contains(id) && unique.insert(id.clone()))
        .collect();
    if added.is_empty() {
        return Err("所选照片已在当前画册中".into());
    }
    let chapter = BookChapter {
        id: uuid::Uuid::new_v4().to_string(),
        title: "新增选片".into(),
        photo_ids: added,
    };
    let layout = book_layout::generate(
        vec![chapter.clone()],
        &input.template,
        input.page_width,
        input.page_height,
    )?;
    input.chapters.push(chapter);
    input.pages.extend(layout.pages);
    input.label = "追加选片".into();
    save_version(conn, book_id, &detail.book.current_version_id, input)
}
pub fn rename(conn: &mut Connection, id: &str, name: &str) -> Result<BookDetail, String> {
    let name = title(name)?;
    get(conn, id)?;
    conn.execute(
        "UPDATE books SET title=?1,updated_at=?2 WHERE id=?3",
        params![name, chrono::Utc::now().to_rfc3339(), id],
    )
    .map_err(|e| e.to_string())?;
    get(conn, id)
}
pub fn delete(conn: &mut Connection, id: &str) -> Result<Snapshot, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let data: Option<String> = tx
        .query_row(
            "SELECT v.data FROM books b
         LEFT JOIN book_versions v ON v.id=b.current_version_id AND v.book_id=b.id
         WHERE b.id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("画册不存在")?;
    let version: VersionInput = serde_json::from_str(&data.ok_or("画册当前内容不存在")?)
        .map_err(|e| format!("画册内容损坏：{e}"))?;
    let candidates = version_photo_ids(&version).cloned().collect();
    tx.execute("DELETE FROM books WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    let snapshot = content_refs::snapshot_after_deletion(&tx, candidates)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(snapshot)
}

#[tauri::command]
pub async fn books_list(app: AppHandle) -> Result<Vec<BookSummary>, String> {
    db::with_connection(app, move |conn| list(conn)).await
}
#[tauri::command]
pub async fn books_get(app: AppHandle, id: String) -> Result<BookDetail, String> {
    db::with_connection(app, move |conn| get(conn, &id)).await
}
#[tauri::command]
pub async fn books_create(app: AppHandle, input: CreateBookInput) -> Result<BookDetail, String> {
    db::with_connection(app, move |conn| create(conn, input)).await
}
#[tauri::command]
pub async fn books_save_version(
    app: AppHandle,
    book_id: String,
    version_id: String,
    input: VersionInput,
) -> Result<BookDetail, String> {
    db::with_connection(app, move |conn| {
        save_version(conn, &book_id, &version_id, input)
    })
    .await
}
#[tauri::command]
pub async fn books_rename(app: AppHandle, id: String, title: String) -> Result<BookDetail, String> {
    db::with_connection(app, move |conn| rename(conn, &id, &title)).await
}
#[tauri::command]
pub async fn books_delete(app: AppHandle, id: String) -> Result<Snapshot, String> {
    db::with_connection(app, move |conn| delete(conn, &id)).await
}

#[tauri::command]
pub async fn books_append_photos(
    app: AppHandle,
    book_id: String,
    photo_ids: Vec<String>,
) -> Result<BookDetail, String> {
    db::with_connection(app, move |conn| append_photos(conn, &book_id, photo_ids)).await
}
