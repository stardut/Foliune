use super::*;

pub fn prepare_import_files(
    store: &Store,
    drafts: &CurationStore,
    paths: Vec<String>,
    library: &str,
    group_id: Option<&str>,
) -> Result<CurationDraft, String> {
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
                fs::remove_dir_all(&staging)
                    .map_err(|e| format!("{message}；清理候选失败：{e}"))?;
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
    draft.view.failures = imported.failures;
    draft.staging = Some(staging);
    // 解码期间可切换图库；只允许把候选注册到其所属的仍在使用的图库。
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    if crate::db::library_root(&conn)? != draft.library_root {
        cleanup(store, &draft)?;
        return Err("图库已切换，本次候选已取消。".into());
    }
    register(drafts, draft)
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
            return Err("目标分组不属于该图库".into());
        }
        Ok(draft)
    } else {
        Ok(Draft {
            view: CurationDraft {
                id: uuid::Uuid::new_v4().to_string(),
                group_id: None,
                group_name: "全部照片".into(),
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
        register(drafts, self.0)
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
        return Err("未能准备帖子图片。".into());
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

fn register(drafts: &CurationStore, draft: Draft) -> Result<CurationDraft, String> {
    let view = draft.view.clone();
    drafts
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(view.id.clone(), draft);
    Ok(view)
}
