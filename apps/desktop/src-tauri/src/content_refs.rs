//! Shared validation and lifetime rules for persisted photo references.
use crate::{books, db, models::Snapshot};
use rusqlite::{Connection, OptionalExtension, Transaction};
use std::collections::HashSet;

pub fn text(value: &str, label: &str, max: usize) -> Result<(), String> {
    if value.chars().count() > max || value.contains('\0') {
        return Err(format!("{label}最多 {max} 个字符，且不能包含空字符"));
    }
    Ok(())
}

pub fn name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("名称不能为空".into());
    }
    text(value, "名称", 200)?;
    Ok(value.into())
}

pub fn deduplicate(values: &mut Vec<String>) {
    let mut seen = HashSet::new();
    values.retain(|value| seen.insert(value.clone()));
}

pub fn validate_photos(conn: &Connection, ids: &[String]) -> Result<(), String> {
    let mut statement = conn
        .prepare("SELECT 1 FROM photos WHERE id=?1 AND hidden_after_album_delete=0")
        .map_err(|e| e.to_string())?;
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            return Err("照片引用重复".into());
        }
        if statement
            .query_row([id], |_| Ok(()))
            .optional()
            .map_err(|e| e.to_string())?
            .is_none()
        {
            return Err("引用的照片不存在于当前图库".into());
        }
    }
    Ok(())
}

pub(crate) fn deletion_candidates(
    tx: &Transaction<'_>,
    sql: &str,
    id: &str,
) -> Result<HashSet<String>, String> {
    let mut statement = tx.prepare(sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
}

// Only consider photos used by the deleted record. Its own references have
// already been removed by cascade; discarded album members still count.
pub(crate) fn snapshot_after_deletion(
    tx: &Transaction<'_>,
    mut candidates: HashSet<String>,
) -> Result<Snapshot, String> {
    if !candidates.is_empty() {
        let mut statement = tx
            .prepare(
                "SELECT photo_id FROM memberships
             UNION ALL SELECT photo_id FROM model_photos
             UNION ALL SELECT cover_photo_id FROM model_profiles WHERE cover_photo_id IS NOT NULL
             UNION ALL SELECT photo_id FROM shoot_plan_photos
             UNION ALL SELECT photo_id FROM social_photos",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = statement.query([]).map_err(|e| e.to_string())?;
        while !candidates.is_empty() {
            let Some(row) = rows.next().map_err(|e| e.to_string())? else {
                break;
            };
            let id = row.get::<_, String>(0).map_err(|e| e.to_string())?;
            candidates.remove(&id);
        }
    }
    books::exclude_currently_referenced_photos(tx, &mut candidates)?;
    if !candidates.is_empty() {
        let mut hide = tx
            .prepare("UPDATE photos SET hidden_after_album_delete=1 WHERE id=?1")
            .map_err(|e| e.to_string())?;
        for photo_id in candidates {
            if hide.execute([photo_id]).map_err(|e| e.to_string())? != 1 {
                return Err("照片引用不完整".into());
            }
        }
    }
    db::snapshot(tx)
}

// Callers supply only module-owned SQL; positions must be contiguous even for restored data.
pub fn read_photos(conn: &Connection, sql: &str, id: &str) -> Result<Vec<String>, String> {
    let mut statement = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut ids = Vec::new();
    for row in rows {
        let (id, position) = row.map_err(|e| e.to_string())?;
        if position != ids.len() as i64 {
            return Err("照片引用排序不完整".into());
        }
        ids.push(id);
    }
    Ok(ids)
}

pub fn timestamps(id: &str, created: &str, updated: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "记录标识无效")?;
    let created = chrono::DateTime::parse_from_rfc3339(created).map_err(|_| "创建时间无效")?;
    let updated = chrono::DateTime::parse_from_rfc3339(updated).map_err(|_| "修改时间无效")?;
    if updated < created {
        return Err("修改时间早于创建时间".into());
    }
    Ok(())
}
