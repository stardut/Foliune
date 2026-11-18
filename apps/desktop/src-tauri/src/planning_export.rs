use crate::locale::tr;
use crate::png_export::write_png;
use std::{
    io::{Cursor, Write},
    path::{Path, PathBuf},
};
use tauri::Manager;

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_EDGE: u32 = 32_768;
const MAX_PIXELS: u64 = 40_000_000;

pub fn export_png(directory: &Path, title: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(tr(
            "策划长图不能为空，且不能超过 64 MiB",
            "The shoot plan PNG must contain data and be at most 64 MiB",
        )
        .into());
    }
    if image::guess_format(bytes).map_err(|_| {
        tr(
            "策划长图须为有效 PNG 图片",
            "Export the shoot plan as a valid PNG image",
        )
    })? != image::ImageFormat::Png
    {
        return Err(tr(
            "策划长图须为有效 PNG 图片",
            "Export the shoot plan as a valid PNG image",
        )
        .into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_EDGE);
    limits.max_image_height = Some(MAX_EDGE);
    limits.max_alloc = Some(MAX_PIXELS * 8);
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
    reader.limits(limits.clone());
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| tr("策划长图尺寸无效", "Invalid shoot plan image dimensions"))?;
    if width == 0
        || height == 0
        || width > MAX_EDGE
        || height > MAX_EDGE
        || u64::from(width) * u64::from(height) > MAX_PIXELS
    {
        return Err(tr(
            "策划长图单边最多 32768 像素，总像素最多 4000 万",
            "The shoot plan image can be up to 32,768 pixels per side and 40 megapixels total",
        )
        .into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Png);
    reader.limits(limits);
    reader.decode().map_err(|_| {
        tr(
            "策划长图 PNG 数据损坏或无法解码",
            "The shoot plan PNG is damaged or could not be decoded",
        )
    })?;
    write_png(
        directory,
        title,
        tr("拍摄策划", "Shoot Plan"),
        |writer| writer.write_all(bytes).map_err(|error| error.to_string()),
    )
}

#[tauri::command]
pub async fn plans_export_png(
    app: tauri::AppHandle,
    directory: String,
    title: String,
    bytes: Vec<u8>,
) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<crate::db::Store>();
        let _active = store.restart_gate.require_work()?;
        export_png(Path::new(&directory), &title, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}
