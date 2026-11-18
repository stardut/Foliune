use crate::locale::{display_format, tr};
use crate::{
    content_refs,
    db::{self, Store},
    models::Snapshot,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::{AppHandle, State};

pub const MAX_REFERENCES: usize = 120;
pub const MAX_SCENE_REFERENCES: usize = 3;
pub const MAX_PARTS: usize = 20;
pub const MAX_SHOTS: usize = 100;
pub const MAX_TEXT: usize = 20_000;
pub const MAX_TITLE: usize = 200;
pub const MAX_DATE: usize = 100;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanReference {
    pub id: String,
    pub photo_id: String,
    pub intent: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlanPriority {
    Normal,
    Must,
    Try,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanShot {
    pub id: String,
    pub title: String,
    pub description: String,
    pub pose: String,
    pub composition: String,
    pub lighting: String,
    pub mood: String,
    pub priority: PlanPriority,
    pub references: Vec<PlanReference>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanPart {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(default)]
    pub shot_list: String,
    pub scene: String,
    pub styling: String,
    pub lighting: String,
    #[serde(default)]
    pub focal_length: String,
    pub mood: String,
    pub time_window: String,
    pub references: Vec<PlanReference>,
    pub shots: Vec<PlanShot>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShootPlanInput {
    pub title: String,
    pub concept: String,
    #[serde(default)]
    pub execution_date: String,
    pub shoot_date: String,
    pub location: String,
    pub team: String,
    pub deliverables: String,
    pub visual_direction: String,
    #[serde(default)]
    pub styling: String,
    #[serde(default)]
    pub props: String,
    #[serde(default)]
    pub equipment: String,
    pub preparation: String,
    pub references: Vec<PlanReference>,
    pub parts: Vec<PlanPart>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShootPlan {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(flatten)]
    pub input: ShootPlanInput,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u32,
    input: ShootPlanInput,
}

fn encode(input: &ShootPlanInput) -> Result<String, String> {
    serde_json::to_string(&Document {
        version: 2,
        input: input.clone(),
    })
    .map_err(|e| e.to_string())
}

fn decode(json: &str) -> Result<ShootPlanInput, String> {
    let document: Document = serde_json::from_str(json)
        .map_err(|_| tr("拍摄策划文档格式无效", "Invalid shoot plan document format"))?;
    if document.version != 2 {
        return Err(tr(
            "拍摄策划文档版本不支持",
            "Unsupported shoot plan document version",
        )
        .into());
    }
    Ok(document.input)
}

pub fn init(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn.query_row("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('shoot_plans','shoot_plan_photos')", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if count != 0 && count != 2 {
        return Err(tr("拍摄策划数据表不完整", "Shoot plan tables are incomplete").into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS shoot_plans (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, concept TEXT NOT NULL,
            shoot_date TEXT NOT NULL, location TEXT NOT NULL, team TEXT NOT NULL,
            styling TEXT NOT NULL, lighting TEXT NOT NULL, shot_list TEXT NOT NULL,
            notes TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            document_json TEXT
         );
         CREATE TABLE IF NOT EXISTS shoot_plan_photos (
            plan_id TEXT NOT NULL REFERENCES shoot_plans(id) ON DELETE CASCADE,
            photo_id TEXT NOT NULL REFERENCES photos(id), position INTEGER NOT NULL CHECK(position >= 0),
            PRIMARY KEY(plan_id, photo_id), UNIQUE(plan_id, position)
         );",
    ).map_err(|e| e.to_string())?;
    let columns = table_columns(&tx, "PRAGMA table_info(shoot_plans)")?;
    for required in [
        "id",
        "title",
        "concept",
        "shoot_date",
        "location",
        "team",
        "styling",
        "lighting",
        "shot_list",
        "notes",
        "created_at",
        "updated_at",
    ] {
        if !columns.contains(required) {
            return Err(tr("拍摄策划数据结构不完整", "Shoot plan data is incomplete").into());
        }
    }
    let photo_columns = table_columns(&tx, "PRAGMA table_info(shoot_plan_photos)")?;
    if ["plan_id", "photo_id", "position"]
        .iter()
        .any(|column| !photo_columns.contains(*column))
    {
        return Err(tr(
            "拍摄策划照片引用结构不完整",
            "Shoot plan photo references are incomplete",
        )
        .into());
    }
    // Absence of this column is the only v1 marker. A null or malformed v2 document is corruption.
    if !columns.contains("document_json") {
        tx.execute_batch("ALTER TABLE shoot_plans ADD COLUMN document_json TEXT;")
            .map_err(|e| e.to_string())?;
        migrate_v1(&tx)?;
    }
    validate_all(&tx)?;
    tx.commit().map_err(|e| e.to_string())
}

fn table_columns(conn: &Connection, sql: &str) -> Result<HashSet<String>, String> {
    let mut statement = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|e| e.to_string())
}

fn read_photo_union(conn: &Connection, id: &str) -> Result<Vec<String>, String> {
    content_refs::read_photos(
        conn,
        "SELECT photo_id,position FROM shoot_plan_photos WHERE plan_id=?1 ORDER BY position",
        id,
    )
}

fn migrate_v1(conn: &Connection) -> Result<(), String> {
    let mut statement = conn.prepare("SELECT id,title,concept,shoot_date,location,team,styling,lighting,shot_list,notes FROM shoot_plans").map_err(|e| e.to_string())?;
    let records = statement
        .query_map([], |row| {
            let styling: String = row.get(6)?;
            let lighting: String = row.get(7)?;
            let shot_list: String = row.get(8)?;
            let parts = if styling.is_empty() && lighting.is_empty() && shot_list.is_empty() {
                Vec::new()
            } else {
                vec![PlanPart {
                    id: uuid::Uuid::new_v4().to_string(),
                    title: "原拍摄安排".into(),
                    description: String::new(),
                    shot_list,
                    styling,
                    lighting,
                    focal_length: String::new(),
                    scene: String::new(),
                    mood: String::new(),
                    time_window: String::new(),
                    references: Vec::new(),
                    shots: Vec::new(),
                }]
            };
            Ok((
                row.get::<_, String>(0)?,
                ShootPlanInput {
                    title: row.get(1)?,
                    concept: row.get(2)?,
                    execution_date: String::new(),
                    shoot_date: row.get(3)?,
                    location: row.get(4)?,
                    team: row.get(5)?,
                    preparation: row.get(9)?,
                    deliverables: String::new(),
                    visual_direction: String::new(),
                    styling: String::new(),
                    props: String::new(),
                    equipment: String::new(),
                    references: Vec::new(),
                    parts,
                },
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    for (id, mut input) in records {
        input.references = read_photo_union(conn, &id)?
            .into_iter()
            .map(|photo_id| PlanReference {
                id: uuid::Uuid::new_v4().to_string(),
                photo_id,
                intent: String::new(),
            })
            .collect();
        validate(conn, &input)?;
        conn.execute(
            "UPDATE shoot_plans SET document_json=?1 WHERE id=?2",
            params![encode(&input)?, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn structural_id(id: &str, seen: &mut HashSet<String>) -> Result<(), String> {
    content_refs::text(id, tr("结构标识", "Structure ID"), MAX_TITLE)?;
    if id.trim().is_empty() || !seen.insert(id.to_owned()) {
        return Err(tr(
            "拍摄组、画面和参考的标识不能为空或重复",
            "Scene, shot, and reference IDs must be present and unique",
        )
        .into());
    }
    Ok(())
}

fn references<'a>(input: &'a ShootPlanInput) -> impl Iterator<Item = &'a PlanReference> {
    input
        .references
        .iter()
        .chain(input.parts.iter().flat_map(|part| {
            part.references
                .iter()
                .chain(part.shots.iter().flat_map(|shot| shot.references.iter()))
        }))
}

fn photo_union(input: &ShootPlanInput) -> Vec<String> {
    let mut seen = HashSet::new();
    references(input)
        .filter_map(|reference| {
            seen.insert(&reference.photo_id)
                .then(|| reference.photo_id.clone())
        })
        .collect()
}

fn validate(conn: &Connection, input: &ShootPlanInput) -> Result<(), String> {
    content_refs::name(&input.title)?;
    content_refs::text(&input.title, tr("策划名称", "Plan name"), MAX_TITLE)?;
    let date = &input.execution_date;
    if !date.is_empty()
        && (date.len() != 10
            || date.starts_with("0000")
            || !chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .is_ok_and(|parsed| parsed.format("%Y-%m-%d").to_string() == *date))
    {
        return Err(tr(
            "执行日期须为有效的 YYYY-MM-DD 日期",
            "Enter a valid shoot date in YYYY-MM-DD format",
        )
        .into());
    }
    content_refs::text(&input.shoot_date, tr("拍摄时间", "Shoot time"), MAX_DATE)?;
    for value in [
        &input.concept,
        &input.location,
        &input.team,
        &input.deliverables,
        &input.visual_direction,
        &input.styling,
        &input.props,
        &input.equipment,
        &input.preparation,
    ] {
        content_refs::text(value, tr("策划内容", "Plan content"), MAX_TEXT)?;
    }
    if input.parts.len() > MAX_PARTS {
        return Err(display_format!(
            "拍摄组最多 {MAX_PARTS} 组",
            "A plan can contain up to {MAX_PARTS} scenes"
        ));
    }
    if input
        .parts
        .iter()
        .map(|part| part.shots.len())
        .sum::<usize>()
        > MAX_SHOTS
    {
        return Err(display_format!(
            "目标画面总数最多 {MAX_SHOTS} 个",
            "A plan can contain up to {MAX_SHOTS} shots"
        ));
    }
    if references(input).count() > MAX_REFERENCES {
        return Err(display_format!(
            "策划参考总数最多 {MAX_REFERENCES} 个",
            "A plan can contain up to {MAX_REFERENCES} references"
        ));
    }
    let mut seen = HashSet::new();
    for part in &input.parts {
        structural_id(&part.id, &mut seen)?;
        content_refs::text(&part.title, tr("拍摄组名称", "Scene name"), MAX_TITLE)?;
        content_refs::text(&part.time_window, tr("拍摄组时间", "Scene time"), MAX_DATE)?;
        for value in [
            &part.description,
            &part.shot_list,
            &part.scene,
            &part.styling,
            &part.lighting,
            &part.focal_length,
            &part.mood,
        ] {
            content_refs::text(value, tr("拍摄组内容", "Scene content"), MAX_TEXT)?;
        }
        for shot in &part.shots {
            structural_id(&shot.id, &mut seen)?;
            content_refs::text(&shot.title, tr("画面名称", "Shot name"), MAX_TITLE)?;
            for value in [
                &shot.description,
                &shot.pose,
                &shot.composition,
                &shot.lighting,
                &shot.mood,
            ] {
                content_refs::text(value, tr("画面内容", "Shot content"), MAX_TEXT)?;
            }
        }
    }
    for reference in references(input) {
        structural_id(&reference.id, &mut seen)?;
        content_refs::text(&reference.photo_id, tr("照片标识", "Photo ID"), MAX_TITLE)?;
        content_refs::text(
            &reference.intent,
            tr("参考意图", "Reference note"),
            MAX_TEXT,
        )?;
    }
    content_refs::validate_photos(conn, &photo_union(input))
}

type PlanRow = (String, String, String, String);

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PlanRow> {
    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
}

fn read_plan(conn: &Connection, row: PlanRow) -> Result<ShootPlan, String> {
    let (id, created_at, updated_at, json) = row;
    let input = decode(&json)?;
    content_refs::timestamps(&id, &created_at, &updated_at)?;
    validate(conn, &input)?;
    if read_photo_union(conn, &id)? != photo_union(&input) {
        return Err(tr(
            "拍摄策划文档与照片引用不一致",
            "The shoot plan document and photo references do not match",
        )
        .into());
    }
    Ok(ShootPlan {
        id,
        created_at,
        updated_at,
        input,
    })
}

pub fn get(conn: &Connection, id: &str) -> Result<ShootPlan, String> {
    let row = conn
        .query_row(
            "SELECT id,created_at,updated_at,document_json FROM shoot_plans WHERE id=?1",
            [id],
            read_row,
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or(tr("拍摄策划不存在", "This shoot plan no longer exists."))?;
    read_plan(conn, row)
}

pub fn list(conn: &Connection) -> Result<Vec<ShootPlan>, String> {
    let mut statement = conn.prepare("SELECT id,created_at,updated_at,document_json FROM shoot_plans ORDER BY updated_at DESC,id").map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], read_row)
        .map_err(|e| e.to_string())?;
    rows.map(|row| read_plan(conn, row.map_err(|e| e.to_string())?))
        .collect()
}

pub fn validate_all(conn: &Connection) -> Result<(), String> {
    list(conn)?;
    let orphan: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM shoot_plan_photos p LEFT JOIN shoot_plans s ON s.id=p.plan_id WHERE s.id IS NULL)", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if orphan {
        return Err(tr(
            "拍摄策划照片引用缺少所属策划",
            "A shoot plan photo reference has no matching plan",
        )
        .into());
    }
    Ok(())
}

pub fn save(
    conn: &mut Connection,
    id: Option<&str>,
    input: ShootPlanInput,
) -> Result<ShootPlan, String> {
    save_inner(conn, id, None, input)
}

pub fn update(
    conn: &mut Connection,
    id: &str,
    expected_revision: &str,
    input: ShootPlanInput,
) -> Result<ShootPlan, String> {
    save_inner(conn, Some(id), Some(expected_revision), input)
}

fn save_inner(
    conn: &mut Connection,
    id: Option<&str>,
    expected_revision: Option<&str>,
    mut input: ShootPlanInput,
) -> Result<ShootPlan, String> {
    let tx = conn.savepoint().map_err(|e| e.to_string())?;
    let existing = id
        .map(|id| {
            tx.query_row(
                "SELECT created_at,updated_at FROM shoot_plans WHERE id=?1",
                [id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| tr("拍摄策划不存在", "This shoot plan no longer exists.").to_string())
        })
        .transpose()?;
    let previous = existing.as_ref().map(|(_, updated)| updated.as_str());
    if expected_revision.is_some() && expected_revision != previous {
        return Err(db::revision_conflict().into());
    }
    input.title = content_refs::name(&input.title)?;
    if input.execution_date.is_empty() {
        return Err(tr("请选择执行日期", "Choose a shoot date").into());
    }
    validate(&tx, &input)?;
    for (index, part) in input.parts.iter().enumerate() {
        if part.references.len() > MAX_SCENE_REFERENCES {
            let title = part.title.trim();
            let name = if title.is_empty() {
                display_format!("场景 {}", "Scene {}", index + 1)
            } else {
                display_format!("场景 {}「{title}」", "Scene {} “{title}”", index + 1)
            };
            return Err(display_format!(
                "{name}最多 {MAX_SCENE_REFERENCES} 张参考图，请整理后保存", "{name} can have up to {MAX_SCENE_REFERENCES} reference photos. Remove extras before saving."
            ));
        }
    }
    let now = db::next_revision(previous);
    let id = id
        .map(str::to_owned)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let created_at = existing
        .map(|(created, _)| created)
        .unwrap_or_else(|| now.clone());
    tx.execute("INSERT INTO shoot_plans (id,title,concept,shoot_date,location,team,styling,lighting,shot_list,notes,created_at,updated_at,document_json)
        VALUES (?1,?2,?3,?4,?5,?6,'','','','',?7,?8,?9)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,concept=excluded.concept,shoot_date=excluded.shoot_date,
        location=excluded.location,team=excluded.team,styling='',lighting='',shot_list='',notes='',updated_at=excluded.updated_at,document_json=excluded.document_json",
        params![id,input.title,input.concept,input.shoot_date,input.location,input.team,created_at,now,encode(&input)?]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM shoot_plan_photos WHERE plan_id=?1", [&id])
        .map_err(|e| e.to_string())?;
    for (position, photo_id) in photo_union(&input).iter().enumerate() {
        tx.execute(
            "INSERT INTO shoot_plan_photos (plan_id,photo_id,position) VALUES (?1,?2,?3)",
            params![id, photo_id, position as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ShootPlan {
        id,
        created_at,
        updated_at: now,
        input,
    })
}

pub fn delete(conn: &mut Connection, id: &str) -> Result<Snapshot, String> {
    let tx = conn.savepoint().map_err(|e| e.to_string())?;
    delete_record(&tx, id)?;
    let snapshot = db::snapshot(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(snapshot)
}

pub(crate) fn delete_record(conn: &Connection, id: &str) -> Result<(), String> {
    let candidates = content_refs::deletion_candidates(
        conn,
        "SELECT photo_id FROM shoot_plan_photos WHERE plan_id=?1",
        id,
    )?;
    if conn
        .execute("DELETE FROM shoot_plans WHERE id=?1", [id])
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err(tr("拍摄策划不存在", "This shoot plan no longer exists.").into());
    }
    content_refs::hide_unreferenced_photos(conn, candidates)
}

#[tauri::command]
pub fn plans_list(store: State<'_, Store>) -> Result<Vec<ShootPlan>, String> {
    list(&*store.connection.lock().map_err(|e| e.to_string())?)
}
#[tauri::command]
pub async fn plans_save(
    app: AppHandle,
    id: Option<String>,
    input: ShootPlanInput,
    expected_revision: Option<String>,
) -> Result<ShootPlan, String> {
    db::with_connection(app, move |conn| {
        db::write(conn, |conn| match id.as_deref() {
            Some(id) => update(
                conn,
                id,
                expected_revision
                    .as_deref()
                    .ok_or_else(db::revision_conflict)?,
                input,
            ),
            None => save(conn, None, input),
        })
    })
    .await
}
#[tauri::command]
pub async fn plans_delete(
    app: AppHandle,
    id: String,
    expected_revision: String,
) -> Result<Snapshot, String> {
    db::with_connection(app, move |conn| {
        db::write(conn, |conn| {
            db::check_revision(&get(conn, &id)?.updated_at, &expected_revision)?;
            delete(conn, &id)
        })
    })
    .await
}
