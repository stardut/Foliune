use crate::{
    db::{snapshot, Store},
    groups, local_photo,
    models::{self, Snapshot},
    photo_metadata::read_exif,
};
use exif::{In, Tag};
use image::{imageops::FilterType, GenericImageView, ImageFormat};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::{BufReader, Seek},
    path::{Path, PathBuf},
};

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

#[cfg(test)]
pub fn import(
    store: &Store,
    paths: Vec<String>,
    library: &str,
    group_id: Option<&str>,
) -> Result<ImportResult, String> {
    import_files(store, paths, library, group_id, false).map(|(result, _)| result)
}

pub(crate) fn import_local(
    store: &Store,
    paths: Vec<String>,
    library: &str,
    group_id: Option<&str>,
) -> Result<(ImportResult, HashMap<String, String>), String> {
    import_files(store, paths, library, group_id, true)
}

fn import_files(
    store: &Store,
    paths: Vec<String>,
    library: &str,
    group_id: Option<&str>,
    local: bool,
) -> Result<(ImportResult, HashMap<String, String>), String> {
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
    let mut signatures = HashMap::new();
    let root = crate::db::library_root(&conn)?;
    let mut failures = Vec::new();
    for path in paths {
        match import_one(&mut conn, &root, Path::new(&path), library, group_id, local) {
            Ok((id, signature)) => {
                if let Some(signature) = signature {
                    signatures.insert(id.clone(), signature);
                }
                imported_ids.push(id);
            }
            Err(message) => failures.push(ImportFailure { path, message }),
        }
    }
    Ok((
        ImportResult {
            snapshot: snapshot(&conn)?,
            imported_ids,
            failures,
        },
        signatures,
    ))
}

pub(crate) struct PreparedImage {
    pub original_name: String,
    extension: String,
    pub image: image::DynamicImage,
    pub captured_at: Option<String>,
    pub location: String,
}

pub(crate) const THUMBNAIL_MAX_EDGE: u32 = 960;

pub(crate) fn save_thumbnail(image: &image::DynamicImage, path: &Path) -> Result<(), String> {
    thumbnail_image(image)
        .save_with_format(path, ImageFormat::Jpeg)
        .map_err(|e| format!("生成缩略图失败：{e}"))
}

pub(crate) fn thumbnail_image(image: &image::DynamicImage) -> image::RgbImage {
    let resized = image.resize(
        image.width().min(THUMBNAIL_MAX_EDGE),
        image.height().min(THUMBNAIL_MAX_EDGE),
        FilterType::Triangle,
    );
    rgb_on_white(resized)
}

pub(crate) fn rgb_on_white(image: image::DynamicImage) -> image::RgbImage {
    if let image::DynamicImage::ImageRgb8(rgb) = image {
        return rgb;
    }
    let rgba = image.into_rgba8();
    image::RgbImage::from_fn(rgba.width(), rgba.height(), |x, y| {
        let pixel = rgba.get_pixel(x, y);
        let alpha = pixel[3] as u16;
        image::Rgb(
            [0, 1, 2].map(|index| {
                ((pixel[index] as u16 * alpha + 255 * (255 - alpha) + 127) / 255) as u8
            }),
        )
    })
}

pub(crate) fn supported_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            ["jpg", "jpeg", "png", "webp"]
                .iter()
                .any(|supported| extension.eq_ignore_ascii_case(supported))
        })
}

fn prepare_image(source: &Path) -> Result<PreparedImage, String> {
    if !source.is_file() {
        return Err("照片文件不存在或不是普通文件".into());
    }
    let file = fs::File::open(source).map_err(|e| e.to_string())?;
    prepare_open_image(source, file)
}

pub(crate) fn prepare_open_image(source: &Path, file: fs::File) -> Result<PreparedImage, String> {
    let original_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("文件名称无效")?
        .to_string();
    let input = inspect_open_image(source, file)?;
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    let (captured_at, location) = input.metadata();
    let image = input.decode()?;
    Ok(PreparedImage {
        original_name,
        extension,
        image,
        captured_at,
        location,
    })
}

pub(crate) struct OpenImage {
    pub reader: image::ImageReader<BufReader<fs::File>>,
    exif: Option<exif::Exif>,
}

pub(crate) fn inspect_open_image(source: &Path, file: fs::File) -> Result<OpenImage, String> {
    if !supported_extension(source) {
        return Err("目前仅支持 JPEG、PNG、WebP，不支持 RAW 或 HEIC".into());
    }
    let mut buffer = BufReader::new(file);
    let exif = read_exif(&mut buffer).ok();
    buffer.rewind().map_err(|e| e.to_string())?;
    let reader = image::ImageReader::new(buffer)
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP)
    ) {
        return Err("文件内容不是受支持的照片格式".into());
    }
    Ok(OpenImage { reader, exif })
}

impl OpenImage {
    pub fn orientation(&self) -> u32 {
        self.exif
            .as_ref()
            .and_then(|data| data.get_field(Tag::Orientation, In::PRIMARY))
            .and_then(|field| field.value.get_uint(0))
            .unwrap_or(1)
    }

    pub fn decode(self) -> Result<image::DynamicImage, String> {
        let orientation = self.orientation();
        let image = self
            .reader
            .decode()
            .map_err(|e| format!("照片解码失败：{e}"))?;
        Ok(apply_orientation(image, orientation))
    }

    pub fn metadata(&self) -> (Option<String>, String) {
        let captured_at = self
            .exif
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
        let location = self.exif.as_ref().and_then(gps_location).unwrap_or_default();
        (captured_at, location)
    }
}

pub(crate) fn apply_orientation(
    image: image::DynamicImage,
    orientation: u32,
) -> image::DynamicImage {
    match orientation {
        2 => image.fliph(),
        3 => image.rotate180(),
        4 => image.flipv(),
        5 => image.rotate90().fliph(),
        6 => image.rotate90(),
        7 => image.rotate270().fliph(),
        8 => image.rotate270(),
        _ => image,
    }
}

/// 使用与导入一致的格式检查和 EXIF 旋正，调用方只读原件。
pub(crate) fn load_oriented_image(
    source: &Path,
    file: fs::File,
) -> Result<image::DynamicImage, String> {
    prepare_open_image(source, file).map(|prepared| prepared.image)
}

struct PreparedImport {
    decoded: PreparedImage,
    locator: String,
    managed_path: Option<PathBuf>,
    signature: Option<String>,
}

impl PreparedImport {
    fn prepare(source: &Path, root: &Path, file_id: &str, local: bool) -> Result<Self, String> {
        if local {
            let locator = local_photo::locator(source)?;
            let file = local_photo::open(&locator)?;
            let signature = local_photo::file_signature(&file)?;
            let decoded = prepare_open_image(source, file)?;
            if local_photo::signature(&locator)? != signature {
                return Err("本地照片在读取期间发生变化，请重新选择".into());
            }
            return Ok(Self {
                decoded,
                locator,
                managed_path: None,
                signature: Some(signature),
            });
        }
        let decoded = prepare_image(source)?;
        let path = root
            .join("originals")
            .join(format!("{file_id}.{}", decoded.extension));
        Ok(Self {
            decoded,
            locator: path.to_string_lossy().into_owned(),
            managed_path: Some(path),
            signature: None,
        })
    }

    fn save(
        &self,
        source: &Path,
        thumbnail: &Path,
        save_record: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let result = (|| {
            if let Some(path) = &self.managed_path {
                fs::copy(source, path).map_err(|e| format!("复制原件失败：{e}"))?;
            }
            save_thumbnail(&self.decoded.image, thumbnail)?;
            save_record()
        })();
        if let Err(message) = &result {
            for path in self.managed_path.as_deref().into_iter().chain([thumbnail]) {
                if path.exists() {
                    fs::remove_file(path).map_err(|e| format!("{message}；清理失败：{e}"))?;
                }
            }
        }
        result
    }
}

fn import_one(
    conn: &mut Connection,
    root: &Path,
    source: &Path,
    library: &str,
    group_id: Option<&str>,
    local: bool,
) -> Result<(String, Option<String>), String> {
    let id = uuid::Uuid::new_v4().to_string();
    let prepared = PreparedImport::prepare(source, root, &id, local)?;
    let thumbnail_path = root.join("thumbnails").join(format!("{id}.jpg"));
    prepared.save(source, &thumbnail_path, || {
        let PreparedImage {
            original_name,
            image,
            captured_at,
            location,
            ..
        } = &prepared.decoded;
        let (width, height) = image.dimensions();
        let title = source
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(&original_name);
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO photos(id,library,title,original_name,original_path,thumbnail_path,width,height,captured_at,location,imported_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![id,library,title,original_name,prepared.locator,thumbnail_path.to_string_lossy(),width,height,captured_at,location,chrono::Utc::now().to_rfc3339()]).map_err(|e| e.to_string())?;
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
        Ok(())
    })?;
    Ok((id, prepared.signature))
}

pub fn relink(store: &Store, photo_id: &str, source: &Path) -> Result<Snapshot, String> {
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    use rusqlite::OptionalExtension;
    let locator: String = conn
        .query_row(
            "SELECT original_path FROM photos WHERE id=?1",
            [photo_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or("照片不存在")?;
    if crate::work_directory::is_locator(&locator) {
        return Err("此照片引用作品目录，请在图库设置中重新定位作品目录".into());
    }
    if local_photo::is_locator(&locator) {
        return Err("本地照片使用导入时的文件路径，请将原件放回原处".into());
    }
    let root = crate::db::library_root(&conn)?;
    let revision = uuid::Uuid::new_v4().to_string();
    let file_id = format!("{photo_id}-{revision}");
    let prepared = PreparedImport::prepare(source, &root, &file_id, false)?;
    let thumbnail_path = root.join("thumbnails").join(format!("{file_id}.jpg"));
    prepared.save(source, &thumbnail_path, || {
        let (width, height) = prepared.decoded.image.dimensions();
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("UPDATE photos SET original_name=?1,original_path=?2,thumbnail_path=?3,width=?4,height=?5 WHERE id=?6", params![prepared.decoded.original_name,prepared.locator,thumbnail_path.to_string_lossy(),width,height,photo_id]).map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM photo_analyses WHERE photo_id=?1", [photo_id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })?;
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
