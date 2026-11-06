use crate::{
    content_refs,
    db::snapshot,
    models::{self, AlbumCover, GroupInput, Snapshot},
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashSet;

pub(crate) fn init_covers(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS album_covers (
           group_id TEXT NOT NULL PRIMARY KEY,
           photo_id TEXT NOT NULL,
           offset_x REAL NOT NULL CHECK(offset_x BETWEEN 0 AND 1),
           offset_y REAL NOT NULL CHECK(offset_y BETWEEN 0 AND 1),
           zoom REAL NOT NULL CHECK(zoom BETWEEN 1 AND 3),
           FOREIGN KEY(group_id, photo_id) REFERENCES memberships(group_id, photo_id) ON DELETE CASCADE
         );",
    )
    .map_err(|error| error.to_string())
}

pub fn create(conn: &Connection, input: GroupInput) -> Result<Snapshot, String> {
    models::library(&input.library)?;
    let name = models::name(&input.name)?;
    if input.capacity == Some(0) {
        return Err("分组容量必须大于 0".into());
    }
    conn.execute("INSERT INTO groups(id,library,name,description,capacity,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
        params![uuid::Uuid::new_v4().to_string(), input.library, name, input.description.trim(), input.capacity, chrono::Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
    snapshot(conn)
}

pub fn group_library(conn: &Connection, id: &str) -> Result<String, String> {
    conn.query_row("SELECT library FROM groups WHERE id=?1", [id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "分组不存在".into())
}

pub fn ensure_capacity(conn: &Connection, id: &str, additional: usize) -> Result<(), String> {
    let capacity: Option<u32> = conn
        .query_row("SELECT capacity FROM groups WHERE id=?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    let active: u32 = conn
        .query_row(
            "SELECT COUNT(*) FROM memberships WHERE group_id=?1 AND status='active'",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if capacity.is_some_and(|cap| active as usize + additional > cap as usize) {
        return Err("分组容量不足，请先调整容量或废弃组内照片；此次操作尚未保存。".into());
    }
    Ok(())
}

pub fn update(conn: &mut Connection, id: &str, patch: Value) -> Result<Snapshot, String> {
    group_library(conn, id)?;
    let object = patch.as_object().ok_or("无效分组修改")?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (key, value) in object {
        match key.as_str() {
            "name" => {
                let name = models::name(value.as_str().ok_or("分组名称必须是文本")?)?;
                tx.execute("UPDATE groups SET name=?1 WHERE id=?2", params![name, id])
                    .map_err(|e| e.to_string())?;
            }
            "description" => {
                let description = value.as_str().ok_or("分组描述必须是文本")?;
                tx.execute(
                    "UPDATE groups SET description=?1 WHERE id=?2",
                    params![description.trim(), id],
                )
                .map_err(|e| e.to_string())?;
            }
            "capacity" => {
                let capacity = if value.is_null() {
                    None
                } else {
                    let count = value
                        .as_u64()
                        .filter(|n| *n > 0 && *n <= u32::MAX as u64)
                        .ok_or("分组容量必须为正整数或无限制")?;
                    Some(count as u32)
                };
                let active: u32 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM memberships WHERE group_id=?1 AND status='active'",
                        [id],
                        |r| r.get(0),
                    )
                    .map_err(|e| e.to_string())?;
                if capacity.is_some_and(|cap| cap < active) {
                    return Err("新容量不能小于当前有效照片数".into());
                }
                tx.execute(
                    "UPDATE groups SET capacity=?1 WHERE id=?2",
                    params![capacity, id],
                )
                .map_err(|e| e.to_string())?;
            }
            "cover" => update_cover(&tx, id, value)?,
            _ => return Err(format!("不支持修改分组字段：{key}")),
        }
    }
    let updated = snapshot(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(updated)
}

fn update_cover(tx: &Transaction<'_>, group_id: &str, value: &Value) -> Result<(), String> {
    let cover = AlbumCover::deserialize(value).map_err(|_| "相簿封面参数无效")?;
    if !(0.0..=1.0).contains(&cover.offset_x)
        || !(0.0..=1.0).contains(&cover.offset_y)
        || !(1.0..=3.0).contains(&cover.zoom)
    {
        return Err("相簿封面的取景范围无效".into());
    }
    let active = tx
        .query_row(
            "SELECT EXISTS (
               SELECT 1 FROM memberships m JOIN photos p ON p.id=m.photo_id
               WHERE m.group_id=?1 AND m.photo_id=?2 AND m.status='active'
                 AND p.hidden_after_album_delete=0
             )",
            params![group_id, cover.photo_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?;
    if !active {
        return Err("请选择当前相簿中未废弃的照片作为封面".into());
    }
    tx.execute(
        "INSERT INTO album_covers(group_id,photo_id,offset_x,offset_y,zoom) VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(group_id) DO UPDATE SET
           photo_id=excluded.photo_id,offset_x=excluded.offset_x,offset_y=excluded.offset_y,zoom=excluded.zoom",
        params![group_id, cover.photo_id, cover.offset_x, cover.offset_y, cover.zoom],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn delete(tx: &Transaction<'_>, id: &str) -> Result<Snapshot, String> {
    let candidates = content_refs::deletion_candidates(
        tx,
        "SELECT photo_id FROM memberships WHERE group_id=?1",
        id,
    )?;
    if tx
        .execute("DELETE FROM groups WHERE id=?1", [id])
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err("分组不存在".into());
    }
    content_refs::snapshot_after_deletion(tx, candidates)
}

pub fn add(
    conn: &mut Connection,
    group_id: &str,
    photo_ids: &[String],
) -> Result<Snapshot, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let library = group_library(&tx, group_id)?;
    let mut ids = Vec::new();
    let mut seen = HashSet::new();
    for id in photo_ids {
        if !seen.insert(id) {
            continue;
        }
        let photo_library: Option<String> = tx
            .query_row(
                "SELECT library FROM photos WHERE id=?1 AND hidden_after_album_delete=0",
                [id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if photo_library.as_deref() != Some(&library) {
            return Err("只能加入同一图库中存在的照片".into());
        }
        let active: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM memberships WHERE group_id=?1 AND photo_id=?2 AND status='active')", params![group_id,id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if !active {
            ids.push(id);
        }
    }
    ensure_capacity(&tx, group_id, ids.len())?;
    let position: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(position),-1)+1 FROM memberships WHERE group_id=?1",
            [group_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    for (index, id) in ids.iter().enumerate() {
        tx.execute("INSERT INTO memberships(group_id,photo_id,status,position) VALUES(?1,?2,'active',?3) ON CONFLICT(group_id,photo_id) DO UPDATE SET status='active'", params![group_id,id,position + index as i64]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    snapshot(conn)
}

#[cfg(test)]
pub fn set_status(
    conn: &mut Connection,
    group_id: &str,
    photo_id: &str,
    status: &str,
) -> Result<Snapshot, String> {
    set_statuses(conn, group_id, &[photo_id.to_string()], status)
}

pub fn set_statuses(
    conn: &mut Connection,
    group_id: &str,
    photo_ids: &[String],
    status: &str,
) -> Result<Snapshot, String> {
    if status != "active" && status != "discarded" {
        return Err("未知分组成员状态".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    group_library(&tx, group_id)?;
    let ids: HashSet<&String> = photo_ids.iter().collect();
    let mut restoring = 0;
    for photo_id in &ids {
        let current: Option<String> = tx
            .query_row(
                "SELECT status FROM memberships WHERE group_id=?1 AND photo_id=?2",
                params![group_id, photo_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let current = current.ok_or("照片不属于该分组")?;
        if status == "active" && current != "active" {
            restoring += 1;
        }
    }
    if restoring > 0 {
        ensure_capacity(&tx, group_id, restoring)?;
    }
    for photo_id in ids {
        tx.execute(
            "UPDATE memberships SET status=?1 WHERE group_id=?2 AND photo_id=?3",
            params![status, group_id, photo_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    snapshot(conn)
}
