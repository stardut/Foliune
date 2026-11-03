use crate::{book_layout, db::Store};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

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
}
#[derive(Serialize)]
pub struct BookDetail {
    pub book: BookSummary,
    pub versions: Vec<BookVersion>,
}

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, title TEXT NOT NULL, current_version_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS book_versions (id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, created_at TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('automatic','manual')), data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS book_versions_book ON book_versions(book_id);").map_err(|e| e.to_string())
}

fn title(value: &str) -> Result<&str, String> {
    crate::models::name(value)
}
pub fn get(conn: &Connection, id: &str) -> Result<BookDetail, String> {
    let mut statement = conn.prepare("SELECT id,book_id,created_at,kind,data FROM book_versions WHERE book_id=?1 ORDER BY created_at,id").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut versions = Vec::new();
    for row in rows {
        let (id, book_id, created_at, kind, data) = row.map_err(|e| e.to_string())?;
        versions.push(BookVersion {
            id,
            book_id,
            created_at,
            kind,
            input: serde_json::from_str(&data).map_err(|e| format!("画册版本损坏：{e}"))?,
        });
    }
    let raw = conn
        .query_row(
            "SELECT title,created_at,updated_at,current_version_id FROM books WHERE id=?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("画册不存在")?;
    let photo_count = versions
        .iter()
        .find(|v| v.id == raw.3)
        .ok_or("画册当前版本不存在")?
        .input
        .chapters
        .iter()
        .map(|c| c.photo_ids.len())
        .sum();
    Ok(BookDetail {
        book: BookSummary {
            id: id.into(),
            title: raw.0,
            created_at: raw.1,
            updated_at: raw.2,
            current_version_id: raw.3,
            version_count: versions.len(),
            photo_count,
        },
        versions,
    })
}
pub fn list(conn: &Connection) -> Result<Vec<BookSummary>, String> {
    let mut statement = conn
        .prepare("SELECT id FROM books ORDER BY updated_at DESC,id")
        .map_err(|e| e.to_string())?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    ids.into_iter()
        .map(|id| get(conn, &id).map(|d| d.book))
        .collect()
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
fn source(conn: &Connection, book_id: &str, version_id: &str) -> Result<BookVersion, String> {
    get(conn, book_id)?
        .versions
        .into_iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| "版本不属于该画册".into())
}
pub fn save_version(
    conn: &mut Connection,
    book_id: &str,
    version_id: &str,
    input: VersionInput,
) -> Result<BookDetail, String> {
    book_layout::validate(conn, &input)?;
    let previous = source(conn, book_id, version_id)?;
    let id = if previous.kind == "manual" {
        previous.id
    } else {
        uuid::Uuid::new_v4().to_string()
    };
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if previous.kind == "manual" {
        tx.execute(
            "UPDATE book_versions SET data=?1 WHERE id=?2 AND book_id=?3",
            params![
                serde_json::to_string(&input).map_err(|e| e.to_string())?,
                id,
                book_id
            ],
        )
        .map_err(|e| e.to_string())?;
    } else {
        insert_version(&tx, book_id, &id, "manual", &input)?;
    }
    tx.execute(
        "UPDATE books SET current_version_id=?1,updated_at=?2 WHERE id=?3",
        params![id, chrono::Utc::now().to_rfc3339(), book_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get(conn, book_id)
}
pub fn reflow(
    conn: &mut Connection,
    book_id: &str,
    version_id: &str,
    template: &str,
) -> Result<BookDetail, String> {
    let previous = source(conn, book_id, version_id)?;
    let input = book_layout::generate(
        previous.input.chapters,
        template,
        previous.input.page_width,
        previous.input.page_height,
    )?;
    book_layout::validate(conn, &input)?;
    let id = uuid::Uuid::new_v4().to_string();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    insert_version(&tx, book_id, &id, "automatic", &input)?;
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
    let previous = detail
        .versions
        .iter()
        .find(|v| v.id == detail.book.current_version_id)
        .ok_or("画册当前版本不存在")?;
    let mut input = previous.input.clone();
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
    book_layout::validate(conn, &input)?;
    let id = uuid::Uuid::new_v4().to_string();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    insert_version(&tx, book_id, &id, "manual", &input)?;
    tx.execute(
        "UPDATE books SET current_version_id=?1,updated_at=?2 WHERE id=?3",
        params![id, chrono::Utc::now().to_rfc3339(), book_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    get(conn, book_id)
}
pub fn select_version(
    conn: &mut Connection,
    book_id: &str,
    version_id: &str,
) -> Result<BookDetail, String> {
    source(conn, book_id, version_id)?;
    conn.execute(
        "UPDATE books SET current_version_id=?1 WHERE id=?2",
        params![version_id, book_id],
    )
    .map_err(|e| e.to_string())?;
    get(conn, book_id)
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
pub fn delete(conn: &mut Connection, id: &str) -> Result<(), String> {
    if conn
        .execute("DELETE FROM books WHERE id=?1", [id])
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err("画册不存在".into());
    }
    Ok(())
}

#[tauri::command]
pub fn books_list(store: State<'_, Store>) -> Result<Vec<BookSummary>, String> {
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    list(&conn)
}
#[tauri::command]
pub fn books_get(store: State<'_, Store>, id: String) -> Result<BookDetail, String> {
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    get(&conn, &id)
}
#[tauri::command]
pub fn books_create(store: State<'_, Store>, input: CreateBookInput) -> Result<BookDetail, String> {
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    create(&mut conn, input)
}
#[tauri::command]
pub fn books_save_version(
    store: State<'_, Store>,
    book_id: String,
    version_id: String,
    input: VersionInput,
) -> Result<BookDetail, String> {
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    save_version(&mut conn, &book_id, &version_id, input)
}
#[tauri::command]
pub fn books_reflow(
    store: State<'_, Store>,
    book_id: String,
    version_id: String,
    template: String,
) -> Result<BookDetail, String> {
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    reflow(&mut conn, &book_id, &version_id, &template)
}
#[tauri::command]
pub fn books_select_version(
    store: State<'_, Store>,
    book_id: String,
    version_id: String,
) -> Result<BookDetail, String> {
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    select_version(&mut conn, &book_id, &version_id)
}
#[tauri::command]
pub fn books_rename(
    store: State<'_, Store>,
    id: String,
    title: String,
) -> Result<BookDetail, String> {
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    rename(&mut conn, &id, &title)
}
#[tauri::command]
pub fn books_delete(store: State<'_, Store>, id: String) -> Result<(), String> {
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    delete(&mut conn, &id)
}

#[tauri::command]
pub fn books_append_photos(
    store: State<'_, Store>,
    book_id: String,
    photo_ids: Vec<String>,
) -> Result<BookDetail, String> {
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    append_photos(&mut conn, &book_id, photo_ids)
}
