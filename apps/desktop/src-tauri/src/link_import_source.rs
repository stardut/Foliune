use super::Session;
use crate::locale::{display_format, tr};
use crate::{models::Photo, photos};
use image::{
    codecs::jpeg::JpegEncoder, ExtendedColorType, GenericImageView, ImageEncoder, ImageFormat,
};
use std::fs;

pub(super) fn prepare_photo(
    session: &Session,
    bytes: Vec<u8>,
    index: usize,
    library: &str,
    source: &str,
) -> Result<Photo, String> {
    let extension = match image::guess_format(&bytes).map_err(|_| {
        tr(
            "下载内容不是有效图片",
            "The downloaded file is not a valid image",
        )
    })? {
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Png => "png",
        ImageFormat::WebP => "webp",
        _ => {
            return Err(tr(
                "帖子图片格式不受支持（仅 JPEG、PNG、WebP）。",
                "The post contains an unsupported image format. Use JPEG, PNG, or WebP.",
            )
            .into())
        }
    };
    let title = format!("{:03}", index + 1);
    let original_name = format!("{title}.{extension}");
    let download = session.directory.join(&original_name);
    {
        let _progress = session.active()?;
        fs::write(&download, bytes).map_err(|e| {
            display_format!(
                "暂存下载图片失败：{e}",
                "Could not store the downloaded photo temporarily: {e}"
            )
        })?;
    }

    let file = fs::File::open(&download).map_err(|e| {
        display_format!(
            "读取暂存图片失败：{e}",
            "Could not read the temporary photo: {e}"
        )
    })?;
    let mut input = photos::inspect_open_image(&download, file)?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(20_000);
    limits.max_image_height = Some(20_000);
    limits.max_alloc = Some(256 * 1024 * 1024);
    input.reader.limits(limits);
    let (captured_at, location) = input.metadata();
    let image = input.decode().map_err(|_| {
        tr(
            "图片解码失败或超过尺寸/内存限制。",
            "Could not decode the photo, or it exceeds the size or memory limit.",
        )
    })?;
    let (width, height) = image.dimensions();
    let mut thumbnail_bytes = Vec::new();
    let resized = photos::thumbnail_image(&image);
    JpegEncoder::new(&mut thumbnail_bytes)
        .write_image(
            resized.as_raw(),
            resized.width(),
            resized.height(),
            ExtendedColorType::Rgb8,
        )
        .map_err(|e| {
            display_format!("生成缩略图失败：{e}", "Could not create the thumbnail: {e}")
        })?;

    let id = uuid::Uuid::new_v4().to_string();
    let original = session
        .directory
        .join("originals")
        .join(format!("{id}.{extension}"));
    let thumbnail = session
        .directory
        .join("thumbnails")
        .join(format!("{id}.jpg"));
    // Serialize file writes with cancellation, so a cancelled worker cannot recreate files.
    let _progress = session.active()?;
    fs::write(&thumbnail, thumbnail_bytes)
        .map_err(|e| display_format!("保存缩略图失败：{e}", "Could not save the thumbnail: {e}"))?;
    fs::rename(&download, &original).map_err(|e| {
        display_format!(
            "保存暂存原件失败：{e}",
            "Could not save the temporary original: {e}"
        )
    })?;
    Ok(Photo {
        id,
        library: library.into(),
        title,
        original_name,
        original_path: original.to_string_lossy().into_owned(),
        thumbnail_path: thumbnail.to_string_lossy().into_owned(),
        original_available: true,
        thumbnail_available: true,
        availability: None,
        width,
        height,
        tags: Vec::new(),
        regions: Vec::new(),
        annotation: String::new(),
        source: source.into(),
        captured_at,
        location,
        location_region_id: String::new(),
        project: String::new(),
        imported_at: chrono::Utc::now().to_rfc3339(),
    })
}
