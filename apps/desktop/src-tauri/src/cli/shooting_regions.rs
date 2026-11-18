use super::{catalog::album_error, Failure, NOT_FOUND};
use crate::{groups, photos};
use rusqlite::{params, Connection};
use serde::Serialize;

const REGION_LABELS: &str = include_str!(concat!(env!("OUT_DIR"), "/shooting-region-labels.json"));

pub(super) fn resolve(input: &str) -> Result<String, Failure> {
    let labels: Vec<[String; 4]> = serde_json::from_str(REGION_LABELS).map_err(|error| {
        Failure::new("OPERATION_FAILED", format!("无法读取拍摄地区目录：{error}"))
    })?;
    let input = input.trim();
    if let Some([id, ..]) = labels.iter().find(|[id, ..]| id == input) {
        return Ok(id.clone());
    }

    let name = input.to_lowercase();
    let matches: Vec<_> = labels
        .iter()
        .filter(|[_, chinese, _, english]| {
            !name.is_empty() && (chinese == input || english.to_lowercase() == name)
        })
        .collect();
    match matches.as_slice() {
        [[id, ..]] => Ok(id.clone()),
        [] => Err(Failure::new(
            "VALIDATION_ERROR",
            format!("未找到拍摄地区「{input}」，请使用完整地区名称或地区 ID"),
        )),
        _ => {
            let candidates = matches
                .iter()
                .map(|[id, chinese, context, english]| {
                    format!("{chinese} · {context}（{english}，{id}）")
                })
                .collect::<Vec<_>>()
                .join("、");
            Err(Failure::new(
                "VALIDATION_ERROR",
                format!("拍摄地区「{input}」对应多个地区，请使用地区 ID。候选：{candidates}"),
            ))
        }
    }
}

pub(super) enum Target<'a> {
    Photo(&'a str),
    Album { id: &'a str, skip_gps: bool },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RegionAssignment<'a> {
    region_id: &'a str,
    updated_count: usize,
    skipped_gps_count: usize,
    unchanged_count: usize,
}

pub(super) fn assign<'a>(
    conn: &Connection,
    target: Target<'_>,
    region_id: &'a str,
) -> Result<RegionAssignment<'a>, String> {
    let has_region_column: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('photos') WHERE name='location_region_id')",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !has_region_column {
        return Err("图库尚未支持拍摄地区，请先用新版 Foliune 桌面端打开图库".into());
    }

    let (id, query, skip_gps) = match target {
        Target::Photo(id) => (
            id,
            "SELECT id,location,location_region_id FROM photos
             WHERE id=?1 AND hidden_after_album_delete=0",
            false,
        ),
        Target::Album { id, skip_gps } => {
            let library = groups::group_library(conn, id).map_err(album_error)?;
            if library != "work" {
                return Err("整本设置拍摄地区仅适用于作品相簿".into());
            }
            (
                id,
                "SELECT p.id,p.location,p.location_region_id FROM memberships m
                 JOIN photos p ON p.id=m.photo_id
                 WHERE m.group_id=?1 AND m.status='active' AND p.library='work'
                   AND p.hidden_after_album_delete=0",
                skip_gps,
            )
        }
    };
    let mut select = conn.prepare(query).map_err(|error| error.to_string())?;
    let rows = select
        .query_map([id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    if matches!(target, Target::Photo(_)) && rows.is_empty() {
        return Err(NOT_FOUND.into());
    }

    let mut result = RegionAssignment {
        region_id,
        updated_count: 0,
        skipped_gps_count: 0,
        unchanged_count: 0,
    };
    let mut update = conn
        .prepare("UPDATE photos SET location_region_id=?1 WHERE id=?2")
        .map_err(|error| error.to_string())?;
    for (id, location, assigned_region) in rows {
        if skip_gps && photos::has_gps_location(&location) {
            result.skipped_gps_count += 1;
        } else if assigned_region == region_id {
            result.unchanged_count += 1;
        } else {
            result.updated_count += update
                .execute(params![region_id, id])
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(result)
}
