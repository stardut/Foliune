use super::*;

enum ImportSource<'a> {
    Local,
    Link { expected_root: &'a Path },
}

pub fn prepare_import_files(
    store: &Store,
    drafts: &CurationStore,
    paths: Vec<String>,
    library: &str,
    group_id: Option<&str>,
) -> Result<CurationDraft, String> {
    prepare_import_candidates(store, drafts, paths, library, group_id, ImportSource::Local)
}

pub(crate) fn prepare_link_import_files(
    store: &Store,
    drafts: &CurationStore,
    paths: Vec<String>,
    library: &str,
    group_id: Option<&str>,
    root: &Path,
) -> Result<CurationDraft, String> {
    prepare_import_candidates(
        store,
        drafts,
        paths,
        library,
        group_id,
        ImportSource::Link {
            expected_root: root,
        },
    )
}

fn prepare_import_candidates(
    store: &Store,
    drafts: &CurationStore,
    paths: Vec<String>,
    library: &str,
    group_id: Option<&str>,
    source: ImportSource<'_>,
) -> Result<CurationDraft, String> {
    models::library(library)?;
    let mut draft = if let Some(id) = group_id {
        let draft = group_draft(
            &*store.connection.lock().map_err(|e| e.to_string())?,
            id,
            serde_json::json!({}),
        )?;
        if draft
            .target
            .as_ref()
            .is_none_or(|group| group.library != library)
        {
            return Err("目标分组不属于该图库".into());
        }
        draft
    } else {
        Draft {
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
            library_root: crate::db::library_root(
                &*store.connection.lock().map_err(|e| e.to_string())?,
            )?,
        }
    };
    if let ImportSource::Link { expected_root } = source {
        if expected_root != draft.library_root {
            return Err("图库已切换，本次链接候选已取消。".into());
        }
    }
    let staging = draft.library_root.join("staging").join(&draft.view.id);
    let prepared = (|| -> Result<_, String> {
        let temporary = Store::open_direct(staging.clone())?;
        let (imported, originals) = match source {
            ImportSource::Local => {
                let (imported, signatures) =
                    photos::import_local(&temporary, paths, library, None)?;
                let originals = signatures
                    .into_iter()
                    .map(|(id, signature)| (id, StagedOriginal::Local { signature }))
                    .collect();
                (imported, originals)
            }
            ImportSource::Link { .. } => {
                let imported = photos::import(&temporary, paths, library, None)?;
                let originals = imported
                    .imported_ids
                    .iter()
                    .map(|id| (id.clone(), StagedOriginal::Managed))
                    .collect();
                (imported, originals)
            }
        };
        Ok((imported, originals))
    })();
    let (imported, originals) = match prepared {
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
    draft.staged_originals = originals;
    draft.view.candidates.extend(imported.snapshot.photos);
    draft.view.failures = imported.failures;
    draft.staging = Some(staging);
    // 解码期间可切换图库；只允许把候选注册到其所属的仍在使用的图库。
    let conn = store.connection.lock().map_err(|e| e.to_string())?;
    if crate::db::library_root(&conn)? != draft.library_root {
        cleanup(store, &draft)?;
        return Err("图库已切换，本次候选已取消。".into());
    }
    let view = draft.view.clone();
    drafts
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(view.id.clone(), draft);
    Ok(view)
}
