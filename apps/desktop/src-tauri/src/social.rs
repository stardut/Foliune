use crate::{content_refs, db::Store};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum SocialPlatform {
    #[serde(rename = "moments")]
    Moments,
    #[serde(rename = "xiaohongshu")]
    Xiaohongshu,
    #[serde(rename = "instagram")]
    Instagram,
    #[serde(rename = "instagram-grid")]
    InstagramGrid,
}

impl SocialPlatform {
    fn key(self) -> &'static str {
        match self {
            Self::Moments => "moments",
            Self::Xiaohongshu => "xiaohongshu",
            Self::Instagram => "instagram",
            Self::InstagramGrid => "instagram-grid",
        }
    }
    // Foliune's simulation limits; these are not live platform API guarantees.
    fn photo_limit(self) -> usize {
        match self {
            Self::Moments => 9,
            Self::Xiaohongshu => 18,
            Self::Instagram => 20,
            Self::InstagramGrid => 60,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SocialInput {
    pub name: String,
    pub platform: SocialPlatform,
    pub display_name: String,
    pub title: String,
    pub body: String,
    pub photo_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialDraft {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(flatten)]
    pub input: SocialInput,
}

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS social_drafts (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        platform TEXT NOT NULL CHECK(platform IN ('moments','xiaohongshu','instagram','instagram-grid')),
        display_name TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
     );
     CREATE TABLE IF NOT EXISTS social_photos (
        draft_id TEXT NOT NULL REFERENCES social_drafts(id) ON DELETE CASCADE,
        photo_id TEXT NOT NULL REFERENCES photos(id), position INTEGER NOT NULL CHECK(position >= 0),
        PRIMARY KEY(draft_id,photo_id), UNIQUE(draft_id,position)
     );").map_err(|e| e.to_string())
}

fn validate(conn: &Connection, input: &SocialInput) -> Result<(), String> {
    content_refs::name(&input.name)?;
    content_refs::text(&input.display_name, "展示名", 200)?;
    content_refs::text(&input.title, "标题", 500)?;
    content_refs::text(&input.body, "正文", 50000)?;
    if input.photo_ids.len() > input.platform.photo_limit() {
        return Err(format!(
            "此排版模拟最多支持 {} 张照片",
            input.platform.photo_limit()
        ));
    }
    content_refs::validate_photos(conn, &input.photo_ids)
}

pub fn list(conn: &Connection) -> Result<Vec<SocialDraft>, String> {
    let mut statement = conn.prepare("SELECT id,name,platform,display_name,title,body,created_at,updated_at FROM social_drafts ORDER BY updated_at DESC,id").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut drafts = Vec::new();
    for row in rows {
        let (id, name, platform, display_name, title, body, created_at, updated_at) =
            row.map_err(|e| e.to_string())?;
        let platform = serde_json::from_value(serde_json::Value::String(platform))
            .map_err(|_| "排版草稿平台无效")?;
        let photo_ids = content_refs::read_photos(
            conn,
            "SELECT photo_id,position FROM social_photos WHERE draft_id=?1 ORDER BY position",
            &id,
        )?;
        drafts.push(SocialDraft {
            id,
            created_at,
            updated_at,
            input: SocialInput {
                name,
                platform,
                display_name,
                title,
                body,
                photo_ids,
            },
        });
    }
    Ok(drafts)
}

pub fn validate_all(conn: &Connection) -> Result<(), String> {
    for draft in list(conn)? {
        content_refs::timestamps(&draft.id, &draft.created_at, &draft.updated_at)?;
        validate(conn, &draft.input)?;
    }
    Ok(())
}

pub fn save(
    conn: &mut Connection,
    id: Option<&str>,
    mut input: SocialInput,
) -> Result<SocialDraft, String> {
    input.name = content_refs::name(&input.name)?;
    content_refs::deduplicate(&mut input.photo_ids);
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    validate(&tx, &input)?;
    let now = chrono::Utc::now().to_rfc3339();
    let (id, created_at) = match id {
        Some(id) => {
            let created = tx
                .query_row(
                    "SELECT created_at FROM social_drafts WHERE id=?1",
                    [id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .ok_or("排版草稿不存在")?;
            (id.to_string(), created)
        }
        None => (uuid::Uuid::new_v4().to_string(), now.clone()),
    };
    tx.execute("INSERT INTO social_drafts (id,name,platform,display_name,title,body,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,platform=excluded.platform,display_name=excluded.display_name,title=excluded.title,body=excluded.body,updated_at=excluded.updated_at",
        params![id,input.name,input.platform.key(),input.display_name,input.title,input.body,created_at,now]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM social_photos WHERE draft_id=?1", [&id])
        .map_err(|e| e.to_string())?;
    for (position, photo_id) in input.photo_ids.iter().enumerate() {
        tx.execute(
            "INSERT INTO social_photos (draft_id,photo_id,position) VALUES (?1,?2,?3)",
            params![id, photo_id, position as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(SocialDraft {
        id,
        created_at,
        updated_at: now,
        input,
    })
}

pub fn delete(conn: &Connection, id: &str) -> Result<(), String> {
    if conn
        .execute("DELETE FROM social_drafts WHERE id=?1", [id])
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err("排版草稿不存在".into());
    }
    Ok(())
}

#[tauri::command]
pub fn social_list(store: State<'_, Store>) -> Result<Vec<SocialDraft>, String> {
    list(&*store.connection.lock().map_err(|e| e.to_string())?)
}
#[tauri::command]
pub fn social_save(
    store: State<'_, Store>,
    id: Option<String>,
    input: SocialInput,
) -> Result<SocialDraft, String> {
    save(
        &mut *store.connection.lock().map_err(|e| e.to_string())?,
        id.as_deref(),
        input,
    )
}
#[tauri::command]
pub fn social_delete(store: State<'_, Store>, id: String) -> Result<(), String> {
    delete(&*store.connection.lock().map_err(|e| e.to_string())?, &id)
}
