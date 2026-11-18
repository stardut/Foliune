import { t } from '../lib/i18n.ts';
import { useId, useMemo, useState } from 'react';
import { Files, Link2 } from 'lucide-react';
import type { LibraryKind, LibrarySnapshot, Photo } from '../lib/types';
import type { CurationDraft } from '../lib/curation-types';
import { CurationWorkspace } from '../features/CurationWorkspace';
import { Busy, EmptyState, Modal } from './ui';
import { PhotoLibraryPicker } from './PhotoPicker';
import { PhotoSelectionControls } from './PhotoSelectionControls';
import { PhotoSourceGrid } from './PhotoSourceGrid';
import { useToast } from './ToastProvider';
import { usePhotoSourceImport } from './use-photo-source-import';
import './photo-picker.css';
import './photo-source.css';

export interface PhotoSourceResult { photoIds: string[]; snapshot?: LibrarySnapshot }
export interface PhotoSourceDialogProps {
  snapshot: LibrarySnapshot;
  selectedIds?: string[];
  library: LibraryKind;
  groupId?: string;
  allowLibrary?: boolean;
  maxSelection?: number;
  title?: string;
  onConfirm: (result: PhotoSourceResult) => void;
  onClose: () => void;
  onBusyChange?: (busy: boolean) => void;
}
type Source = 'library' | 'local' | 'link';

function LinkImportProgress({ total, ready, onStop }: { total: number | null; ready: number; onStop?: () => void }) {
  const text = total === null ? t('正在读取帖子…', 'Loading post…') : t(`已获取 ${ready} / ${total} 张`, `Loaded ${ready} of ${total}`);
  return <>
    <div className="photo-source-progress" role="progressbar" aria-label={total === null ? text : t('链接图片获取进度', 'Photo download progress')}
      aria-valuemin={total === null ? undefined : 0} aria-valuemax={total ?? undefined}
      aria-valuenow={total === null ? undefined : ready} aria-valuetext={total === null ? undefined : text}>
      <span className="photo-source-progress-track" aria-hidden="true"><span style={total === null ? undefined : { width: `${ready / total * 100}%` }} /></span>
      <span>{text}</span>
    </div>
    {onStop && <button type="button" className="text-button" onClick={onStop}>{t('停止获取', 'Stop Download')}</button>}
  </>;
}

export function PhotoSourceDialog({ snapshot, selectedIds = [], library, groupId, allowLibrary = true,
  maxSelection, title = t('选择照片', 'Select Photos'), onConfirm, onClose, onBusyChange }: PhotoSourceDialogProps) {
  const [source, setSource] = useState<Source>(allowLibrary ? 'library' : 'local');
  const [selected, setSelected] = useState(() => allowLibrary ? [...new Set(selectedIds)] : []);
  const [pendingSelected, setPendingSelected] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [review, setReview] = useState<{ draft: CurationDraft; chosenIds: string[]; skippedForLimit: number } | null>(null);
  const linkHintId = useId();
  const session = usePhotoSourceImport({ library, groupId, onBusyChange });
  const toast = useToast();
  const pendingPhotos = useMemo(() => {
    const pending = new Set(session.draft?.pendingIds);
    const byId = new Map(session.draft?.candidates.map((photo) => [photo.id, photo]));
    return [...pending].map((id) => byId.get(id)).filter((photo): photo is Photo => photo !== undefined);
  }, [session.draft]);
  const showLinkProgress = !session.cleaning && !session.error && (session.linkProgress !== null || pendingPhotos.length > 0);
  const loadingNextPhoto = session.linkProgress !== null
    && (session.linkProgress.total === null || session.linkProgress.photos.length < session.linkProgress.total);
  const totalSelected = selected.length + pendingSelected.length;
  const overLimit = maxSelection !== undefined && totalSelected > maxSelection;
  const remaining = maxSelection === undefined ? undefined : Math.max(0, maxSelection - selected.length);

  function togglePending(id: string) {
    setPendingSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id)
      : maxSelection !== undefined && totalSelected >= maxSelection ? ids : [...ids, id]);
  }
  async function close() {
    if (await session.clear() && session.isMounted()) onClose();
  }
  async function changeSource(next: Source) {
    if (source === next || session.committing || session.cleaning) return;
    if (await session.clear() && session.isMounted()) {
      setPendingSelected([]);
      setReview(null);
      setSource(next);
    }
  }
  async function prepare() {
    if (source === 'library' || session.busy) return;
    if (source === 'local' && remaining === 0) return;
    const draft = await session.prepare(source, input, () => setPendingSelected([]));
    if (source !== 'local' || !draft?.pendingIds.length || !session.isMounted()) return;
    const chosenIds = draft.pendingIds.slice(0, remaining);
    await acceptDraft(draft, chosenIds, draft.pendingIds.length - chosenIds.length);
  }
  async function finish(draft: CurationDraft, keepIds: string[], chosenIds: string[], skippedForLimit: number) {
    const kept = new Set(keepIds);
    const added = chosenIds.filter((id) => kept.has(id));
    const snapshot = await session.commit(draft.id, keepIds);
    if (!session.isMounted()) return;
    if (!snapshot) { setReview(null); setPendingSelected([]); return; }
    if (source === 'local' && (draft.failures.length || skippedForLimit)) {
      const description = draft.failures.map(({ path, message }) => `${path} · ${message}`);
      if (skippedForLimit) description.unshift(t(`另有 ${skippedForLimit} 张超出当前选片上限。`, `Photos skipped because of the selection limit: ${skippedForLimit}.`));
      toast({
        title: t(`已导入 ${added.length} 张照片${draft.failures.length ? ` · ${draft.failures.length} 个项目未能导入` : ''}`, `Imported ${added.length} ${added.length === 1 ? 'photo' : 'photos'}${draft.failures.length ? ` · Failed: ${draft.failures.length}` : ''}`),
        description: description.join('\n'),
        status: draft.failures.length ? 'error' : 'info',
        ...(draft.failures.length ? { duration: null } : {}),
      });
    }
    onConfirm({ photoIds: [...selected, ...added], snapshot });
  }
  async function acceptDraft(draft: CurationDraft, chosenIds: string[], skippedForLimit = 0) {
    const keepIds = [...draft.activeIds, ...chosenIds];
    if (draft.capacity !== null && keepIds.length > draft.capacity) {
      const chosen = new Set(chosenIds);
      const candidates = new Set(keepIds);
      setReview({ chosenIds, skippedForLimit, draft: { ...draft,
        pendingIds: draft.pendingIds.filter((id) => chosen.has(id)),
        candidates: draft.candidates.filter((photo) => candidates.has(photo.id)) } });
      return;
    }
    await finish(draft, keepIds, chosenIds, skippedForLimit);
  }
  function confirm() {
    if (source === 'library') { onConfirm({ photoIds: selected }); return; }
    const draft = session.draft;
    if (!draft || !pendingSelected.length || overLimit || session.busy) return;
    void acceptDraft(draft, pendingSelected);
  }
  async function cancelReview() {
    if (await session.clear(true) && session.isMounted()) {
      setReview(null);
      setPendingSelected([]);
    }
  }

  if (review) return <CurationWorkspace draft={review.draft}
    onCommit={(keepIds) => finish(review.draft, keepIds, review.chosenIds, review.skippedForLimit)} onCancel={cancelReview} />;
  return <Modal title={title} onClose={() => void close()} closeDisabled={session.committing || session.cleaning} wide glass>
    <div className="photo-picker photo-source">
      <div className="photo-source-tabs segmented" role="group" aria-label={t('照片来源', 'Photo source')}>
        {([...(allowLibrary ? [['library', t('图库', 'Library')]] as const : []), ['local', t('本地', 'Local')], ['link', t('链接', 'Link')]] as const).map(([value, label]) =>
          <button key={value} type="button" className={source === value ? 'active' : ''} aria-pressed={source === value}
            disabled={session.committing || session.cleaning} onClick={() => void changeSource(value)}>{label}</button>)}
      </div>
      {source === 'library' ? <PhotoLibraryPicker snapshot={snapshot} selectedIds={selected} onChange={setSelected} maxSelection={maxSelection} disabled={session.busy} actions={<>
        <button type="button" className="button" disabled={session.committing || session.cleaning} onClick={() => void close()}>{t('取消', 'Cancel')}</button>
        <button type="button" className="button button-primary" disabled={session.busy || overLimit} onClick={confirm}>{t('确认选择', 'Confirm Selection')}</button>
      </>} /> : <>
        {source === 'link' && <div className="photo-source-input">
          <div className="search-field"><Link2 size={16} /><input autoFocus aria-label={t('小红书或 Instagram 链接', 'Xiaohongshu or Instagram link')}
            aria-describedby={showLinkProgress ? undefined : linkHintId} placeholder={t('粘贴链接', 'Paste a link')}
            value={input} disabled={session.busy} onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!session.busy && input.trim()) void prepare(); } }} /></div>
          <button type="button" className="button" disabled={session.busy || !input.trim()} onClick={() => void prepare()}>{t('获取图片', 'Get Photos')}</button>
        </div>}
        {source === 'link' && <div className="photo-source-link-meta">{showLinkProgress
          ? <LinkImportProgress total={session.linkProgress ? session.linkProgress.total : pendingPhotos.length}
            ready={session.linkProgress?.photos.length ?? pendingPhotos.length} onStop={session.linkProgress ? () => void session.clear() : undefined} />
          : <p id={linkHintId} className="muted photo-source-link-hint">{t('仅支持单篇小红书笔记或 Instagram 帖子的链接。', 'Use a link to a single Xiaohongshu or Instagram post.')}</p>}</div>}
        {session.cleaning || (source === 'local' && (session.preparing || session.committing)) ? <div className="photo-source-wait">
          <Busy label={session.cleaning ? t('正在取消…', 'Canceling…') : session.committing ? t('正在导入照片…', 'Importing photos…') : t('正在准备照片…', 'Preparing photos…')} />
          {session.preparing && <button type="button" className="button" onClick={() => void session.clear()}>{t('取消', 'Cancel')}</button>}</div>
          : source === 'local' ? <div className="photo-source-empty">
            <button type="button" className="button" disabled={session.busy || remaining === 0} onClick={() => void prepare()}>
              <Files size={15} aria-hidden="true" />{t('选择照片或文件夹', 'Choose Photos or a Folder')}</button>
            {remaining === 0 && <p className="muted photo-source-limit" role="status">{t(`已达 ${maxSelection} 张上限`, `Selection limit reached (${maxSelection})`)}</p>}
          </div>
          : session.draft || session.linkProgress ? <PhotoSourceGrid
            photos={session.linkProgress?.photos ?? pendingPhotos} selectedIds={[...selected, ...pendingSelected]} totalSelected={totalSelected}
            maxSelection={maxSelection} disabled={session.committing} previewOnly={session.linkProgress !== null}
            loadingNext={loadingNextPhoto} onToggle={togglePending} emptyTitle={t('没有可选择的照片', 'No photos to select')} />
            : <div className="photo-source-empty"><EmptyState title={t('从链接获取照片', 'Get Photos from a Link')} /></div>}
        {!!session.draft?.failures.length && <div className="photo-source-failures" role="alert">
          <strong>{source === 'local'
            ? t(`${session.draft.failures.length} 个项目未能导入`, `Items that could not be imported: ${session.draft.failures.length}`)
            : t(`${session.draft.failures.length} 张照片未能读取`, `Photos that could not be read: ${session.draft.failures.length}`)}</strong>
          <ul>{session.draft.failures.map((failure, index) => <li key={`${index}-${failure.path}`}>{failure.path} · {failure.message}</li>)}</ul></div>}
      </>}
      {session.error && <p className="form-error photo-source-error" role="alert">{session.error}</p>}
      {source === 'link' && <div className="photo-picker-footer">
        <PhotoSelectionControls photos={pendingPhotos} selectedIds={[...selected, ...pendingSelected]}
          maxSelection={maxSelection} disabled={session.busy} onSelect={(ids) => setPendingSelected((current) => [...new Set([...current, ...ids])])}
          onClear={() => { setSelected([]); setPendingSelected([]); }} />
        <div className="form-actions"><button type="button" className="button" disabled={session.committing || session.cleaning} onClick={() => void close()}>{t('取消', 'Cancel')}</button>
          <button type="button" className="button button-primary" disabled={session.busy || overLimit || !pendingSelected.length} onClick={confirm}>
            {session.committing ? t('正在导入…', 'Importing…') : t('确认导入', 'Import')}</button></div>
      </div>}
    </div>
  </Modal>;
}
