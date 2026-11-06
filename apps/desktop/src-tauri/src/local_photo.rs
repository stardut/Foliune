use crate::work_directory::{open_file_at_path, stat_signature};
use std::{
    fs::File,
    io::{self, Read, Seek},
    path::Path,
};

pub(crate) const PREFIX: &str = "local-photo:";
const MISSING: &str = "照片原件缺失";

pub(crate) fn is_locator(value: &str) -> bool {
    value.starts_with(PREFIX)
}

/// Canonicalize an explicitly selected absolute file path before persisting it.
pub(crate) fn locator(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("请选择照片的绝对路径".into());
    }
    let path = path.canonicalize().map_err(read_error)?;
    if !path.is_file() {
        return Err("照片文件不存在或不是普通文件".into());
    }
    let path = path.to_str().ok_or("照片路径无法保存")?;
    Ok(format!("{PREFIX}{path}"))
}

fn read_error(error: io::Error) -> String {
    if error.kind() == io::ErrorKind::NotFound {
        MISSING.into()
    } else {
        format!("读取本地照片原件失败：{error}")
    }
}

fn path(locator: &str) -> Option<&Path> {
    locator
        .strip_prefix(PREFIX)
        .map(Path::new)
        .filter(|path| path.is_absolute())
}

pub(crate) fn is_available(locator: &str) -> bool {
    path(locator).is_some_and(|path| {
        path.symlink_metadata().is_ok_and(|info| info.is_file())
            && path.canonicalize().is_ok_and(|canonical| canonical == path)
    })
}

pub(crate) fn image_content_type(bytes: &[u8]) -> Option<&'static str> {
    match image::guess_format(bytes).ok()? {
        image::ImageFormat::Jpeg => Some("image/jpeg"),
        image::ImageFormat::Png => Some("image/png"),
        // Other media types use the same RIFF container as WebP.
        image::ImageFormat::WebP if bytes.get(8..12) == Some(b"WEBP") => Some("image/webp"),
        _ => None,
    }
}

pub(crate) fn open(locator: &str) -> Result<File, String> {
    let path = path(locator).ok_or(MISSING)?;
    let mut file = open_file_at_path(path).map_err(read_error)?;
    let mut header = [0; 12];
    file.read_exact(&mut header).map_err(read_error)?;
    if image_content_type(&header).is_none() {
        return Err("照片原件格式无法识别".into());
    }
    file.rewind().map_err(read_error)?;
    Ok(file)
}

pub(crate) fn file_signature(file: &File) -> Result<String, String> {
    stat_signature(file).ok_or_else(|| "无法确认本地照片文件状态".into())
}

pub(crate) fn signature(locator: &str) -> Result<String, String> {
    file_signature(&open(locator)?)
}
