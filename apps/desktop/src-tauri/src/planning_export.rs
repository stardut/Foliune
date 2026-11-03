use std::{
    fs,
    io::{Cursor, Write},
    path::Path,
};

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_EDGE: u32 = 32_768;
const MAX_PIXELS: u64 = 40_000_000;

pub fn export_png(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("png"))
        != Some(true)
    {
        return Err("请选择 .png 文件路径".into());
    }
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
    let parent = path.parent().ok_or("导出目录无效")?;
    let temporary = parent.join(format!(".foliune-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, path).map_err(|e| format!("保存策划长图失败：{e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub async fn plans_export_png(path: String, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || export_png(Path::new(&path), &bytes))
        .await
        .map_err(|e| e.to_string())?
}
