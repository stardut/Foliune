use std::borrow::Cow;

// Sync jobs retain their error text in SQLite. Translate known application messages
// on read so a language switch also applies to failures saved on earlier launches.
pub(super) fn english(error: &str) -> Cow<'_, str> {
    let exact = match error {
        "作品目录已变化，请确认连接后重试" => "The work folder changed. Check the connection and try again.",
        "作品目录已变化，请重新查看待同步内容" => "The work folder changed. Review the items to sync again.",
        "作品目录当前不可用" => "The work folder is currently unavailable",
        "作品目录来源已变化，请重新定位后查看待同步内容" => "The work folder source changed. Relocate it and review the items to sync.",
        "同步任务已变化" => "The sync job changed",
        "图库位置配置无效" => "The library location configuration is invalid",
        "图库或作品目录已切换" => "The library or work folder changed",
        "图库或作品目录已变化" => "The library or work folder changed",
        "图库路径不可用" => "The library path is unavailable",
        "当前图库数据库不存在或路径无效" => "The current library database is missing or has an invalid path",
        "当前图库数据库路径无效" => "The current library database path is invalid",
        "待同步内容已变化，请重新查看后确认" => "The items to sync changed. Review the updated list before confirming.",
        "待同步内容重复或无效" => "Duplicate or invalid items to sync",
        "文件内容不是受支持的照片格式" => "The file does not contain a supported photo format",
        "文件名称无效" => "Invalid filename",
        "照片解码失败：Image I/O 无法完整解码 JPEG" => "Could not decode the photo: Image I/O could not decode the full JPEG",
        "照片解码失败：JPEG 缺少主图尺寸" => "Could not decode the photo: JPEG is missing its image dimensions",
        "照片解码失败：JPEG 超出内存限制" => "Could not decode the photo: JPEG exceeds the memory limit",
        "照片解码失败：渐进 JPEG 缺少首个扫描结束标记" => "Could not decode the photo: Progressive JPEG is missing the end of its first scan",
        "生成缩略图失败：Image I/O 无法生成 JPEG" => "Could not create the thumbnail: Image I/O could not generate a JPEG",
        "生成缩略图失败：Image I/O 未返回 JPEG" => "Could not create the thumbnail: Image I/O returned no JPEG",
        "目录路径或文件类型无效" => "Invalid folder path or file type",
        "相簿不属于作品图库" => "The album does not belong to Work",
        "分组不存在" => "Album not found",
        "分组容量不足，请先调整容量或废弃组内照片；此次操作尚未保存。" => "The album is full. Increase its capacity or move album photos to Rejects. Your changes were not saved.",
        _ => return formatted_english(error),
    };
    Cow::Borrowed(exact)
}

fn formatted_english(error: &str) -> Cow<'_, str> {
    if let Some((path, detail)) = error
        .strip_prefix("作品原件 ")
        .and_then(|tail| tail.rsplit_once(" 尚不能同步："))
    {
        return format!(
            "Could not sync the original work photo {path}: {}",
            english(detail)
        )
        .into();
    }

    if let Some(path) = error.strip_prefix("作品原件 ") {
        if let Some(path) = path.strip_suffix(" 仍在写入，请完成后重试") {
            return format!("The original work photo {path} is still being written. Try again when it finishes.").into();
        }
        if let Some(path) = path.strip_suffix(" 已变化，请重试") {
            return format!("The original work photo {path} changed. Try again.").into();
        }
    }

    if let Some((path, detail)) = error
        .strip_prefix("无法读取作品原件 ")
        .and_then(|tail| tail.rsplit_once('：'))
    {
        return format!(
            "Could not read the original work photo {path}: {}",
            english(detail)
        )
        .into();
    }

    for (source, translated) in [
        (
            "无法创建作品目录同步暂存：",
            "Could not create temporary storage for work folder sync: ",
        ),
        (
            "无法记录作品缩略图发布清单：",
            "Could not record the work thumbnail manifest: ",
        ),
        (
            "无法保存作品缩略图：",
            "Could not save the work thumbnail: ",
        ),
        ("照片解码失败：", "Could not decode the photo: "),
        ("生成缩略图失败：", "Could not create the thumbnail: "),
    ] {
        if let Some(detail) = error.strip_prefix(source) {
            return format!("{translated}{detail}").into();
        }
    }

    Cow::Borrowed(error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_saved_failures_and_keeps_paths_and_external_details() {
        assert_eq!(
            english("作品原件 旅途/雪景.jpg 尚不能同步：照片解码失败：JPEG 超出内存限制"),
            "Could not sync the original work photo 旅途/雪景.jpg: Could not decode the photo: JPEG exceeds the memory limit"
        );
        assert_eq!(
            english("作品目录来源已变化，请重新定位后查看待同步内容"),
            "The work folder source changed. Relocate it and review the items to sync."
        );
        assert_eq!(
            english("external error for 雪景.jpg"),
            "external error for 雪景.jpg"
        );
    }
}
