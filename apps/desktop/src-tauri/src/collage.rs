use crate::{
    db::{self, Store},
    models::{self, Photo},
    photos,
    png_export::write_png,
};
use image::{
    codecs::png::PngEncoder, imageops::FilterType, DynamicImage, ExtendedColorType,
    GenericImageView, ImageEncoder, Rgb, RgbImage, Rgba,
};
use rusqlite::params;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_EDGE: u32 = 32_768;
const MAX_PIXELS: u64 = 160_000_000;
const MAX_ITEMS: usize = 100;
const MAX_SOURCE_PIXELS: u64 = MAX_PIXELS;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollageInput {
    pub library: String,
    pub title: String,
    pub width: u32,
    pub height: u32,
    pub background: String,
    pub items: Vec<CollageItem>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CollageItem {
    pub photo_id: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub fit: Fit,
    pub offset_x: f64,
    pub offset_y: f64,
    pub zoom: f64,
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Fit {
    Contain,
    Cover,
}

fn validate(input: &CollageInput) -> Result<Rgba<u8>, String> {
    models::library(&input.library)?;
    if input.title.trim().is_empty() || input.title.trim().chars().count() > 120 {
        return Err("拼图名称应为 1–120 个字符".into());
    }
    if input.width == 0
        || input.height == 0
        || input.width > MAX_EDGE
        || input.height > MAX_EDGE
        || u64::from(input.width) * u64::from(input.height) > MAX_PIXELS
    {
        return Err("拼图尺寸须为正整数，单边不超过 32768 像素，总像素不超过 1.6 亿；请调整布局、选片或输出尺寸".into());
    }
    if input.items.is_empty() || input.items.len() > MAX_ITEMS {
        return Err("每幅拼图须包含 1–100 张照片".into());
    }
    for item in &input.items {
        if item.width == 0
            || item.height == 0
            || item
                .x
                .checked_add(item.width)
                .is_none_or(|right| right > input.width)
            || item
                .y
                .checked_add(item.height)
                .is_none_or(|bottom| bottom > input.height)
        {
            return Err("照片矩形须为画布范围内的正整数像素尺寸".into());
        }
        if !item.offset_x.is_finite()
            || !item.offset_y.is_finite()
            || !(0.0..=1.0).contains(&item.offset_x)
            || !(0.0..=1.0).contains(&item.offset_y)
            || !item.zoom.is_finite()
            || !(1.0..=8.0).contains(&item.zoom)
        {
            return Err("照片偏移须在 0–1 之间，缩放须在 1–8 倍之间".into());
        }
        if item.fit == Fit::Contain && item.zoom != 1.0 {
            return Err("完整显示照片时缩放须为 1 倍".into());
        }
    }
    let color = input.background.as_bytes();
    if color.len() != 7 || color[0] != b'#' || !color[1..].iter().all(u8::is_ascii_hexdigit) {
        return Err("背景颜色须使用 #RRGGBB 格式".into());
    }
    let channel = |start| {
        u8::from_str_radix(&input.background[start..start + 2], 16)
            .map_err(|_| "背景颜色无效".to_string())
    };
    Ok(Rgba([channel(1)?, channel(3)?, channel(5)?, 255]))
}

fn fitted_image(image: DynamicImage, item: &CollageItem) -> DynamicImage {
    if item.fit == Fit::Contain {
        if image.width() == item.width && image.height() == item.height {
            return image;
        }
        return image.resize(item.width, item.height, FilterType::Lanczos3);
    }
    let scale = (f64::from(item.width) / f64::from(image.width()))
        .max(f64::from(item.height) / f64::from(image.height()))
        * item.zoom;
    // 先在来源空间裁切，再缩放到单元格，避免高倍缩放分配巨型中间位图。
    let width = (f64::from(item.width) / scale).round().max(1.0) as u32;
    let height = (f64::from(item.height) / scale).round().max(1.0) as u32;
    let x = (f64::from(image.width() - width) * item.offset_x).round() as u32;
    let y = (f64::from(image.height() - height) * item.offset_y).round() as u32;
    let cropped = if x == 0 && y == 0 && width == image.width() && height == image.height() {
        image
    } else {
        image.crop_imm(x, y, width, height)
    };
    if width == item.width && height == item.height {
        cropped
    } else {
        cropped.resize_exact(item.width, item.height, FilterType::Lanczos3)
    }
}

fn render(
    input: &CollageInput,
    sources: &[Photo],
    originals: &[crate::work_directory::Original],
    background: Rgba<u8>,
) -> Result<RgbImage, String> {
    // The opaque RGB canvas uses 3 bytes/pixel (480 MB at the 160 MP limit).
    // Keep sources sequential and encode this buffer directly, avoiding an
    // additional full-size RGBA canvas and an RGB conversion at save time.
    let bytes = input.width as usize * input.height as usize * 3;
    let mut pixels = Vec::new();
    pixels.try_reserve_exact(bytes).map_err(|_| {
        "内存不足，无法以当前分辨率生成拼图；请调整布局、选片或输出尺寸".to_string()
    })?;
    pixels.resize(bytes, 0);
    for pixel in pixels.chunks_exact_mut(3) {
        pixel.copy_from_slice(&background.0[..3]);
    }
    let mut canvas =
        RgbImage::from_raw(input.width, input.height, pixels).ok_or("无法创建拼图画布")?;
    for ((item, source), original) in input.items.iter().zip(sources).zip(originals) {
        use std::io::{BufReader, Seek};
        let mut file = original.open()?;
        let dimensions = image::ImageReader::new(BufReader::new(&mut file))
            .with_guessed_format()
            .map_err(|e| format!("识别来源照片失败：{e}"))?
            .into_dimensions()
            .map_err(|e| format!("读取来源照片尺寸失败：{e}"))?;
        if u64::from(dimensions.0) * u64::from(dimensions.1) > MAX_SOURCE_PIXELS {
            return Err("来源照片超过 1.6 亿像素，请先使用尺寸较小的照片".into());
        }
        file.rewind().map_err(|e| e.to_string())?;
        let image = photos::load_oriented_image(Path::new(&source.original_name), file)?;
        let fitted = fitted_image(image, item);
        let x = item.x + (item.width - fitted.width()) / 2;
        let y = item.y + (item.height - fitted.height()) / 2;
        // Composite without allocating another full-size converted source.
        for (source_x, source_y, pixel) in fitted.pixels() {
            let target = canvas.get_pixel_mut(x + source_x, y + source_y);
            let alpha = u16::from(pixel[3]);
            *target = Rgb([0, 1, 2].map(|channel| {
                ((u16::from(pixel[channel]) * alpha
                    + u16::from(target[channel]) * (255 - alpha)
                    + 127)
                    / 255) as u8
            }));
        }
    }
    Ok(canvas)
}

pub fn export_png(store: &Store, directory: &Path, input: CollageInput) -> Result<PathBuf, String> {
    let background = validate(&input)?;
    let (root, sources, originals) = {
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        let root = db::library_root(&conn)?;
        let state = db::snapshot(&conn)?;
        let sources = input
            .items
            .iter()
            .map(|item| {
                let photo = state
                    .photos
                    .iter()
                    .find(|photo| photo.id == item.photo_id && photo.library == input.library)
                    .cloned()
                    .ok_or("来源照片不存在或不属于当前图库类别")?;
                let original =
                    crate::work_directory::original(&conn, &photo.id, &photo.original_path)?;
                Ok((photo, original))
            })
            .collect::<Result<Vec<_>, String>>()?;
        let (sources, originals): (Vec<_>, Vec<_>) = sources.into_iter().unzip();
        (root, sources, originals)
    };
    let canvas = render(&input, &sources, &originals, background)?;
    {
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        if db::library_root(&conn)? != root {
            return Err("图库已切换，请重新开始拼图。".into());
        }
        for source in &sources {
            let path: String = conn
                .query_row(
                    "SELECT original_path FROM photos WHERE id=?1 AND library=?2",
                    params![source.id, source.library],
                    |row| row.get(0),
                )
                .map_err(|_| "来源照片已变化，请重新生成拼图。")?;
            if path != source.original_path {
                return Err("来源照片已重新定位，请重新生成拼图。".into());
            }
        }
    }
    // 背景不透明，输出 RGB PNG，避免引入 JPEG 代际损失和多余 alpha。
    write_png(directory, &input.title, "拼图", |writer| {
        PngEncoder::new(writer)
            .write_image(&canvas, input.width, input.height, ExtendedColorType::Rgb8)
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub async fn export_collage_png(
    app: tauri::AppHandle,
    directory: String,
    input: CollageInput,
) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || {
        export_png(&app.state::<Store>(), Path::new(&directory), input)
    })
    .await
    .map_err(|e| e.to_string())?
}
