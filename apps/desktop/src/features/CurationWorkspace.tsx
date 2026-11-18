import { photoCount, t } from '../lib/i18n';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, Columns2, Check } from 'lucide-react';
import type { CurationDraft } from '../lib/curation-types';
import { Modal } from '../components/ui';
import { PhotoImage } from '../components/PhotoImage';
import { PageControls, PHOTO_PAGE_SIZE } from '../components/PageControls';

export function CurationWorkspace({ draft, onCommit, onCancel }: {
  draft: CurationDraft; onCommit: (keepIds: string[]) => Promise<void>; onCancel: () => Promise<void>;
}) {
  const [kept, setKept] = useState(draft.candidates.map((photo) => photo.id));
  const [compared, setCompared] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [reviewPage, setReviewPage] = useState(0);
  const keptIds = new Set(kept);
  const overflow = draft.capacity === null ? 0 : Math.max(0, kept.length - draft.capacity);
  const removed = draft.activeIds.filter((id) => !keptIds.has(id));
  const additions = draft.pendingIds.filter((id) => keptIds.has(id));
  const skipped = draft.pendingIds.filter((id) => !keptIds.has(id));
  function toggle(id: string) { setKept((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]); setReview(false); }
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } }
  const summaryGroups = [
    { id: 'kept', label: t('保留', 'Keep'), ids: kept },
    { id: 'removed', label: t('从当前相簿废弃', 'Move to This Album’s Rejects'), ids: removed },
    { id: 'additions', label: t('加入或恢复', 'Add or Restore'), ids: additions },
    { id: 'skipped', label: t('不加入', 'Skip'), ids: skipped },
  ].filter((group) => group.ids.length > 0);
  const summaryItems = (review ? summaryGroups : []).flatMap((group) => group.ids.map((id) => ({ groupId: group.id, photo: draft.candidates.find((photo) => photo.id === id)! })));
  const reviewPages = Math.max(1, Math.ceil(summaryItems.length / PHOTO_PAGE_SIZE));
  const currentReviewPage = Math.min(reviewPage, reviewPages - 1);
  const reviewStart = currentReviewPage * PHOTO_PAGE_SIZE + 1;
  const reviewEnd = Math.min((currentReviewPage + 1) * PHOTO_PAGE_SIZE, summaryItems.length);
  const visibleSummary = summaryItems.slice(reviewStart - 1, reviewEnd);
  return <Modal title={`${draft.groupName} · ${review ? t('确认变更', 'Confirm Changes') : t('选片取舍', 'Choose Photos to Keep')}`} wide onClose={() => { if (!busy) void run(onCancel); }}>
    <section className="curation-head">
      <div>
        {!review && <p className="eyebrow">{t('确认前不会改变图库', 'Changes are applied after confirmation')}</p>}
        <h3>{review ? t('留下这些照片', 'Photos to Keep') : overflow ? t(`还需取消 ${overflow} 张`, `Deselect ${overflow} more`) : t('选择想要保留的照片', 'Choose the photos to keep')}</h3>
        <div className="curation-selection">
          <p className="curation-count" aria-live="polite">{t('候选', 'Candidates')} {draft.candidates.length} <span>{t('保留', 'Keep')} {kept.length}</span> {t('上限', 'Limit')} {draft.capacity ?? t('不限', 'Unlimited')}</p>
          {!review && <>
            <button className="text-button" type="button" disabled={busy || kept.length === draft.candidates.length} onClick={() => setKept(draft.candidates.map((photo) => photo.id))}>{t('全部保留', 'Keep All')}</button>
            <button className="text-button" type="button" disabled={busy || !kept.length} onClick={() => setKept([])}>{t('全部不保留', 'Deselect All')}</button>
          </>}
        </div>
      </div>
      <button className="button button-quiet" type="button" disabled={compared.length !== 2 || busy || review} onClick={() => setComparing(true)}><Columns2 size={15} />{t('并排比较', 'Compare Side by Side')} {compared.length}/2</button>
    </section>
    {review ? <>
      {reviewPages > 1 && <div className="curation-review-counts" aria-label={t('变更类别全量计数', 'Totals by Change Type')}>{summaryGroups.map((group) => <span key={group.id}>{group.label} <strong>{t(`${group.ids.length} 张`, photoCount(group.ids.length))}</strong></span>)}</div>}
      <div className="curation-summary" aria-label={t('变更照片回顾', 'Review Photo Changes')}>
        {summaryGroups.map((group) => {
          const items = visibleSummary.filter((item) => item.groupId === group.id);
          if (!items.length) return null;
          return <section key={group.id} aria-labelledby={`curation-review-${group.id}`}><h4 id={`curation-review-${group.id}`}>{group.label}<span>{t(`${group.ids.length} 张`, photoCount(group.ids.length))}</span></h4><div className="curation-review-photos">{items.map(({ photo }) => <figure className="curation-review-photo" key={photo.id}><div className="curation-review-image"><PhotoImage photo={photo} lazy /></div><figcaption title={photo.title || photo.originalName}>{photo.title || photo.originalName}</figcaption></figure>)}</div></section>;
        })}
        {!summaryItems.length && <p className="muted">{t('本次不保留任何照片。', 'No photos selected to keep.')}</p>}
      </div>
      {reviewPages > 1 && <div className="page-controls curation-review-pagination" aria-label={t('照片回顾分页', 'Review Pagination')}><span>{t(`第 ${reviewStart}–${reviewEnd} 项 · 共 ${summaryItems.length} 项回顾`, `${reviewStart}–${reviewEnd} of ${summaryItems.length}`)}</span><div><button className="button" type="button" disabled={currentReviewPage === 0} onClick={() => setReviewPage(currentReviewPage - 1)}><ArrowLeft size={13} />{t('上一页', 'Previous Page')}</button><span aria-live="polite">{currentReviewPage + 1} / {reviewPages}</span><button className="button" type="button" disabled={currentReviewPage === reviewPages - 1} onClick={() => setReviewPage(currentReviewPage + 1)}>{t('下一页', 'Next Page')}<ArrowRight size={13} /></button></div></div>}
      <p className="muted curation-review-note">{t('原文件、其他相簿与已有画册保持不变，未保留的新候选不进入图库。', 'Original files, other albums, and existing photo books are preserved. Only selected new photos are added to the library.')}</p>
    </> : <><div className="curation-candidates">{draft.candidates.slice(page * PHOTO_PAGE_SIZE, (page + 1) * PHOTO_PAGE_SIZE).map((photo) => <article className={keptIds.has(photo.id) ? 'candidate kept' : 'candidate'} key={photo.id}><PhotoImage photo={photo} lazy /><label className="candidate-keep"><input type="checkbox" checked={keptIds.has(photo.id)} onChange={() => toggle(photo.id)} disabled={busy} /><span>{photo.title || photo.originalName}</span>{draft.activeIds.includes(photo.id) ? <small>{t('已有', 'In Album')}</small> : <small>{t('待加入', 'New')}</small>}</label><label className="compare-choice"><input type="checkbox" checked={compared.includes(photo.id)} disabled={busy || (!compared.includes(photo.id) && compared.length === 2)} onChange={() => setCompared((ids) => ids.includes(photo.id) ? ids.filter((id) => id !== photo.id) : [...ids, photo.id])} />{t('加入比较', 'Add to Comparison')}</label></article>)}</div><PageControls page={page} total={draft.candidates.length} onPage={setPage} /></>}
    {!!draft.failures.length && <details className="curation-failures"><summary>{t(`${draft.failures.length} 个文件无法作为候选`, `${draft.failures.length} ${draft.failures.length === 1 ? 'file' : 'files'} could not be added to the selection`)}</summary>{draft.failures.map((failure) => <p key={failure.path}>{failure.path} · {failure.message}</p>)}</details>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="curation-footer"><button className="button" type="button" disabled={busy} onClick={() => void run(onCancel)}>{t('取消全部变更', 'Cancel All Changes')}</button><div>{review && <button className="button" type="button" disabled={busy} onClick={() => setReview(false)}>{t('返回取舍', 'Back to Selection')}</button>}<button className="button button-primary" type="button" disabled={busy || overflow > 0} onClick={() => review ? void run(() => onCommit(kept)) : setReview(true)}>{busy ? t('处理中…', 'Working…') : review ? t('确认并保存', 'Confirm and Save') : t('查看变更', 'Review Changes')}</button></div></div>
    {comparing && <Modal title={t('并排比较', 'Side-by-Side Comparison')} wide onClose={() => setComparing(false)}><div className="comparison-grid">{draft.candidates.filter((photo) => compared.includes(photo.id)).map((photo) => <article key={photo.id}><PhotoImage photo={photo} original /><p>{photo.title || photo.originalName}</p><button type="button" className={`button ${keptIds.has(photo.id) ? 'button-primary' : ''}`} onClick={() => toggle(photo.id)}>{keptIds.has(photo.id) && <Check size={14} />}{keptIds.has(photo.id) ? t('保留', 'Keep') : t('不保留', 'Don’t Keep')}</button></article>)}</div><p className="muted">{t('比较只改变本次取舍，关闭后仍需确认保存。', 'Changes here apply to this selection. Confirm and save after closing.')}</p></Modal>}
  </Modal>;
}
