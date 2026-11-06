use crate::{
    db::{snapshot, Store},
    models::{self, Group, Photo, Snapshot},
    photos::{self, ImportFailure},
};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};

#[path = "link_import_source.rs"]
mod link_source;
pub(crate) use link_source::set_pending_source;
#[path = "link_import_curation.rs"]
mod import_files;
pub use import_files::prepare_import_files;
pub(crate) use import_files::prepare_link_import_files;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurationDraft {
    pub id: String,
    pub group_id: Option<String>,
    pub group_name: String,
    pub capacity: Option<u32>,
    pub candidates: Vec<Photo>,
    pub active_ids: Vec<String>,
    pub pending_ids: Vec<String>,
    pub failures: Vec<ImportFailure>,
}

struct Draft {
    view: CurationDraft,
    target: Option<Group>,
    signature: Option<String>,
    staging: Option<PathBuf>,
    staged_originals: HashMap<String, StagedOriginal>,
    library_root: PathBuf,
}

enum StagedOriginal {
    Managed,
    Local { signature: String },
}

#[derive(Default)]
pub struct CurationStore(Mutex<HashMap<String, Draft>>);

impl Drop for CurationStore {
    fn drop(&mut self) {
        if let Ok(items) = self.0.get_mut() {
            for draft in items.values() {
                if let Some(path) = &draft.staging {
                    if *path == draft.library_root.join("staging").join(&draft.view.id) {
                        let _ = fs::remove_dir_all(path);
                    }
                }
            }
        }
    }
}

fn signature(conn: &Connection, group_id: &str) -> Result<String, String> {
    let state = snapshot(conn)?;
    let group = state
        .groups
        .iter()
        .find(|group| group.id == group_id)
        .ok_or("分组不存在")?;
    let members: Vec<_> = state
        .memberships
        .iter()
        .filter(|member| member.group_id == group_id)
        .collect();
    serde_json::to_string(&(group, members)).map_err(|e| e.to_string())
}

fn group_draft(conn: &Connection, group_id: &str, patch: Value) -> Result<Draft, String> {
    let state = snapshot(conn)?;
    let mut group = state
        .groups
        .iter()
        .find(|group| group.id == group_id)
        .cloned()
        .ok_or("分组不存在")?;
    let patch = patch.as_object().ok_or("无效取舍请求")?;
    let mut requested = Vec::new();
    for (key, value) in patch {
        match key.as_str() {
            "photoIds" => {
                for id in value.as_array().ok_or("候选照片必须是 ID 数组")? {
                    let id = id.as_str().ok_or("候选照片 ID 必须是文本")?.to_string();
                    if !requested.contains(&id) {
                        requested.push(id);
                    }
                }
            }
            "name" => {
                group.name = models::name(value.as_str().ok_or("分组名称必须是文本")?)?.into()
            }
            "description" => {
                group.description = value.as_str().ok_or("分组描述必须是文本")?.trim().into()
            }
            "capacity" => {
                group.capacity = if value.is_null() {
                    None
                } else {
                    Some(
                        value
                            .as_u64()
                            .filter(|n| *n > 0 && *n <= u32::MAX as u64)
                            .ok_or("分组容量必须为正整数或无限制")? as u32,
                    )
                }
            }
            _ => return Err(format!("未知取舍字段：{key}")),
        }
    }
    let active_ids: Vec<_> = state
        .memberships
        .iter()
        .filter(|member| member.group_id == group_id && member.status == "active")
        .map(|member| member.photo_id.clone())
        .collect();
    let mut candidates = Vec::new();
    for id in &active_ids {
        candidates.push(
            state
                .photos
                .iter()
                .find(|photo| photo.id == *id)
                .cloned()
                .ok_or("分组照片缺失")?,
        );
    }
    let mut pending_ids = Vec::new();
    for id in requested {
        if active_ids.contains(&id) {
            continue;
        }
        let photo = state
            .photos
            .iter()
            .find(|photo| photo.id == id && photo.library == group.library)
            .cloned()
            .ok_or("候选照片不存在或属于其他图库")?;
        candidates.push(photo);
        pending_ids.push(id);
    }
    Ok(Draft {
        view: CurationDraft {
            id: uuid::Uuid::new_v4().to_string(),
            group_id: Some(group_id.into()),
            group_name: group.name.clone(),
            capacity: group.capacity,
            candidates,
            active_ids,
            pending_ids,
            failures: Vec::new(),
        },
        target: Some(group),
        signature: Some(signature(conn, group_id)?),
        staging: None,
        staged_originals: HashMap::new(),
        library_root: crate::db::library_root(conn)?,
    })
}

pub fn prepare_group(
    store: &Store,
    drafts: &CurationStore,
    group_id: &str,
    patch: Value,
) -> Result<CurationDraft, String> {
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    let draft = group_draft(&conn, group_id, patch)?;
    let view = draft.view.clone();
    drafts
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(view.id.clone(), draft);
    Ok(view)
}

fn cleanup(store: &Store, draft: &Draft) -> Result<(), String> {
    if let Some(path) = &draft.staging {
        if !draft.library_root.starts_with(&store.root)
            || *path != draft.library_root.join("staging").join(&draft.view.id)
        {
            return Err("候选目录校验失败".into());
        }
        if path.exists() {
            fs::remove_dir_all(path).map_err(|e| format!("清理候选失败：{e}"))?;
        }
    }
    Ok(())
}

pub fn cancel(store: &Store, drafts: &CurationStore, id: &str) -> Result<(), String> {
    let mut items = drafts.0.lock().map_err(|e| e.to_string())?;
    let Some(draft) = items.get(id) else {
        return Ok(());
    };
    cleanup(store, draft)?;
    items.remove(id);
    Ok(())
}

pub fn commit(
    store: &Store,
    drafts: &CurationStore,
    id: &str,
    keep_ids: Vec<String>,
) -> Result<Snapshot, String> {
    let draft = drafts
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remove(id)
        .ok_or("候选会话不存在或已结束")?;
    let mut created = Vec::new();
    let result = commit_inner(store, &draft, keep_ids, &mut created);
    if let Err(message) = result {
        let mut errors = vec![message];
        for path in created {
            if path.exists() {
                if let Err(error) = fs::remove_file(path) {
                    errors.push(format!("回滚候选文件失败：{error}"));
                }
            }
        }
        if let Err(error) = cleanup(store, &draft) {
            errors.push(error);
        }
        return Err(errors.join("；"));
    }
    result
}

fn save_staged_file(
    staging: &Path,
    library_root: &Path,
    folder: &str,
    source: &str,
    created: &mut Vec<PathBuf>,
) -> Result<PathBuf, String> {
    let source = Path::new(source);
    if source.parent() != Some(staging.join(folder).as_path()) {
        return Err("候选文件目录不合法".into());
    }
    let target = library_root
        .join(folder)
        .join(source.file_name().ok_or("候选文件名无效")?);
    let mut input = fs::File::open(source).map_err(|error| format!("读取候选文件失败：{error}"))?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|error| format!("创建图库文件失败：{error}"))?;
    // 只记录本次创建的文件，复制失败时也清理部分写入。
    created.push(target.clone());
    io::copy(&mut input, &mut output).map_err(|error| format!("保存图库文件失败：{error}"))?;
    Ok(target)
}

fn commit_inner(
    store: &Store,
    draft: &Draft,
    keep_ids: Vec<String>,
    created: &mut Vec<PathBuf>,
) -> Result<Snapshot, String> {
    let keep: HashSet<_> = keep_ids.iter().cloned().collect();
    if keep.len() != keep_ids.len() {
        return Err("保留集合包含重复照片".into());
    }
    let valid: HashSet<_> = draft
        .view
        .candidates
        .iter()
        .map(|photo| photo.id.clone())
        .collect();
    if !keep.is_subset(&valid) {
        return Err("保留集合含不属于此候选会话的照片".into());
    }
    if draft
        .view
        .capacity
        .is_some_and(|capacity| keep.len() > capacity as usize)
    {
        return Err("保留照片超过分组容量".into());
    }
    let mut conn = store.connection.lock().map_err(|e| e.to_string())?;
    if crate::db::library_root(&conn)? != draft.library_root {
        return Err("图库已切换，请重新开始取舍。".into());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if let Some(group_id) = &draft.view.group_id {
        if Some(signature(&tx, group_id)?) != draft.signature {
            return Err("分组已被其他操作修改，请重新开始取舍。".into());
        }
        let existing: Vec<_> = draft
            .view
            .pending_ids
            .iter()
            .filter(|id| keep.contains(*id) && !draft.staged_originals.contains_key(*id))
            .cloned()
            .collect();
        crate::content_refs::validate_photos(&tx, &existing)?;
    }
    for photo in &draft.view.candidates {
        if !keep.contains(&photo.id) {
            continue;
        }
        let Some(original) = draft.staged_originals.get(&photo.id) else {
            continue;
        };
        let staging = draft.staging.as_ref().ok_or("新照片缺少暂存目录")?;
        let original = match original {
            StagedOriginal::Managed => save_staged_file(
                staging,
                &draft.library_root,
                "originals",
                &photo.original_path,
                created,
            )?
            .to_string_lossy()
            .into_owned(),
            StagedOriginal::Local { signature } => {
                let current =
                    crate::local_photo::signature(&photo.original_path).map_err(|_| {
                        format!(
                            "无法读取「{}」的原件，请检查原件位置后重新导入。",
                            photo.original_name
                        )
                    })?;
                if current != *signature {
                    return Err(format!(
                        "「{}」的原件已变化，请重新导入。",
                        photo.original_name
                    ));
                }
                photo.original_path.clone()
            }
        };
        let thumbnail = save_staged_file(
            staging,
            &draft.library_root,
            "thumbnails",
            &photo.thumbnail_path,
            created,
        )?;
        tx.execute("INSERT INTO photos(id,library,title,original_name,original_path,thumbnail_path,width,height,tags,regions,annotation,source,captured_at,location,project,imported_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)", params![photo.id,photo.library,photo.title,photo.original_name,original,thumbnail.to_string_lossy(),photo.width,photo.height,serde_json::to_string(&photo.tags).map_err(|e| e.to_string())?,serde_json::to_string(&photo.regions).map_err(|e| e.to_string())?,photo.annotation,photo.source,photo.captured_at,photo.location,photo.project,photo.imported_at]).map_err(|e| e.to_string())?;
    }
    if let Some(group) = &draft.target {
        tx.execute(
            "UPDATE groups SET name=?1,description=?2,capacity=?3 WHERE id=?4",
            params![group.name, group.description, group.capacity, group.id],
        )
        .map_err(|e| e.to_string())?;
        for id in &draft.view.active_ids {
            if !keep.contains(id) {
                tx.execute(
                    "UPDATE memberships SET status='discarded' WHERE group_id=?1 AND photo_id=?2",
                    params![group.id, id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        let position: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(position),-1)+1 FROM memberships WHERE group_id=?1",
                [&group.id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        for (index, id) in draft.view.pending_ids.iter().enumerate() {
            if keep.contains(id) {
                tx.execute("INSERT INTO memberships(group_id,photo_id,status,position) VALUES(?1,?2,'active',?3) ON CONFLICT(group_id,photo_id) DO UPDATE SET status='active'",params![group.id,id,position+index as i64]).map_err(|e| e.to_string())?;
            }
        }
    }
    cleanup(store, draft)?;
    let state = snapshot(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(state)
}

pub fn cancel_all(store: &Store, drafts: &CurationStore) -> Result<(), String> {
    let mut items = drafts.0.lock().map_err(|e| e.to_string())?;
    for draft in items.values() {
        cleanup(store, draft)?;
    }
    items.clear();
    Ok(())
}

#[tauri::command]
pub async fn prepare_import(
    app: tauri::AppHandle,
    paths: Vec<String>,
    library: String,
    group_id: Option<String>,
) -> Result<CurationDraft, String> {
    tauri::async_runtime::spawn_blocking(move || {
        prepare_import_files(
            &app.state::<Store>(),
            &app.state::<CurationStore>(),
            paths,
            &library,
            group_id.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn prepare_group_curation(
    store: State<'_, Store>,
    drafts: State<'_, CurationStore>,
    group_id: String,
    patch: Value,
) -> Result<CurationDraft, String> {
    prepare_group(&store, &drafts, &group_id, patch)
}

#[tauri::command]
pub async fn commit_curation(
    app: tauri::AppHandle,
    draft_id: String,
    keep_ids: Vec<String>,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        commit(
            &app.state::<Store>(),
            &app.state::<CurationStore>(),
            &draft_id,
            keep_ids,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn cancel_curation(app: tauri::AppHandle, draft_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        cancel(
            &app.state::<Store>(),
            &app.state::<CurationStore>(),
            &draft_id,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
