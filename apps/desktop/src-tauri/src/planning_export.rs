use crate::png_export::write_png;
use std::{
    io::{Cursor, Write},
    path::{Path, PathBuf},
};

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_EDGE: u32 = 32_768;
const MAX_PIXELS: u64 = 40_000_000;

pub fn export_png(directory: &Path, title: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("策划长图不能为空，且不能超过 64 MiB".into());
    }
    if image::guess_format(bytes).map_err(|_| "策划长图须为有效 PNG 图片")?
        != image::ImageFormat::Png
    {
        return Err("策划长图须为有效 PNG 图片".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_EDGE);
    limits.max_image_height = Some(MAX_EDGE);
    limits.max_alloc = Some(MAX_PIXELS * 8);
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
    reader.limits(limits.clone());
    let (width, height) = reader.into_dimensions().map_err(|_| "策划长图尺寸无效")?;
    if width == 0
        || height == 0
        || width > MAX_EDGE
        || height > MAX_EDGE
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err("策划长图单边最多 32768 像素，总像素最多 4000 万".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
    reader.limits(limits);
    reader
        .decode()
        .map_err(|_| "策划长图 PNG 数据损坏或无法解码")?;
    write_png(directory, title, "拍摄策划", |writer| {
        writer.write_all(bytes).map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub async fn plans_export_png(
    directory: String,
    title: String,
    bytes: Vec<u8>,
) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || export_png(Path::new(&directory), &title, &bytes))
        .await
        .map_err(|e| e.to_string())?
}
