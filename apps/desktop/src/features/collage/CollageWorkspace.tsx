import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowLeft, Redo2, Undo2 } from 'lucide-react';
import { IconButton, Modal } from '../../components/ui';
import { PhotoPicker } from '../../components/PhotoPicker';
import type { LibraryKind, LibrarySnapshot, Photo } from '../../lib/types';
import { isLocalPhoto } from '../../lib/photo-availability';
import { exportCollagePng } from '../../lib/collage-api';
import { selectExportDirectory } from '../../lib/export-directory';
import { collageLayout, collageReferenceLayout, collageOutputProblem, collageProblem, cropFor, initialCollage, recordHistory, redoHistory, undoHistory, resizeCollage, type CollageState, type History, type PhotoCrop } from './collage-layout';
import { CollagePreview } from './CollagePreview';
import { CollageSequence } from './CollageSequence';
import { CollageTools } from './CollageTools';
import { CollageExportDialog } from './CollageExportDialog';
import './collage.css';

export function CollageWorkspace({ snapshot, library, initialPhotoIds, onExit, onExported, onDirtyChange, onBusyChange, onRelink }: {
  snapshot: LibrarySnapshot; library: LibraryKind; initialPhotoIds: string[];
  onExit: () => void; onExported: (path: string) => void;
  onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
  onRelink: (photo: Photo) => Promise<void>;
}) {
  const [history, setHistory] = useState<History<CollageState>>(() => ({ past: [], present: initialCollage(initialPhotoIds), future: [] }));
  const [transient, setTransient] = useState<CollageState | null>(null);
  const state = transient || history.present;
  const stateRef = useRef(state); stateRef.current = state;
  const [activeId, setActiveId] = useState<string | null>(initialPhotoIds[0] || null);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState<'directory' | 'export' | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const [height, setHeight] = useState<number>();
  const workspace = useRef<HTMLElement>(null);
  const photos = useMemo(() => snapshot.photos.filter((photo) => photo.library === library), [snapshot.photos, library]);
  const missingManaged = photos.find((photo) => state.photoIds.includes(photo.id) && !photo.originalAvailable && !isLocalPhoto(photo));
  const layout = useMemo(() => collageLayout(state, photos), [state, photos]);
  const previewLayout = useMemo(() => collageReferenceLayout(state, photos), [state, photos]);
  const problem = collageProblem(state, photos, layout);
  const blocked = !!busy;
  useEffect(() => {
    onDirtyChange?.(true);
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);
  useEffect(() => { onBusyChange?.(blocked); return () => onBusyChange?.(false); }, [blocked, onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useLayoutEffect(() => {
    const element = workspace.current, main = element?.closest('main'); if (!element || !main) return;
    const measure = () => {
      const origin = element.getBoundingClientRect().top + main.scrollTop;
      setHeight(Math.max(460, main.getBoundingClientRect().bottom - origin - (parseFloat(getComputedStyle(main).paddingBottom) || 0)));
    };
    const observer = new ResizeObserver(measure); observer.observe(main); measure();
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => {
    if (activeId && !state.photoIds.includes(activeId)) { setActiveId(state.photoIds[0] || null); setEditing(false); }
  }, [state.photoIds, activeId]);
  function update(next: CollageState, commit = true) {
    if (commit) { setHistory((current) => recordHistory(current, next)); setTransient(null); }
    else setTransient(next);
  }
  function undo() { setTransient(null); setHistory(undoHistory); setEditing(false); }
  function redo() { setTransient(null); setHistory(redoHistory); setEditing(false); }
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (blocked || document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable=true]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (event.key === 'Escape') { event.preventDefault(); if (editing) setEditing(false); else setLeaving(true); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [blocked, editing]);
  function changeCrop(id: string, crop: PhotoCrop, commit: boolean) {
    const current = stateRef.current;
    update({ ...current, crops: { ...current.crops, [id]: crop } }, commit);
  }
  function editPhoto(id: string) {
    setActiveId(id);
    if (state.mode !== 'grid') return;
    if (cropFor(state, id).fit === 'contain') update({ ...state, crops: { ...state.crops, [id]: { fit: 'cover', zoom: 1, offsetX: .5, offsetY: .5 } } });
    setEditing(true);
  }
  async function exportImage(title: string, longEdge: number) {
    if (busyRef.current) return;
    const output = resizeCollage(layout, longEdge);
    const sizeProblem = !Number.isInteger(longEdge) || longEdge < 1 ? '请输入有效像素尺寸' : collageOutputProblem(output);
    if (problem || sizeProblem) { setError(problem || sizeProblem); return; }
    busyRef.current = true;
    // Dismiss the WebView modal before presenting the native folder panel.
    flushSync(() => { setBusy('directory'); setError(''); });
    try {
      const directory = await selectExportDirectory('选择拼图导出目录');
      if (!directory || !mounted.current) return;
      setBusy('export');
      const path = await exportCollagePng(directory, { library, title, width: output.width, height: output.height, background: state.background, items: output.items.map((item) => ({ ...item, ...cropFor(state, item.photoId) })) });
      if (mounted.current) onExported(path);
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  return <section ref={workspace} className="collage-workspace" style={{ height }} aria-label="拼图工作台" aria-busy={blocked}>
    <header className="collage-workspace-header"><div><IconButton label="返回相簿" disabled={blocked} onClick={() => setLeaving(true)}><ArrowLeft size={17} /></IconButton><h1>拼图</h1></div><div className="collage-header-actions"><IconButton label="撤销 · ⌘Z / Ctrl Z" disabled={blocked || !history.past.length} onClick={undo}><Undo2 size={16} /></IconButton><IconButton label="重做 · ⇧⌘Z / Ctrl Shift Z" disabled={blocked || !history.future.length} onClick={redo}><Redo2 size={16} /></IconButton><button type="button" className="button button-primary" disabled={blocked || !!problem} onClick={() => { setExporting(true); setEditing(false); setError(''); }}>导出 PNG</button></div></header>
    <div className="collage-editor-layout"><div className="collage-preview-region">
      <CollagePreview state={state} layout={previewLayout} photos={photos} activeId={activeId} editing={editing} disabled={blocked} onSelect={(id) => { if (id !== activeId) setEditing(false); setActiveId(id); }} onEdit={editPhoto} onCrop={changeCrop} onSwap={(first, second) => { const photoIds = [...state.photoIds]; const a = photoIds.indexOf(first), b = photoIds.indexOf(second); if (a < 0 || b < 0) return; [photoIds[a], photoIds[b]] = [photoIds[b], photoIds[a]]; update({ ...state, photoIds }); setActiveId(first); }} />
      <div className="collage-preview-meta"><span>{problem || `${layout.width.toLocaleString()} × ${layout.height.toLocaleString()} px`}</span>{missingManaged && <button type="button" className="text-button" disabled={blocked} onClick={() => void onRelink(missingManaged).catch((cause) => setError(message(cause)))}>重新定位</button>}</div>
      <CollageSequence ids={state.photoIds} photos={photos} activeId={activeId} disabled={blocked} onActive={(id) => { setActiveId(id); setEditing(false); }} onChange={(photoIds) => update({ ...state, photoIds })} onPick={() => setPicking(true)} />
    </div><CollageTools state={state} activeId={activeId} editing={editing} disabled={blocked} onChange={update} onEditing={setEditing} /></div>
    {error && !exporting && <p className="form-error" role="alert">{error}</p>}
    {picking && <PhotoPicker title="拼图选片" photos={photos} selectedIds={state.photoIds} onConfirm={(photoIds) => { update({ ...state, photoIds }); setPicking(false); }} onClose={() => setPicking(false)} />}
    {exporting && <CollageExportDialog layout={layout} busy={busy} error={error} onClose={() => { setExporting(false); setError(''); }} onExport={exportImage} />}
    {leaving && <Modal title="放弃拼图并返回？" onClose={() => setLeaving(false)}><p className="replacement-copy">拼图尚未导出，返回将放弃当前编辑。</p><div className="form-actions"><button type="button" className="button" autoFocus onClick={() => setLeaving(false)}>继续编辑</button><button type="button" className="button" onClick={onExit}>放弃并返回</button></div></Modal>}
  </section>;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
