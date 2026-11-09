import { useId, useMemo, useState } from 'react';
import { Files, FolderOpen, Link2 } from 'lucide-react';
import type { LibraryKind, LibrarySnapshot, Photo } from '../lib/types';
import type { CurationDraft } from '../lib/curation-types';
import { CurationWorkspace } from '../features/CurationWorkspace';
import { Busy, EmptyState, Modal } from './ui';
import { DropdownMenu } from './DropdownMenu';
import { PhotoLibraryPicker } from './PhotoPicker';
import { PhotoSelectionControls } from './PhotoSelectionControls';
import { PhotoSourceGrid } from './PhotoSourceGrid';
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
  const text = total === null ? '正在读取帖子…' : `已获取 ${ready} / ${total} 张`;
  return <>
    <div className="photo-source-progress" role="progressbar" aria-label={total === null ? text : '链接图片获取进度'}
      aria-valuemin={total === null ? undefined : 0} aria-valuemax={total ?? undefined}
      aria-valuenow={total === null ? undefined : ready} aria-valuetext={total === null ? undefined : text}>
      <span className="photo-source-progress-track" aria-hidden="true"><span style={total === null ? undefined : { width: `${ready / total * 100}%` }} /></span>
      <span>{text}</span>
    </div>
    {onStop && <button type="button" className="text-button" onClick={onStop}>停止获取</button>}
  </>;
}

export function PhotoSourceDialog({ snapshot, selectedIds = [], library, groupId, allowLibrary = true,
  maxSelection, title = '选择照片', onConfirm, onClose, onBusyChange }: PhotoSourceDialogProps) {
  const [source, setSource] = useState<Source>(allowLibrary ? 'library' : 'local');
  const [selected, setSelected] = useState(() => allowLibrary ? [...new Set(selectedIds)] : []);
  const [pendingSelected, setPendingSelected] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [reviewDraft, setReviewDraft] = useState<CurationDraft | null>(null);
  const linkHintId = useId();
  const session = usePhotoSourceImport({ library, groupId, onBusyChange });
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

  function toggle(id: string, pending: boolean) {
    const update = pending ? setPendingSelected : setSelected;
    update((ids) => ids.includes(id) ? ids.filter((item) => item !== id)
      : maxSelection !== undefined && totalSelected >= maxSelection ? ids : [...ids, id]);
  }
  function addSelection(ids: string[]) {
    const update = source === 'library' ? setSelected : setPendingSelected;
    update((current) => [...new Set([...current, ...ids])]);
  }
  async function close() {
    if (await session.clear() && session.isMounted()) onClose();
  }
  async function changeSource(next: Source) {
    if (source === next || session.committing || session.cleaning) return;
    if (await session.clear() && session.isMounted()) {
      setPendingSelected([]);
      setReviewDraft(null);
      setSource(next);
    }
  }
  async function prepare(directory = false) {
    if (source === 'library' || session.busy) return;
    setPendingSelected([]);
    const draft = await session.prepare(source === 'local' && directory ? 'folder' : source, input);
    if (source === 'local' && draft && session.isMounted()) {
      const available = maxSelection === undefined
        ? draft.pendingIds.length
        : Math.max(0, maxSelection - selected.length);
      setPendingSelected(draft.pendingIds.slice(0, available));
    }
  }
  async function finish(keepIds: string[], draft: CurationDraft) {
    const pending = new Set(draft.pendingIds);
    const kept = new Set(keepIds);
    const added = pendingSelected.filter((id) => pending.has(id) && kept.has(id));
    const snapshot = await session.commit(keepIds);
    if (!session.isMounted()) return;
    if (snapshot) onConfirm({ photoIds: [...selected, ...added], snapshot });
    else { setReviewDraft(null); setPendingSelected([]); }
  }
  function confirm() {
    if (source === 'library') { onConfirm({ photoIds: selected }); return; }
    const draft = session.draft;
    if (!draft || !pendingSelected.length || overLimit || session.busy) return;
    const chosen = new Set(pendingSelected);
    const keepIds = [...draft.activeIds, ...pendingSelected];
    if (draft.capacity !== null && keepIds.length > draft.capacity) {
      // The existing curation UI starts with all candidates kept. Only pass the
      // explicitly selected new candidates, while retaining every active photo.
      setReviewDraft({ ...draft, pendingIds: draft.pendingIds.filter((id) => chosen.has(id)),
        candidates: draft.candidates.filter((photo) => draft.activeIds.includes(photo.id) || chosen.has(photo.id)) });
    } else void finish(keepIds, draft);
  }
  async function cancelReview() {
    if (await session.clear(true) && session.isMounted()) {
      setReviewDraft(null);
      setPendingSelected([]);
    }
  }

  if (reviewDraft) return <CurationWorkspace draft={reviewDraft} onCommit={(keepIds) => finish(keepIds, reviewDraft)} onCancel={cancelReview} />;
  return <Modal title={title} onClose={() => { if (!session.committing && !session.cleaning) void close(); }} wide>
    <div className="photo-picker photo-source">
      <div className="photo-source-tabs segmented" role="group" aria-label="照片来源">
        {([...(allowLibrary ? [['library', '图库']] as const : []), ['local', '本地'], ['link', '链接']] as const).map(([value, label]) =>
          <button key={value} type="button" className={source === value ? 'active' : ''} aria-pressed={source === value}
            disabled={session.committing || session.cleaning} onClick={() => void changeSource(value)}>{label}</button>)}
      </div>
      {source === 'library' ? <PhotoLibraryPicker snapshot={snapshot} selectedIds={selected} onChange={setSelected} maxSelection={maxSelection} disabled={session.busy} actions={<>
        <button type="button" className="button" disabled={session.committing || session.cleaning} onClick={() => void close()}>取消</button>
        <button type="button" className="button button-primary" disabled={session.busy || overLimit} onClick={confirm}>确认选择</button>
      </>} /> : <>
        <div className="photo-source-input">
          {source === 'link' && <div className="search-field"><Link2 size={16} /><input autoFocus aria-label="小红书或 Instagram 链接"
            aria-describedby={showLinkProgress ? undefined : linkHintId} placeholder="粘贴链接"
            value={input} disabled={session.busy} onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!session.busy && input.trim()) void prepare(); } }} /></div>}
          {source === 'local' ? <DropdownMenu label="选择本地文件" triggerText="选择本地文件"
            icon={<Files size={15} aria-hidden="true" />} disabled={session.busy} groups={[{ items: [
              { id: 'photos', label: '选择照片', icon: <Files size={15} aria-hidden="true" />, run: () => void prepare() },
              { id: 'folder', label: '选择文件夹', icon: <FolderOpen size={15} aria-hidden="true" />, run: () => void prepare(true) },
            ] }]} /> : <button type="button" className="button" disabled={session.busy || !input.trim()}
              onClick={() => void prepare()}>获取图片</button>}
        </div>
        {source === 'link' && <div className="photo-source-link-meta">{showLinkProgress
          ? <LinkImportProgress total={session.linkProgress ? session.linkProgress.total : pendingPhotos.length}
            ready={session.linkProgress?.photos.length ?? pendingPhotos.length} onStop={session.linkProgress ? () => void session.clear() : undefined} />
          : <p id={linkHintId} className="muted photo-source-link-hint">仅支持单篇小红书笔记或 Instagram 帖子的链接。</p>}</div>}
        {session.cleaning || (source === 'local' && session.preparing) ? <div className="photo-source-wait"><Busy label={session.cleaning ? '正在取消…' : '正在准备照片…'} />
          {!session.cleaning && <button type="button" className="button" onClick={() => void session.clear()}>取消</button>}</div>
          : session.draft || session.linkProgress ? <PhotoSourceGrid key={source === 'link' ? 'link' : session.draft?.id}
            photos={session.linkProgress?.photos ?? pendingPhotos} selectedIds={[...selected, ...pendingSelected]} totalSelected={totalSelected}
            maxSelection={maxSelection} disabled={session.committing} previewOnly={session.linkProgress !== null} preservePosition={source === 'link'}
            loadingNext={loadingNextPhoto} onToggle={(id) => toggle(id, true)} emptyTitle="没有可选择的照片" />
            : <div className="photo-source-empty"><EmptyState title={source === 'local' ? '选择要导入的照片' : '从链接获取照片'} /></div>}
        {!!session.draft?.failures.length && <div className="photo-source-failures" role="alert"><strong>{session.draft.failures.length} 张照片未能读取</strong>
          <ul>{session.draft.failures.map((failure, index) => <li key={`${index}-${failure.path}`}>{failure.path} · {failure.message}</li>)}</ul></div>}
      </>}
      {session.error && <p className="form-error photo-source-error" role="alert">{session.error}</p>}
      {source !== 'library' && <div className="photo-picker-footer">
        <PhotoSelectionControls photos={pendingPhotos} selectedIds={[...selected, ...pendingSelected]}
          maxSelection={maxSelection} disabled={session.busy} onSelect={addSelection}
          onClear={() => { setSelected([]); setPendingSelected([]); }} />
        <div className="form-actions"><button type="button" className="button" disabled={session.committing || session.cleaning} onClick={() => void close()}>取消</button>
          <button type="button" className="button button-primary" disabled={session.busy || overLimit || !pendingSelected.length} onClick={confirm}>
            {session.committing ? '正在导入…' : '确认导入'}</button></div>
      </div>}
    </div>
  </Modal>;
}
