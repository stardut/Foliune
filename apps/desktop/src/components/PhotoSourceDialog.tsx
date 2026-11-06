import { useId, useMemo, useState } from 'react';
import { FolderOpen, Link2, Search, X } from 'lucide-react';
import type { LibraryKind, LibrarySnapshot, Photo } from '../lib/types';
import type { CurationDraft } from '../lib/curation-types';
import { CurationWorkspace } from '../features/CurationWorkspace';
import { Busy, EmptyState, IconButton, Modal } from './ui';
import { PhotoSourceGrid } from './PhotoSourceGrid';
import { usePhotoSourceImport } from './use-photo-source-import';
import './photo-picker.css';
import './photo-source.css';

export interface PhotoSourceResult { photoIds: string[]; snapshot?: LibrarySnapshot }
export interface PhotoSourceDialogProps {
  photos: Photo[];
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

export function PhotoSourceDialog({ photos, selectedIds = [], library, groupId, allowLibrary = true,
  maxSelection, title = '选择照片', onConfirm, onClose, onBusyChange }: PhotoSourceDialogProps) {
  const [source, setSource] = useState<Source>(allowLibrary ? 'library' : 'local');
  const [selected, setSelected] = useState(() => allowLibrary ? [...new Set(selectedIds)] : []);
  const [pendingSelected, setPendingSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | LibraryKind>('all');
  const [input, setInput] = useState('');
  const [reviewDraft, setReviewDraft] = useState<CurationDraft | null>(null);
  const linkHintId = useId();
  const session = usePhotoSourceImport({ library, groupId, onBusyChange });
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return photos.filter((photo) => (filter === 'all' || photo.library === filter)
      && (!term || [photo.title, photo.originalName, photo.location, photo.project, ...photo.tags].join(' ').toLocaleLowerCase().includes(term)));
  }, [photos, query, filter]);
  const pendingPhotos = useMemo(() => {
    const pending = new Set(session.draft?.pendingIds);
    const byId = new Map(session.draft?.candidates.map((photo) => [photo.id, photo]));
    return [...pending].map((id) => byId.get(id)).filter((photo): photo is Photo => photo !== undefined);
  }, [session.draft]);
  const missing = selected.filter((id) => !photos.some((photo) => photo.id === id));
  const totalSelected = selected.length + pendingSelected.length;
  const overLimit = maxSelection !== undefined && totalSelected > maxSelection;

  function toggle(id: string, pending: boolean) {
    const update = pending ? setPendingSelected : setSelected;
    update((ids) => ids.includes(id) ? ids.filter((item) => item !== id)
      : maxSelection !== undefined && totalSelected >= maxSelection ? ids : [...ids, id]);
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
  async function prepare() {
    if (source === 'library' || session.busy) return;
    setPendingSelected([]);
    await session.prepare(source, input);
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
      {source === 'library' ? <>
        <div className="photo-picker-tools">
          <div className="search-field"><Search size={16} /><input autoFocus aria-label="搜索图库照片" placeholder="搜索照片" value={query}
            onChange={(event) => setQuery(event.target.value)} />{query && <IconButton label="清空搜索" onClick={() => setQuery('')}><X size={14} /></IconButton>}</div>
          <div className="segmented" role="group" aria-label="筛选图库">{([['all', '全部'], ['work', '作品'], ['collection', '收藏']] as const).map(([value, label]) =>
            <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div>
        </div>
        {!!missing.length && <div className="photo-picker-missing" role="status"><span>{missing.length} 张已选照片记录缺失</span>{missing.map((id) =>
          <button type="button" className="text-button" key={id} onClick={() => toggle(id, false)}>移除第 {selected.indexOf(id) + 1} 张<X size={12} /></button>)}</div>}
        <PhotoSourceGrid photos={filtered} selectedIds={selected} totalSelected={totalSelected} maxSelection={maxSelection}
          onToggle={(id) => toggle(id, false)} emptyTitle={photos.length ? '没有找到照片' : '图库还没有照片'} />
      </> : <>
        <div className="photo-source-input">
          {source === 'link' && <div className="search-field"><Link2 size={16} /><input autoFocus aria-label="小红书或 Instagram 链接" aria-describedby={linkHintId} placeholder="粘贴链接"
            value={input} disabled={session.busy} onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!session.busy && input.trim()) void prepare(); } }} /></div>}
          <button type="button" className="button" disabled={session.busy || (source === 'link' && !input.trim())}
            onClick={() => void prepare()}>{source === 'local' ? <><FolderOpen size={15} />{session.draft ? '重新选择照片' : '选择本地照片'}</> : '获取图片'}</button>
        </div>
        {source === 'link' && <p id={linkHintId} className="muted photo-source-link-hint">仅支持单篇小红书笔记或 Instagram 帖子的链接。</p>}
        {session.preparing || session.cleaning ? <div className="photo-source-wait"><Busy label={session.cleaning ? '正在取消…' : source === 'link' ? '正在获取图片…' : '正在准备照片…'} />
          {!session.cleaning && <button type="button" className="button" onClick={() => void session.clear()}>取消</button>}</div>
          : session.draft ? <PhotoSourceGrid key={session.draft.id} photos={pendingPhotos} selectedIds={[...selected, ...pendingSelected]} totalSelected={totalSelected}
            maxSelection={maxSelection} disabled={session.committing} onToggle={(id) => toggle(id, true)} emptyTitle="没有可选择的照片" />
            : <div className="photo-source-empty"><EmptyState title={source === 'local' ? '选择要导入的照片' : '从链接获取照片'} /></div>}
        {!!session.draft?.failures.length && <div className="photo-source-failures" role="alert"><strong>{session.draft.failures.length} 张照片未能读取</strong>
          <ul>{session.draft.failures.map((failure, index) => <li key={`${index}-${failure.path}`}>{failure.path} · {failure.message}</li>)}</ul></div>}
      </>}
      {session.error && <p className="form-error photo-source-error" role="alert">{session.error}</p>}
      <div className="photo-picker-footer"><span role="status">已选 {totalSelected} 张{maxSelection !== undefined ? ` / 最多 ${maxSelection} 张` : ''}</span>
        <button type="button" className="text-button" disabled={!totalSelected || session.busy} onClick={() => { setSelected([]); setPendingSelected([]); }}>清空</button>
        <div className="form-actions"><button type="button" className="button" disabled={session.committing || session.cleaning} onClick={() => void close()}>取消</button>
          <button type="button" className="button button-primary" disabled={session.busy || overLimit || (source !== 'library' && !pendingSelected.length)} onClick={confirm}>
            {session.committing ? '正在导入…' : source === 'library' ? '确认选择' : '确认导入'}</button></div>
      </div>
    </div>
  </Modal>;
}
