use crate::{
    db::{snapshot, Store},
    groups,
    models::{self, Snapshot},
};
use exif::{In, Tag};
use image::{imageops::FilterType, GenericImageView, ImageFormat};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::{fs, io::BufReader, path::Path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub snapshot: Snapshot,
    pub imported_ids: Vec<String>,
    pub failures: Vec<ImportFailure>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportFailure {
    pub path: String,
    pub message: String,
}

pub fn import(
    store: &Store,
    paths: Vec<String>,
    library: &str,
    group_id: Option<&str>,
) -> Result<ImportResult, String> {
    models::library(library)?;
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    if let Some(id) = group_id {
        if groups::group_library(&conn, id)? != library {
            return Err("目标分组不属于该图库".into());
        }
        // 满额操作必须在任何文件与数据库变化发生之前拒绝。
        groups::ensure_capacity(&conn, id, paths.len())?;
    }
    let mut imported_ids = Vec::new();
    let root = crate::db::library_root(&conn)?;
    let mut failures = Vec::new();
    for path in paths {
        match import_one(&mut conn, &root, Path::new(&path), library, group_id) {
            Ok(id) => imported_ids.push(id),
            Err(message) => failures.push(ImportFailure { path, message }),
        }
    }
    Ok(ImportResult {
        snapshot: snapshot(&conn)?,
        imported_ids,
        failures,
    })
}

fn metadata(path: &Path) -> Option<exif::Exif> {
    let file = fs::File::open(path).ok()?;
    exif::Reader::new()
        .read_from_container(&mut BufReader::new(file))
        .ok()
}

struct PreparedImage {
    original_name: String,
    extension: String,
    image: image::DynamicImage,
    captured_at: Option<String>,
    location: String,
}

fn save_thumbnail(image: &image::DynamicImage, path: &Path) -> Result<(), String> {
    let rgba = image
        .resize(
            image.width().min(960),
            image.height().min(960),
            FilterType::Triangle,
        )
        .to_rgba8();
    let rgb =
        image::RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
            let pixel = rgba.get_pixel(x, y);
            let alpha = pixel[3] as u16;
            image::Rgb([0, 1, 2].map(|index| {
                ((pixel[index] as u16 * alpha + 255 * (255 - alpha) + 127) / 255) as u8
            }))
        });
    rgb.save_with_format(path, ImageFormat::Jpeg)
        .map_err(|e| format!("生成缩略图失败：{e}"))
}

fn prepare_image(source: &Path) -> Result<PreparedImage, String> {
    let original_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("文件名称无效")?
        .to_string();
    if !source.is_file() {
        return Err("照片文件不存在或不是普通文件".into());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["jpg", "jpeg", "png", "webp"].contains(&extension.as_str()) {
        return Err("目前仅支持 JPEG、PNG、WebP，不支持 RAW 或 HEIC".into());
    }
    let reader = image::ImageReader::open(source)
        .map_err(|e| e.to_string())?
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP)
    ) {
        return Err("文件内容不是受支持的照片格式".into());
    }
    let mut image = reader.decode().map_err(|e| format!("照片解码失败：{e}"))?;
    let exif = metadata(source);
    if let Some(field) = exif
        .as_ref()
        .and_then(|data| data.get_field(Tag::Orientation, In::PRIMARY))
    {
        if let Some(orientation) = field.value.get_uint(0) {
            image = match orientation {
                2 => image.fliph(),
                3 => image.rotate180(),
                4 => image.flipv(),
                5 => image.rotate90().fliph(),
                6 => image.rotate90(),
                7 => image.rotate270().fliph(),
                8 => image.rotate270(),
                _ => image,
            };
        }
    }
    let captured_at = exif
        .as_ref()
        .and_then(|data| data.get_field(Tag::DateTimeOriginal, In::PRIMARY))
        .and_then(|field| {
            if let exif::Value::Ascii(values) = &field.value {
                values
                    .first()
                    .and_then(|value| std::str::from_utf8(value).ok())
                    .and_then(|value| {
                        chrono::NaiveDateTime::parse_from_str(
                            value.trim_matches(char::from(0)),
                            "%Y:%m:%d %H:%M:%S",
                        )
                        .ok()
                    })
                    .map(|date| date.format("%Y-%m-%dT%H:%M:%S").to_string())
            } else {
                None
            }
        });
    let location = exif.as_ref().and_then(gps_location).unwrap_or_default();
    Ok(PreparedImage {
        original_name,
        extension,
        image,
        captured_at,
        location,
    })
}

/// 使用与导入一致的格式检查和 EXIF 旋正，调用方只读原件。
pub(crate) fn load_oriented_image(source: &Path) -> Result<image::DynamicImage, String> {
    prepare_image(source).map(|prepared| prepared.image)
}

fn import_one(
    conn: &mut Connection,
    root: &Path,
    source: &Path,
    library: &str,
    group_id: Option<&str>,
) -> Result<String, String> {
    let PreparedImage {
        original_name,
        extension,
        image,
        captured_at,
        location,
    } = prepare_image(source)?;
    let id = uuid::Uuid::new_v4().to_string();
    let original_path = root.join("originals").join(format!("{id}.{extension}"));
    let thumbnail_path = root.join("thumbnails").join(format!("{id}.jpg"));
    let result = (|| {
        fs::copy(source, &original_path).map_err(|e| format!("复制原件失败：{e}"))?;
        save_thumbnail(&image, &thumbnail_path)?;
        let (width, height) = image.dimensions();
        let title = source
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(&original_name);
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO photos(id,library,title,original_name,original_path,thumbnail_path,width,height,captured_at,location,imported_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![id,library,title,original_name,original_path.to_string_lossy(),thumbnail_path.to_string_lossy(),width,height,captured_at,location,chrono::Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
        if let Some(group_id) = group_id {
            groups::ensure_capacity(&tx, group_id, 1)?;
            let position: i64 = tx
                .query_row(
                    "SELECT COALESCE(MAX(position),-1)+1 FROM memberships WHERE group_id=?1",
                    [group_id],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            tx.execute("INSERT INTO memberships(group_id,photo_id,status,position) VALUES(?1,?2,'active',?3)", params![group_id,id,position]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(id.clone())
    })();
    if result.is_err() {
        // 本次导入失败时只清理本次生成的管理副本，绝不触碰来源文件。
        for path in [&original_path, &thumbnail_path] {
            if path.exists() {
                if let Err(error) = fs::remove_file(path) {
                    return Err(format!("{}；清理失败：{error}", result.unwrap_err()));
                }
            }
        }
    }
    result
}

pub fn relink(store: &Store, photo_id: &str, source: &Path) -> Result<Snapshot, String> {
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM photos WHERE id=?1)",
            [photo_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("照片不存在".into());
    }
    let prepared = prepare_image(source)?;
    let root = crate::db::library_root(&conn)?;
    let revision = uuid::Uuid::new_v4().to_string();
    let original_path = root
        .join("originals")
        .join(format!("{photo_id}-{revision}.{}", prepared.extension));
    let thumbnail_path = root
        .join("thumbnails")
        .join(format!("{photo_id}-{revision}.jpg"));
    let result: Result<(), String> = (|| {
        fs::copy(source, &original_path).map_err(|e| format!("复制原件失败：{e}"))?;
        save_thumbnail(&prepared.image, &thumbnail_path)?;
        let (width, height) = prepared.image.dimensions();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("UPDATE photos SET original_name=?1,original_path=?2,thumbnail_path=?3,width=?4,height=?5 WHERE id=?6", params![prepared.original_name,original_path.to_string_lossy(),thumbnail_path.to_string_lossy(),width,height,photo_id]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM photo_analyses WHERE photo_id=?1", [photo_id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(message) = result {
        for path in [&original_path, &thumbnail_path] {
            if path.exists() {
                fs::remove_file(path).map_err(|e| format!("{message}；清理失败：{e}"))?;
            }
        }
        return Err(message);
    }
    // 保留此前管理副本，避免重新定位时触发尚未定义的原件删除策略。
    snapshot(&conn)
}

fn gps_location(data: &exif::Exif) -> Option<String> {
    fn coordinate(data: &exif::Exif, tag: Tag, reference: Tag) -> Option<f64> {
        let field = data.get_field(tag, In::PRIMARY)?;
        let values = match &field.value {
            exif::Value::Rational(values) if values.len() == 3 => values,
            _ => return None,
        };
        let degrees = values[0].to_f64() + values[1].to_f64() / 60.0 + values[2].to_f64() / 3600.0;
        let reference = data
            .get_field(reference, In::PRIMARY)?
            .display_value()
            .to_string();
        Some(if reference.contains('S') || reference.contains('W') {
            -degrees
        } else {
            degrees
        })
    }
    Some(format!(
        "{:.6}, {:.6}",
        coordinate(data, Tag::GPSLatitude, Tag::GPSLatitudeRef)?,
        coordinate(data, Tag::GPSLongitude, Tag::GPSLongitudeRef)?
    ))
}

pub fn update(conn: &mut Connection, id: &str, patch: Value) -> Result<Snapshot, String> {
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM photos WHERE id=?1)",
            [id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !exists {
        return Err("照片不存在".into());
    }
    let object = patch.as_object().ok_or("无效照片修改")?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (key, value) in object {
        let column = match key.as_str() {
            "title" => "title",
            "annotation" => "annotation",
            "source" => "source",
            "capturedAt" => "captured_at",
            "location" => "location",
            "project" => "project",
            "tags" => "tags",
            "regions" => "regions",
            _ => return Err(format!("不支持修改照片字段：{key}")),
        };
        let stored: Option<String> = if key == "regions" {
            let regions: Vec<crate::models::PhotoRegion> = serde_json::from_value(value.clone())
                .map_err(|e| format!("区域标注格式无效：{e}"))?;
            let mut ids = std::collections::HashSet::new();
            for region in &regions {
                if region.id.trim().is_empty()
                    || !ids.insert(&region.id)
                    || region.text.trim().is_empty()
                    || ![region.x, region.y, region.width, region.height]
                        .iter()
                        .all(|value| value.is_finite())
                    || region.x < 0.0
                    || region.y < 0.0
                    || region.width <= 0.0
                    || region.height <= 0.0
                    || region.x + region.width > 1.0
                    || region.y + region.height > 1.0
                {
                    return Err("区域标注应包含唯一 ID、说明和照片范围内的相对坐标".into());
                }
            }
            Some(serde_json::to_string(&regions).map_err(|e| e.to_string())?)
        } else if key == "tags" {
            let tags = value.as_array().ok_or("标签必须是文本数组")?;
            let mut normalized = Vec::new();
            for tag in tags {
                let tag = tag.as_str().ok_or("标签必须是文本")?.trim();
                if !tag.is_empty() && !normalized.contains(&tag) {
                    normalized.push(tag);
                }
            }
            Some(serde_json::to_string(&normalized).map_err(|e| e.to_string())?)
        } else if key == "capturedAt" && value.is_null() {
            None
        } else {
            let text = value.as_str().ok_or("照片字段必须是文本")?.trim();
            if key == "title" {
                models::name(text)?;
            }
            if key == "capturedAt"
                && !text.is_empty()
                && chrono::DateTime::parse_from_rfc3339(text).is_err()
                && chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S").is_err()
                && chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").is_err()
            {
                return Err("拍摄时间请使用有效的日期或 ISO 时间".into());
            }
            if key == "capturedAt" && text.is_empty() {
                None
            } else {
                Some(text.to_string())
            }
        };
        tx.execute(
            &format!("UPDATE photos SET {column}=?1 WHERE id=?2"),
            params![stored, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    snapshot(conn)
}
