use super::{CurationDraft, CurationStore, StagedOriginal};
use std::path::Path;

/// Changes only the pending managed candidates, never existing photos or the live DB.
pub(crate) fn set_pending_source(
    drafts: &CurationStore,
    id: &str,
    root: &Path,
    source: &str,
) -> Result<CurationDraft, String> {
    let mut entries = drafts.0.lock().map_err(|e| e.to_string())?;
    let draft = entries.get_mut(id).ok_or("候选会话不存在或已结束")?;
    if draft.library_root != root {
        return Err("候选会话不属于启动图库".into());
    }
    for photo in &mut draft.view.candidates {
        if matches!(
            draft.staged_originals.get(&photo.id),
            Some(StagedOriginal::Managed)
        ) {
            photo.source = source.into();
        }
    }
    Ok(draft.view.clone())
}
