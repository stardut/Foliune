use crate::books::{BookChapter, BookItem, BookPage, VersionInput};
use crate::locale::{display_format, tr};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

pub fn template(value: &str) -> Result<(), String> {
    match value {
        "white" | "full" | "pair" => Ok(()),
        _ => Err(tr("未知画册模板", "Unknown photo book template").into()),
    }
}

pub fn generate(
    chapters: Vec<BookChapter>,
    style: &str,
    width: u32,
    height: u32,
) -> Result<VersionInput, String> {
    template(style)?;
    let mut pages = Vec::new();
    for chapter in &chapters {
        let count = if style == "pair" { 2 } else { 1 };
        for chunk in chapter.photo_ids.chunks(count) {
            let items = chunk
                .iter()
                .enumerate()
                .map(|(index, id)| {
                    let (x, y, width, height) = match style {
                        "full" => (0.0, 0.0, 100.0, 100.0),
                        "pair" if chunk.len() == 2 => (5.0 + index as f64 * 48.0, 10.0, 42.0, 75.0),
                        _ => (10.0, 8.0, 80.0, 77.0),
                    };
                    BookItem {
                        photo_id: id.clone(),
                        x,
                        y,
                        width,
                        height,
                        crop_x: 50.0,
                        crop_y: 50.0,
                        fit: if style == "full" { "cover" } else { "contain" }.into(),
                    }
                })
                .collect();
            pages.push(BookPage {
                id: uuid::Uuid::new_v4().to_string(),
                chapter_id: chapter.id.clone(),
                title: if pages
                    .iter()
                    .all(|page: &BookPage| page.chapter_id != chapter.id)
                {
                    chapter.title.clone()
                } else {
                    String::new()
                },
                caption: String::new(),
                items,
            });
        }
    }
    Ok(VersionInput {
        _legacy_reflow_undo_id: None,
        label: automatic_label(crate::locale::current()).into(),
        template: style.into(),
        page_width: width,
        page_height: height,
        chapters,
        pages,
    })
}

const AUTOMATIC_LABEL_ZH: &str = "自动排版";
const AUTOMATIC_LABEL_EN: &str = "Automatic Layout";

pub(crate) fn automatic_label(locale: crate::locale::Locale) -> &'static str {
    locale.text(AUTOMATIC_LABEL_ZH, AUTOMATIC_LABEL_EN)
}

pub(crate) fn has_automatic_label(label: &str) -> bool {
    matches!(label, AUTOMATIC_LABEL_ZH | AUTOMATIC_LABEL_EN)
}

pub fn validate(conn: &Connection, input: &VersionInput) -> Result<(), String> {
    validate_snapshot(conn, input, true)
}

pub(crate) fn validate_snapshot(
    conn: &Connection,
    input: &VersionInput,
    require_visible_photos: bool,
) -> Result<(), String> {
    template(&input.template)?;
    if !(400..=4000).contains(&input.page_width) || !(400..=4000).contains(&input.page_height) {
        return Err(tr(
            "画册页宽高需在 400–4000 之间",
            "Page width and height must be between 400 and 4,000",
        )
        .into());
    }
    if input.label.trim().is_empty() || input.label.chars().count() > 200 {
        return Err(tr(
            "画册内部名称应为 1–200 个字符",
            "The photo book layout name must be 1–200 characters",
        )
        .into());
    }
    let mut chapters = HashSet::new();
    let mut selected = HashMap::new();
    for chapter in &input.chapters {
        if chapter.id.is_empty() || !chapters.insert(&chapter.id) {
            return Err(tr("章节标识缺失或重复", "Missing or duplicate chapter ID").into());
        }
        if chapter.title.chars().count() > 200 {
            return Err(tr(
                "章节标题不能超过 200 个字符",
                "Chapter titles can be up to 200 characters",
            )
            .into());
        }
        for id in &chapter.photo_ids {
            if selected.insert(id, &chapter.id).is_some() {
                return Err(tr(
                    "同一照片不能重复选入画册",
                    "A photo can only be added once to the photo book",
                )
                .into());
            }
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM photos
                                   WHERE id=?1 AND (NOT ?2 OR hidden_after_album_delete=0))",
                    rusqlite::params![id, require_visible_photos],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if !exists {
                return Err(display_format!(
                    "选片不存在：{id}",
                    "Selected photo not found: {id}"
                ));
            }
        }
    }
    if selected.is_empty() {
        return Err(tr("请至少选择一张照片", "Select at least one photo").into());
    }
    let mut page_ids = HashSet::new();
    let mut used = HashSet::new();
    for page in &input.pages {
        if page.id.is_empty() || !page_ids.insert(&page.id) || !chapters.contains(&page.chapter_id)
        {
            return Err(tr("页面或章节标识无效", "Invalid page or chapter ID").into());
        }
        if page.items.is_empty() || page.items.len() > 2 {
            return Err(tr("每页需要 1–2 张照片", "Each page needs one or two photos").into());
        }
        if page.title.chars().count() > 200 || page.caption.chars().count() > 5000 {
            return Err(tr("页面文字过长", "The page text is too long").into());
        }
        for item in &page.items {
            if selected.get(&item.photo_id) != Some(&&page.chapter_id)
                || !used.insert(&item.photo_id)
            {
                return Err(tr(
                    "页面选片与章节不一致或照片重复",
                    "The page photos do not match the chapter or include duplicates",
                )
                .into());
            }
            let numbers = [
                item.x,
                item.y,
                item.width,
                item.height,
                item.crop_x,
                item.crop_y,
            ];
            if numbers.iter().any(|n| !n.is_finite())
                || item.x < 0.0
                || item.y < 0.0
                || item.width <= 0.0
                || item.height <= 0.0
                || item.x + item.width > 100.00001
                || item.y + item.height > 100.00001
                || !(0.0..=100.0).contains(&item.crop_x)
                || !(0.0..=100.0).contains(&item.crop_y)
            {
                return Err(tr(
                    "照片位置、尺寸或裁切超出页面范围",
                    "Photo placement, size, or crop exceeds the page bounds",
                )
                .into());
            }
            if item.fit != "cover" && item.fit != "contain" {
                return Err(tr("无效照片适配方式", "Invalid photo fit").into());
            }
        }
    }
    if used.len() != selected.len() {
        return Err(tr(
            "布局没有包含全部选片",
            "The layout is missing selected photos",
        )
        .into());
    }
    let expected: Vec<&str> = input
        .chapters
        .iter()
        .flat_map(|chapter| chapter.photo_ids.iter().map(String::as_str))
        .collect();
    let actual: Vec<&str> = input
        .pages
        .iter()
        .flat_map(|page| page.items.iter().map(|item| item.photo_id.as_str()))
        .collect();
    if expected != actual {
        return Err(tr(
            "页面顺序必须与章节选片顺序一致",
            "Page order must match the chapter photo order",
        )
        .into());
    }
    Ok(())
}
