use super::{
    input::{media_allowed, Platform},
    Session,
};
use std::{io::Cursor, sync::Arc, time::Duration};
use tauri::Url;
const MAX_BYTES: usize = 40 * 1024 * 1024;
const MAX_TOTAL: usize = 512 * 1024 * 1024;

fn save(bytes: Vec<u8>, session: &Session, index: usize) -> Result<String, String> {
    let format = image::guess_format(&bytes).map_err(|_| "下载内容不是有效图片")?;
    let extension = match format {
        image::ImageFormat::Jpeg => "jpg",
        image::ImageFormat::Png => "png",
        image::ImageFormat::WebP => "webp",
        _ => return Err("帖子图片格式不受支持（仅 JPEG、PNG、WebP）。".into()),
    };
    let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(20_000);
    limits.max_image_height = Some(20_000);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| "图片解码失败或超过尺寸/内存限制。")?;
    drop(decoded);
    // Cancellation and the final write are serialized; cancelled decoders cannot
    // recreate a temporary file after cancel_link_import has cleaned the directory.
    let progress = session.progress.lock().map_err(|e| e.to_string())?;
    if progress.cancelled {
        return Err("链接导入已取消。".into());
    }
    let path = session
        .directory
        .join(format!("{:03}.{extension}", index + 1));
    std::fs::write(&path, bytes).map_err(|e| format!("暂存下载图片失败：{e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

pub(super) async fn download(
    images: Vec<String>,
    platform: Platform,
    session: &Arc<Session>,
) -> Result<Vec<String>, String> {
    if images.is_empty() || images.len() > 100 {
        return Err("帖子图片数量无效或超过 100 张限制。".into());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|_| "无法初始化图片下载")?;
    let mut paths = Vec::new();
    let mut total = 0;
    for (index, image) in images.into_iter().enumerate() {
        session.check()?;
        let url = Url::parse(&image).map_err(|_| "帖子图片地址无效")?;
        if !media_allowed(&url, platform) {
            return Err("帖子图片地址不在该平台受限 CDN 范围内。".into());
        }
        let referer = match platform {
            Platform::Xhs => "https://www.xiaohongshu.com/",
            Platform::Instagram => "https://www.instagram.com/",
        };
        let mut response = client
            .get(url)
            .header("Referer", referer)
            .send()
            .await
            .map_err(|_| "图片下载失败或超时。")?;
        if !response.status().is_success() {
            return Err(format!(
                "图片下载返回 HTTP {}，未导入任何图片。",
                response.status().as_u16()
            ));
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_BYTES as u64)
        {
            return Err("单张图片超过 40 MiB 限制。".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| "图片下载中断或超时。")?
        {
            session.check()?;
            if bytes.len() + chunk.len() > MAX_BYTES || total + chunk.len() > MAX_TOTAL {
                return Err("图片下载超过会话大小限制。".into());
            }
            total += chunk.len();
            bytes.extend_from_slice(&chunk);
        }
        session.check()?;
        let worker_session = session.clone();
        paths.push(
            tauri::async_runtime::spawn_blocking(move || save(bytes, &worker_session, index))
                .await
                .map_err(|_| "图片验证任务失败")??,
        );
    }
    session.check()?;
    Ok(paths)
}
