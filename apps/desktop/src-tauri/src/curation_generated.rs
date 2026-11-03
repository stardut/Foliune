use super::*;
use std::path::Path;

/// 生成图同样只进入候选暂存；正式副本及相簿关系由统一取舍事务提交。
pub(crate) fn prepare_generated(
    store: &Store,
    drafts: &CurationStore,
    library_root: &Path,
    library: &str,
    group_id: &str,
    title: &str,
    sources: &[Photo],
    render: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<CurationDraft, String> {
    let mut draft = {
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        if crate::db::library_root(&conn)? != library_root {
            return Err("图库已切换，请重新开始拼图。".into());
        }
        let draft = group_draft(&conn, group_id, serde_json::json!({}))?;
        if draft
            .target
            .as_ref()
            .is_none_or(|group| group.library != library)
        {
            return Err("目标相簿不属于当前图库类别".into());
        }
        draft
    };
    let staging = draft.library_root.join("staging").join(&draft.view.id);
    draft.staging = Some(staging.clone());
    let prepared = (|| {
        let temporary = Store::open_direct(staging.clone())?;
        let rendered = staging.join("拼图.png");
        render(&rendered)?;
        let mut imported = photos::import(
            &temporary,
            vec![rendered.to_string_lossy().into_owned()],
            library,
            None,
        )?;
        fs::remove_file(rendered).map_err(|e| format!("清理拼图中间文件失败：{e}"))?;
        if imported.imported_ids.len() != 1 || !imported.failures.is_empty() {
            return Err(imported
                .failures
                .first()
                .map(|failure| failure.message.clone())
                .unwrap_or_else(|| "拼图未生成可保存的照片".into()));
        }
        // 标题作为照片元数据保存，不用用户输入构造任何文件路径。
        imported.snapshot.photos[0].title = title.trim().into();
        draft.view.pending_ids = imported.imported_ids;
        draft.staged_ids = draft.view.pending_ids.iter().cloned().collect();
        draft.view.candidates.extend(imported.snapshot.photos);
        let conn = store.connection.lock().map_err(|e| e.to_string())?;
        if crate::db::library_root(&conn)? != library_root {
            return Err("图库已切换，本次拼图候选已取消。".into());
        }
        for source in sources {
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
        let view = draft.view.clone();
        drafts
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(view.id.clone(), draft);
        Ok(view)
    })();
    if let Err(message) = prepared {
        if staging.exists() {
            fs::remove_dir_all(staging).map_err(|e| format!("{message}；清理拼图候选失败：{e}"))?;
        }
        return Err(message);
    }
    prepared
}
