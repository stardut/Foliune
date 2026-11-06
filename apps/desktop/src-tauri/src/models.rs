use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Photo {
    pub id: String,
    pub library: String,
    pub title: String,
    pub original_name: String,
    pub original_path: String,
    pub thumbnail_path: String,
    pub original_available: bool,
    pub thumbnail_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub availability: Option<crate::work_directory::BoundAvailability>,
    pub width: u32,
    pub height: u32,
    pub tags: Vec<String>,
    pub regions: Vec<PhotoRegion>,
    pub annotation: String,
    pub source: String,
    pub captured_at: Option<String>,
    pub location: String,
    pub project: String,
    pub imported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PhotoRegion {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub library: String,
    pub name: String,
    pub description: String,
    pub capacity: Option<u32>,
    pub created_at: String,
    pub cover: Option<AlbumCover>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bound_folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AlbumCover {
    pub photo_id: String,
    pub offset_x: f64,
    pub offset_y: f64,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Membership {
    pub group_id: String,
    pub photo_id: String,
    pub status: String,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub photos: Vec<Photo>,
    pub groups: Vec<Group>,
    pub memberships: Vec<Membership>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub hidden_photo_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupInput {
    pub library: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub capacity: Option<u32>,
}

pub fn library(value: &str) -> Result<(), String> {
    match value {
        "collection" | "work" => Ok(()),
        _ => Err("未知图库类型".into()),
    }
}

pub fn name(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 200 {
        Err("名称应为 1–200 个字符".into())
    } else {
        Ok(value)
    }
}
