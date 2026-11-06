use crate::{
    content_refs,
    db::{self, Store},
    models::Snapshot,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelInput {
    pub name: String,
    pub contact: String,
    pub city: String,
    pub tags: Vec<String>,
    #[serde(default)]
    pub tag_options: Option<Vec<String>>,
    pub notes: String,
    pub gender: String,
    pub birthday: String,
    pub height_cm: Option<f64>,
    pub weight_kg: Option<f64>,
    pub bust_cm: Option<f64>,
    pub waist_cm: Option<f64>,
    pub hips_cm: Option<f64>,
    pub photo_ids: Vec<String>,
    pub cover_photo_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfile {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(flatten)]
    pub input: ModelInput,
}

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS model_profiles (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL, city TEXT NOT NULL,
            tags TEXT NOT NULL, tag_options TEXT, notes TEXT NOT NULL, gender TEXT NOT NULL, birthday TEXT NOT NULL,
            height_cm REAL, weight_kg REAL, bust_cm REAL, waist_cm REAL, hips_cm REAL,
            cover_photo_id TEXT REFERENCES photos(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS model_photos (
            model_id TEXT NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
            photo_id TEXT NOT NULL REFERENCES photos(id), position INTEGER NOT NULL CHECK(position >= 0),
            PRIMARY KEY(model_id, photo_id), UNIQUE(model_id, position)
         );",
    ).map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare("PRAGMA table_info(model_profiles)")
        .map_err(|e| e.to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    if !columns.iter().any(|column| column == "tag_options") {
        conn.execute("ALTER TABLE model_profiles ADD COLUMN tag_options TEXT", [])
            .map_err(|e| e.to_string())?;
    }
    if !columns.iter().any(|column| column == "weight_kg") {
        conn.execute("ALTER TABLE model_profiles ADD COLUMN weight_kg REAL", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn validate(conn: &Connection, input: &ModelInput) -> Result<(), String> {
    content_refs::name(&input.name)?;
    for (value, label, max) in [
        (input.contact.as_str(), "联系方式", 500),
        (&input.city, "城市", 200),
        (&input.notes, "备注", 20000),
        (&input.gender, "性别", 40),
    ] {
        content_refs::text(value, label, max)?;
    }
    if input.tags.len() > 50 {
        return Err("风格标签最多 50 个".into());
    }
    for tag in &input.tags {
        if tag.trim().is_empty() {
            return Err("风格标签不能为空".into());
        }
        content_refs::text(tag, "风格标签", 80)?;
    }
    if let Some(options) = &input.tag_options {
        if options.len() > 100 {
            return Err("可选风格标签最多 100 个".into());
        }
        for option in options {
            if option.trim().is_empty() {
                return Err("可选风格标签不能为空".into());
            }
            content_refs::text(option, "可选风格标签", 80)?;
        }
        if input.tags.iter().any(|tag| !options.contains(tag)) {
            return Err("已选风格标签须来自当前可选标签".into());
        }
    }
    if !input.birthday.is_empty() {
        let date = chrono::NaiveDate::parse_from_str(&input.birthday, "%Y-%m-%d")
            .map_err(|_| "生日须为有效的 YYYY-MM-DD 日期")?;
        if date < chrono::NaiveDate::from_ymd_opt(1, 1, 1).expect("valid first date")
            || input.birthday.len() != 10
            || date.format("%Y-%m-%d").to_string() != input.birthday
            || date > chrono::Local::now().date_naive()
        {
            return Err("生日须为有效的 YYYY-MM-DD 日期，且不能晚于今天".into());
        }
    }
    for value in [
        input.height_cm,
        input.bust_cm,
        input.waist_cm,
        input.hips_cm,
    ]
    .into_iter()
    .flatten()
    {
        if !value.is_finite() || value <= 0.0 || value > 300.0 {
            return Err("身体数值须大于 0 且不超过 300 厘米".into());
        }
    }
    if input
        .weight_kg
        .is_some_and(|value| !value.is_finite() || value <= 0.0)
    {
        return Err("体重须为大于 0 的有效数值".into());
    }
    content_refs::validate_photos(conn, &input.photo_ids)?;
    if input
        .cover_photo_id
        .as_ref()
        .is_some_and(|id| !input.photo_ids.contains(id))
    {
        return Err("封面须来自当前样片".into());
    }
    Ok(())
}

fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModelProfile> {
    let tags: String = row.get(4)?;
    let tags = serde_json::from_str(&tags).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
    })?;
    let options: Option<String> = row.get(15)?;
    let tag_options = options
        .map(|json| {
            serde_json::from_str(&json).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    15,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })
        })
        .transpose()?;
    Ok(ModelProfile {
        id: row.get(0)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        input: ModelInput {
            name: row.get(1)?,
            contact: row.get(2)?,
            city: row.get(3)?,
            tags,
            tag_options,
            notes: row.get(5)?,
            gender: row.get(6)?,
            birthday: row.get(7)?,
            height_cm: row.get(8)?,
            weight_kg: row.get(16)?,
            bust_cm: row.get(9)?,
            waist_cm: row.get(10)?,
            hips_cm: row.get(11)?,
            cover_photo_id: row.get(12)?,
            photo_ids: Vec::new(),
        },
    })
}

pub fn list(conn: &Connection) -> Result<Vec<ModelProfile>, String> {
    let mut statement = conn.prepare("SELECT id,name,contact,city,tags,notes,gender,birthday,height_cm,bust_cm,waist_cm,hips_cm,cover_photo_id,created_at,updated_at,tag_options,weight_kg FROM model_profiles ORDER BY updated_at DESC,id").map_err(|e| e.to_string())?;
    let mut profiles = statement
        .query_map([], read)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for profile in &mut profiles {
        profile.input.photo_ids = content_refs::read_photos(
            conn,
            "SELECT photo_id,position FROM model_photos WHERE model_id=?1 ORDER BY position",
            &profile.id,
        )?;
    }
    Ok(profiles)
}

pub fn validate_all(conn: &Connection) -> Result<(), String> {
    for profile in list(conn)? {
        content_refs::timestamps(&profile.id, &profile.created_at, &profile.updated_at)?;
        validate(conn, &profile.input)?;
    }
    Ok(())
}

pub fn save(
    conn: &mut Connection,
    id: Option<&str>,
    mut input: ModelInput,
) -> Result<ModelProfile, String> {
    input.name = content_refs::name(&input.name)?;
    content_refs::deduplicate(&mut input.photo_ids);
    input
        .tags
        .iter_mut()
        .for_each(|tag| *tag = tag.trim().to_string());
    content_refs::deduplicate(&mut input.tags);
    if let Some(options) = &mut input.tag_options {
        options
            .iter_mut()
            .for_each(|option| *option = option.trim().to_string());
        content_refs::deduplicate(options);
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    validate(&tx, &input)?;
    let now = chrono::Utc::now().to_rfc3339();
    let (id, created_at) = match id {
        Some(id) => {
            let created = tx
                .query_row(
                    "SELECT created_at FROM model_profiles WHERE id=?1",
                    [id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .ok_or("模特档案不存在")?;
            (id.to_string(), created)
        }
        None => (uuid::Uuid::new_v4().to_string(), now.clone()),
    };
    tx.execute("INSERT INTO model_profiles (id,name,contact,city,tags,notes,gender,birthday,height_cm,bust_cm,waist_cm,hips_cm,cover_photo_id,created_at,updated_at,tag_options,weight_kg) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,contact=excluded.contact,city=excluded.city,tags=excluded.tags,tag_options=excluded.tag_options,notes=excluded.notes,gender=excluded.gender,birthday=excluded.birthday,height_cm=excluded.height_cm,bust_cm=excluded.bust_cm,waist_cm=excluded.waist_cm,hips_cm=excluded.hips_cm,cover_photo_id=excluded.cover_photo_id,updated_at=excluded.updated_at,weight_kg=excluded.weight_kg",
        params![id,input.name,input.contact,input.city,serde_json::to_string(&input.tags).map_err(|e| e.to_string())?,input.notes,input.gender,input.birthday,input.height_cm,input.bust_cm,input.waist_cm,input.hips_cm,input.cover_photo_id,created_at,now,input.tag_options.as_ref().map(serde_json::to_string).transpose().map_err(|e| e.to_string())?,input.weight_kg])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM model_photos WHERE model_id=?1", [&id])
        .map_err(|e| e.to_string())?;
    for (position, photo_id) in input.photo_ids.iter().enumerate() {
        tx.execute(
            "INSERT INTO model_photos (model_id,photo_id,position) VALUES (?1,?2,?3)",
            params![id, photo_id, position as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ModelProfile {
        id,
        created_at,
        updated_at: now,
        input,
    })
}

pub fn delete(conn: &mut Connection, id: &str) -> Result<Snapshot, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let candidates = content_refs::deletion_candidates(
        &tx,
        "SELECT photo_id FROM model_photos WHERE model_id=?1
         UNION ALL SELECT cover_photo_id FROM model_profiles WHERE id=?1 AND cover_photo_id IS NOT NULL",
        id,
    )?;
    if tx
        .execute("DELETE FROM model_profiles WHERE id=?1", [id])
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err("模特档案不存在".into());
    }
    let snapshot = content_refs::snapshot_after_deletion(&tx, candidates)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(snapshot)
}

#[tauri::command]
pub fn models_list(store: State<'_, Store>) -> Result<Vec<ModelProfile>, String> {
    list(&*store.connection.lock().map_err(|e| e.to_string())?)
}
#[tauri::command]
pub fn models_save(
    store: State<'_, Store>,
    id: Option<String>,
    input: ModelInput,
) -> Result<ModelProfile, String> {
    save(
        &mut *store.connection.lock().map_err(|e| e.to_string())?,
        id.as_deref(),
        input,
    )
}
#[tauri::command]
pub async fn models_delete(app: AppHandle, id: String) -> Result<Snapshot, String> {
    db::with_connection(app, move |conn| delete(conn, &id)).await
}
