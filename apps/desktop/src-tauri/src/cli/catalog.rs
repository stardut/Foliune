use super::NOT_FOUND;
use crate::{
    album_cover, db, groups,
    models::{Group, GroupInput, Membership, Photo, PhotoRegion},
    photos,
    work_directory::{self, BoundAvailability},
};
use image::{codecs::jpeg::JpegEncoder, ImageFormat, ImageReader};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashSet, io::Read, path::Path};

#[derive(Serialize)]
pub(super) struct Page<T> {
    items: Vec<T>,
    total: usize,
    limit: usize,
    offset: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PhotoRecord {
    id: String,
    library: String,
    title: String,
    original_name: String,
    original_available: Option<bool>,
    thumbnail_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    availability: Option<BoundAvailability>,
    width: u32,
    height: u32,
    tags: Vec<String>,
    regions: Vec<PhotoRegion>,
    annotation: String,
    source: String,
    captured_at: Option<String>,
    location: String,
    project: String,
    imported_at: String,
}

impl PhotoRecord {
    fn read(conn: &Connection, photo: Photo) -> Result<Self, String> {
        let (original_available, availability) =
            work_directory::probe_original_status(conn, &photo.id, &photo.original_path)?;
        let thumbnail_available = Path::new(&photo.thumbnail_path).is_file();
        Ok(Self {
            id: photo.id,
            library: photo.library,
            title: photo.title,
            original_name: photo.original_name,
            original_available,
            thumbnail_available,
            availability,
            width: photo.width,
            height: photo.height,
            tags: photo.tags,
            regions: photo.regions,
            annotation: photo.annotation,
            source: photo.source,
            captured_at: photo.captured_at,
            location: photo.location,
            project: photo.project,
            imported_at: photo.imported_at,
        })
    }
}

#[derive(Serialize)]
pub(super) struct PhotoResult {
    #[serde(flatten)]
    photo: PhotoRecord,
    memberships: Vec<Membership>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AlbumSummary {
    #[serde(flatten)]
    group: Group,
    active_count: usize,
    discarded_count: usize,
}

impl AlbumSummary {
    fn read(conn: &Connection, group: Group) -> Result<Self, String> {
        let (active_count, discarded_count) = conn
            .query_row(
                "SELECT COUNT(CASE WHEN m.status='active' THEN 1 END),
                        COUNT(CASE WHEN m.status='discarded' THEN 1 END)
                 FROM memberships m JOIN photos p ON p.id=m.photo_id
                 WHERE m.group_id=?1 AND p.hidden_after_album_delete=0",
                [&group.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| error.to_string())?;
        Ok(Self {
            group,
            active_count,
            discarded_count,
        })
    }
}

#[derive(Serialize)]
pub(super) struct AlbumResult {
    #[serde(flatten)]
    album: AlbumSummary,
    memberships: Vec<Membership>,
}

fn ensure_album(conn: &Connection, id: &str) -> Result<(), String> {
    groups::group_library(conn, id)
        .map(|_| ())
        .map_err(album_error)
}

fn album_error(error: String) -> String {
    if error == "分组不存在" {
        NOT_FOUND.into()
    } else {
        error
    }
}

fn matches_photo(photo: &Photo, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    // Match the desktop's searchable fields, including retained region annotations.
    [
        photo.title.as_str(),
        &photo.original_name,
        &photo.annotation,
        &photo.source,
        &photo.location,
        &photo.project,
    ]
    .into_iter()
    .chain(photo.tags.iter().map(String::as_str))
    .chain(photo.regions.iter().map(|region| region.text.as_str()))
    .collect::<Vec<_>>()
    .join(" ")
    .to_lowercase()
    .contains(query)
}

pub(super) fn search_photos(
    conn: &Connection,
    library: Option<&str>,
    album: Option<&str>,
    query: Option<&str>,
    limit: usize,
    offset: usize,
) -> Result<Page<PhotoRecord>, String> {
    if let Some(id) = album {
        ensure_album(conn, id)?;
    }
    let query = query.unwrap_or_default().trim().to_lowercase();
    let mut statement = conn
        .prepare(&format!(
            "{}
             LEFT JOIN memberships m ON m.photo_id=p.id AND m.group_id=?2 AND m.status='active'
             WHERE p.hidden_after_album_delete=0 AND (?1 IS NULL OR p.library=?1)
               AND (?2 IS NULL OR m.photo_id IS NOT NULL)
             ORDER BY m.position,p.imported_at DESC,p.id",
            db::PHOTO_SELECT
        ))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![library, album], db::photo_from_row)
        .map_err(|error| error.to_string())?;
    let mut total = 0;
    let mut items = Vec::new();
    for row in rows {
        let photo = row.map_err(|error| error.to_string())?;
        if matches_photo(&photo, &query) {
            if total >= offset && items.len() < limit {
                items.push(PhotoRecord::read(conn, photo)?);
            }
            total += 1;
        }
    }
    Ok(Page {
        items,
        total,
        limit,
        offset,
    })
}

pub(super) fn show_photo(conn: &Connection, id: &str) -> Result<PhotoResult, String> {
    let photo = conn
        .query_row(
            &format!(
                "{} WHERE p.id=?1 AND p.hidden_after_album_delete=0",
                db::PHOTO_SELECT
            ),
            [id],
            db::photo_from_row,
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or(NOT_FOUND)?;
    let memberships = memberships(
        conn,
        "SELECT group_id,photo_id,status,position FROM memberships
         WHERE photo_id=?1 ORDER BY group_id",
        id,
    )?;
    Ok(PhotoResult {
        photo: PhotoRecord::read(conn, photo)?,
        memberships,
    })
}

pub(super) fn preview_photo(conn: &Connection, id: &str) -> Result<Vec<u8>, String> {
    let thumbnail = conn
        .query_row(
            "SELECT thumbnail_path FROM photos WHERE id=?1 AND hidden_after_album_delete=0",
            [id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or(NOT_FOUND)?;
    let path = Path::new(&thumbnail);
    if path.parent() != Some(db::library_root(conn)?.join("thumbnails").as_path()) {
        return Err("照片缩略图不在当前图库的缩略图目录中".into());
    }
    let file = work_directory::open_file_at_path(path)
        .map_err(|error| format!("无法读取照片缩略图：{error}"))?;
    const MAX_BYTES: u64 = 16 * 1024 * 1024;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("无法读取照片缩略图：{error}"))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("照片缩略图文件过大".into());
    }
    let format = image::guess_format(&bytes).map_err(|error| format!("照片缩略图无效：{error}"))?;
    let mut reader = ImageReader::with_format(std::io::Cursor::new(&bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(photos::THUMBNAIL_MAX_EDGE);
    limits.max_image_height = Some(photos::THUMBNAIL_MAX_EDGE);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|error| format!("照片缩略图无法解码：{error}"))?;
    if format == ImageFormat::Jpeg {
        return Ok(bytes);
    }
    let mut jpeg = Vec::new();
    JpegEncoder::new(&mut jpeg)
        .encode_image(&photos::thumbnail_image(&image))
        .map_err(|error| format!("生成 JPEG 预览失败：{error}"))?;
    Ok(jpeg)
}

pub(super) fn update_photo(
    conn: &mut Connection,
    id: &str,
    patch: Value,
) -> Result<PhotoResult, String> {
    conn.query_row(
        "SELECT id FROM photos WHERE id=?1 AND hidden_after_album_delete=0",
        [id],
        |_| Ok(()),
    )
    .optional()
    .map_err(|error| error.to_string())?
    .ok_or(NOT_FOUND)?;
    require_fields(&patch, "无效照片修改")?;
    if patch.get("regions").is_some() {
        return Err("不支持修改照片字段：regions".into());
    }
    photos::apply_patch(conn, id, patch)?;
    show_photo(conn, id)
}

fn require_fields(patch: &Value, invalid: &str) -> Result<(), String> {
    let fields = patch.as_object().ok_or(invalid)?;
    if fields.is_empty() {
        return Err("请提供要更新的字段".into());
    }
    Ok(())
}

pub(super) fn list_albums(
    conn: &Connection,
    library: Option<&str>,
    limit: usize,
    offset: usize,
) -> Result<Page<AlbumSummary>, String> {
    let total = conn
        .query_row(
            "SELECT COUNT(*) FROM groups WHERE ?1 IS NULL OR library=?1",
            [library],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    let mut statement = conn
        .prepare(&format!(
            "{} WHERE (?1 IS NULL OR g.library=?1) ORDER BY g.created_at,g.id LIMIT ?2 OFFSET ?3",
            db::GROUP_SELECT
        ))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![library, limit, offset], db::group_from_row)
        .map_err(|error| error.to_string())?;
    let items = rows
        .map(|row| AlbumSummary::read(conn, row.map_err(|error| error.to_string())?))
        .collect::<Result<_, _>>()?;
    Ok(Page {
        items,
        total,
        limit,
        offset,
    })
}

fn memberships(conn: &Connection, sql: &str, id: &str) -> Result<Vec<Membership>, String> {
    let mut statement = conn.prepare(sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([id], db::membership_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<_, _>>()
        .map_err(|error| error.to_string())
}

pub(super) fn show_album(conn: &Connection, id: &str) -> Result<AlbumResult, String> {
    let album = AlbumSummary::read(conn, db::find_group(conn, id)?.ok_or(NOT_FOUND)?)?;
    let memberships = memberships(
        conn,
        "SELECT m.group_id,m.photo_id,m.status,m.position FROM memberships m
         JOIN photos p ON p.id=m.photo_id WHERE m.group_id=?1 AND p.hidden_after_album_delete=0
         ORDER BY m.position,m.photo_id",
        id,
    )?;
    Ok(AlbumResult { album, memberships })
}

pub(super) fn create_album(
    conn: &mut Connection,
    input: GroupInput,
) -> Result<AlbumResult, String> {
    let id = groups::insert(conn, input)?;
    show_album(conn, &id)
}

pub(super) fn update_album(
    conn: &mut Connection,
    id: &str,
    mut patch: Value,
) -> Result<AlbumResult, String> {
    require_fields(&patch, "无效分组修改")?;
    let fields = patch.as_object_mut().ok_or("无效分组修改")?;
    if let Some(selection) = fields.remove("discardPhotoIds") {
        let capacity = fields
            .get("capacity")
            .ok_or("指定取舍照片时必须提交新容量")?;
        let capacity =
            groups::parse_capacity(capacity)?.ok_or("指定取舍照片时必须提交有限的新容量")?;
        let selected: Vec<String> =
            serde_json::from_value(selection).map_err(|_| "取舍照片必须为 ID 数组")?;
        discard_for_capacity(conn, id, capacity, &selected)?;
    }
    groups::apply_patch(conn, id, patch).map_err(album_error)?;
    show_album(conn, id)
}

fn discard_for_capacity(
    conn: &Connection,
    id: &str,
    capacity: u32,
    ids: &[String],
) -> Result<(), String> {
    ensure_album(conn, id)?;
    let active_count = groups::active_count(conn, id)?;
    if capacity >= active_count {
        return Err("仅在新容量低于当前有效照片数时指定取舍照片".into());
    }
    let mut active = conn
        .prepare("SELECT 1 FROM memberships WHERE group_id=?1 AND photo_id=?2 AND status='active'")
        .map_err(|error| error.to_string())?;
    let mut seen = HashSet::new();
    for photo in ids {
        if !seen.insert(photo) {
            return Err("取舍照片 ID 重复".into());
        }
        if !active
            .exists(params![id, photo])
            .map_err(|error| error.to_string())?
        {
            return Err("请选择当前相簿中的有效照片进行取舍".into());
        }
    }
    if ids.len() < (active_count - capacity) as usize {
        return Err("取舍后剩余的照片超过新容量".into());
    }
    groups::set_member_statuses(conn, id, ids, "discarded").map_err(album_error)
}

pub(super) fn delete_album(conn: &mut Connection, id: &str) -> Result<(), String> {
    ensure_album(conn, id)?;
    work_directory::runtime::delete_album_records(conn, id)
}

pub(super) fn remove_album_cache(conn: &Connection, id: &str) {
    album_cover::remove_cached(conn, id);
}

pub(super) fn add_photos(
    conn: &mut Connection,
    id: &str,
    photos: &[String],
) -> Result<AlbumResult, String> {
    groups::add_members(conn, id, photos).map_err(album_error)?;
    show_album(conn, id)
}

pub(super) fn discard_photos(
    conn: &mut Connection,
    id: &str,
    photos: &[String],
) -> Result<AlbumResult, String> {
    groups::set_member_statuses(conn, id, photos, "discarded").map_err(album_error)?;
    show_album(conn, id)
}

pub(super) fn restore_photos(
    conn: &mut Connection,
    id: &str,
    photos: &[String],
) -> Result<AlbumResult, String> {
    groups::set_member_statuses(conn, id, photos, "active").map_err(album_error)?;
    show_album(conn, id)
}

#[cfg(test)]
mod tests;
