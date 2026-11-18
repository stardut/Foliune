use super::*;
use crate::locale::{display_format, tr};

pub fn prepare_import_files(
    store: &Store,
    drafts: &CurationStore,
    paths: Vec<String>,
    library: &str,
    group_id: Option<&str>,
) -> Result<CurationDraft, String> {
    let (paths, mut failures) = expand_import_paths(paths);
    let mut draft = {
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        import_draft(&conn, library, group_id)?
    };
    let staging = draft.library_root.join("staging").join(&draft.view.id);
    let prepared = (|| {
        let temporary = Store::open_direct(staging.clone())?;
        photos::import_local(&temporary, paths, library, None)
    })();
    let (imported, signatures) = match prepared {
        Ok(imported) => imported,
        Err(message) => {
            if staging.exists() {
                fs::remove_dir_all(&staging).map_err(|e| {
                    display_format!(
                        "{message}；清理候选失败：{e}",
                        "{message}. Could not clean up candidate photos: {e}"
                    )
                })?;
            }
            return Err(message);
        }
    };
    draft.view.pending_ids = imported.imported_ids;
    draft.staged_originals = signatures
        .into_iter()
        .map(|(id, signature)| (id, StagedOriginal::Local { signature }))
        .collect();
    draft.view.candidates.extend(imported.snapshot.photos);
    failures.extend(imported.failures);
    draft.view.failures = failures;
    draft.staging = Some(staging);
    // 解码期间可切换图库；只允许把候选注册到其所属的仍在使用的图库。
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    if crate::db::library_root(&conn)? != draft.library_root {
        cleanup(store, &draft)?;
        return Err(tr(
            "图库已切换，本次候选已取消。",
            "The library changed. This selection was canceled.",
        )
        .into());
    }
    drafts.register(draft)
}

fn expand_import_paths(paths: Vec<String>) -> (Vec<String>, Vec<ImportFailure>) {
    let mut files = Vec::new();
    let mut failures = Vec::new();
    for path in paths {
        let source = Path::new(&path);
        if source.is_absolute() && source.is_dir() {
            match import_folder_files(source) {
                Ok(photos) => files.extend(photos),
                Err(message) => failures.push(ImportFailure { path, message }),
            }
        } else {
            files.push(path);
        }
    }
    // Selecting an item and its containing folder yields the item only once.
    let mut seen = HashSet::new();
    files.retain(|path| seen.insert(path.clone()));
    (files, failures)
}

fn import_folder_files(source: &Path) -> Result<Vec<String>, String> {
    let folder_error = |error| {
        display_format!(
            "无法读取文件夹：{error}",
            "Could not read the folder: {error}"
        )
    };
    let entries = fs::read_dir(source).map_err(folder_error)?;
    let mut photos = Vec::new();
    for entry in entries {
        let entry = entry.map_err(folder_error)?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            display_format!(
                "无法读取「{}」：{error}",
                "Could not read “{}”: {error}",
                path.display()
            )
        })?;
        if file_type.is_file() && photos::supported_extension(&path) {
            photos.push(path);
        }
    }
    photos.sort_by(|left, right| left.file_name().cmp(&right.file_name()));
    if photos.is_empty() {
        return Err(tr(
            "文件夹当前层级没有 JPEG、PNG 或 WebP 照片。",
            "This folder has no JPEG, PNG, or WebP photos at its top level.",
        )
        .into());
    }
    photos
        .into_iter()
        .map(|path| {
            path.into_os_string().into_string().map_err(|_| {
                tr(
                    "文件夹含无法读取路径的照片",
                    "The folder contains a photo with an unreadable path",
                )
                .into()
            })
        })
        .collect()
}

fn import_draft(conn: &Connection, library: &str, group_id: Option<&str>) -> Result<Draft, String> {
    models::library(library)?;
    if let Some(id) = group_id {
        let draft = group_draft(conn, id, serde_json::json!({}))?;
        if draft
            .target
            .as_ref()
            .is_none_or(|group| group.library != library)
        {
            return Err(tr(
                "目标分组不属于该图库",
                "The selected album belongs to a different library section",
            )
            .into());
        }
        Ok(draft)
    } else {
        Ok(Draft {
            view: CurationDraft {
                id: uuid::Uuid::new_v4().to_string(),
                group_id: None,
                group_name: tr("全部照片", "All Photos").into(),
                capacity: None,
                candidates: Vec::new(),
                active_ids: Vec::new(),
                pending_ids: Vec::new(),
                failures: Vec::new(),
            },
            target: None,
            signature: None,
            staging: None,
            staged_originals: HashMap::new(),
            library_root: crate::db::library_root(conn)?,
        })
    }
}

pub(crate) struct PreparedLinkImport(Draft);

impl PreparedLinkImport {
    pub(crate) fn register(self, drafts: &CurationStore) -> Result<CurationDraft, String> {
        drafts.register(self.0)
    }
}

pub(crate) fn prepare_link_import_draft(
    conn: &Connection,
    id: &str,
    library: &str,
    group_id: Option<&str>,
    photos: Vec<Photo>,
) -> Result<PreparedLinkImport, String> {
    if photos.is_empty() {
        return Err(tr(
            "未能准备帖子图片。",
            "Could not prepare photos from the post.",
        )
        .into());
    }
    let mut draft = import_draft(conn, library, group_id)?;
    draft.view.id = id.into();
    draft.staging = Some(draft.library_root.join("staging").join(id));
    for photo in photos {
        draft.view.pending_ids.push(photo.id.clone());
        draft
            .staged_originals
            .insert(photo.id.clone(), StagedOriginal::Managed);
        draft.view.candidates.push(photo);
    }
    Ok(PreparedLinkImport(draft))
}
