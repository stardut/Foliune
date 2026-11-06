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
    { id: 'kept', label: '保留', ids: kept },
    { id: 'removed', label: '从当前相簿废弃', ids: removed },
    { id: 'additions', label: '加入或恢复', ids: additions },
    { id: 'skipped', label: '不加入', ids: skipped },
  ].filter((group) => group.ids.length > 0);
  const summaryItems = (review ? summaryGroups : []).flatMap((group) => group.ids.map((id) => ({ groupId: group.id, photo: draft.candidates.find((photo) => photo.id === id)! })));
  const reviewPages = Math.max(1, Math.ceil(summaryItems.length / PHOTO_PAGE_SIZE));
  const currentReviewPage = Math.min(reviewPage, reviewPages - 1);
  const visibleSummary = summaryItems.slice(currentReviewPage * PHOTO_PAGE_SIZE, (currentReviewPage + 1) * PHOTO_PAGE_SIZE);
  return <Modal title={`${draft.groupName} · ${review ? '确认变更' : '选片取舍'}`} wide onClose={() => { if (!busy) void run(onCancel); }}>
    <section className="curation-head">
      <div>
        {!review && <p className="eyebrow">确认前不会改变图库</p>}
        <h3>{review ? '留下这些照片' : overflow ? `还需取消 ${overflow} 张` : '选择想要保留的照片'}</h3>
        <div className="curation-selection">
          <p className="curation-count" aria-live="polite">候选 {draft.candidates.length} <span>保留 {kept.length}</span> 上限 {draft.capacity ?? '不限'}</p>
          {!review && <>
            <button className="text-button" type="button" disabled={busy || kept.length === draft.candidates.length} onClick={() => setKept(draft.candidates.map((photo) => photo.id))}>全部保留</button>
            <button className="text-button" type="button" disabled={busy || !kept.length} onClick={() => setKept([])}>全部不保留</button>
          </>}
        </div>
      </div>
      <button className="button button-quiet" type="button" disabled={compared.length !== 2 || busy || review} onClick={() => setComparing(true)}><Columns2 size={15} />并排比较 {compared.length}/2</button>
    </section>
    {review ? <>
      {reviewPages > 1 && <div className="curation-review-counts" aria-label="变更类别全量计数">{summaryGroups.map((group) => <span key={group.id}>{group.label} <strong>{group.ids.length} 张</strong></span>)}</div>}
      <div className="curation-summary" aria-label="变更照片回顾">
        {summaryGroups.map((group) => {
          const items = visibleSummary.filter((item) => item.groupId === group.id);
          if (!items.length) return null;
          return <section key={group.id} aria-labelledby={`curation-review-${group.id}`}><h4 id={`curation-review-${group.id}`}>{group.label}<span>{group.ids.length} 张</span></h4><div className="curation-review-photos">{items.map(({ photo }) => <figure className="curation-review-photo" key={photo.id}><div className="curation-review-image"><PhotoImage photo={photo} lazy /></div><figcaption title={photo.title || photo.originalName}>{photo.title || photo.originalName}</figcaption></figure>)}</div></section>;
        })}
        {!summaryItems.length && <p className="muted">本次不保留任何照片。</p>}
      </div>
      {reviewPages > 1 && <div className="page-controls curation-review-pagination" aria-label="照片回顾分页"><span>第 {currentReviewPage * PHOTO_PAGE_SIZE + 1}–{Math.min((currentReviewPage + 1) * PHOTO_PAGE_SIZE, summaryItems.length)} 项 · 共 {summaryItems.length} 项回顾</span><div><button className="button" type="button" disabled={currentReviewPage === 0} onClick={() => setReviewPage(currentReviewPage - 1)}><ArrowLeft size={13} />上一页</button><span aria-live="polite">{currentReviewPage + 1} / {reviewPages}</span><button className="button" type="button" disabled={currentReviewPage === reviewPages - 1} onClick={() => setReviewPage(currentReviewPage + 1)}>下一页<ArrowRight size={13} /></button></div></div>}
      <p className="muted curation-review-note">原文件、其他相簿与已有画册保持不变，未保留的新候选不进入图库。</p>
    </> : <><div className="curation-candidates">{draft.candidates.slice(page * PHOTO_PAGE_SIZE, (page + 1) * PHOTO_PAGE_SIZE).map((photo) => <article className={keptIds.has(photo.id) ? 'candidate kept' : 'candidate'} key={photo.id}><PhotoImage photo={photo} lazy /><label className="candidate-keep"><input type="checkbox" checked={keptIds.has(photo.id)} onChange={() => toggle(photo.id)} disabled={busy} /><span>{photo.title || photo.originalName}</span>{draft.activeIds.includes(photo.id) ? <small>已有</small> : <small>待加入</small>}</label><label className="compare-choice"><input type="checkbox" checked={compared.includes(photo.id)} disabled={busy || (!compared.includes(photo.id) && compared.length === 2)} onChange={() => setCompared((ids) => ids.includes(photo.id) ? ids.filter((id) => id !== photo.id) : [...ids, photo.id])} />加入比较</label></article>)}</div><PageControls page={page} total={draft.candidates.length} onPage={setPage} /></>}
    {!!draft.failures.length && <details className="curation-failures"><summary>{draft.failures.length} 个文件无法作为候选</summary>{draft.failures.map((failure) => <p key={failure.path}>{failure.path} · {failure.message}</p>)}</details>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="curation-footer"><button className="button" type="button" disabled={busy} onClick={() => void run(onCancel)}>取消全部变更</button><div>{review && <button className="button" type="button" disabled={busy} onClick={() => setReview(false)}>返回取舍</button>}<button className="button button-primary" type="button" disabled={busy || overflow > 0} onClick={() => review ? void run(() => onCommit(kept)) : setReview(true)}>{busy ? '处理中…' : review ? '确认并保存' : '查看变更'}</button></div></div>
    {comparing && <Modal title="并排比较" wide onClose={() => setComparing(false)}><div className="comparison-grid">{draft.candidates.filter((photo) => compared.includes(photo.id)).map((photo) => <article key={photo.id}><PhotoImage photo={photo} original /><p>{photo.title || photo.originalName}</p><button type="button" className={`button ${keptIds.has(photo.id) ? 'button-primary' : ''}`} onClick={() => toggle(photo.id)}>{keptIds.has(photo.id) && <Check size={14} />}{keptIds.has(photo.id) ? '保留' : '不保留'}</button></article>)}</div><p className="muted">比较只改变本次取舍，关闭后仍需确认保存。</p></Modal>}
  </Modal>;
}
