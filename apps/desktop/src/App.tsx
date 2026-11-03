import { useEffect, useRef, useState } from 'react';
import { Search, Settings2 } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as api from './lib/api';
import type { LibraryKind, LibrarySnapshot, Photo } from './lib/types';
import { Busy, EmptyState, Modal } from './components/ui';
import { useToast } from './components/ToastProvider';
import { PrimaryNavigation } from './components/PrimaryNavigation';
import { LibraryWorkspace } from './features/LibraryWorkspace';
import { BookWorkspace } from './features/books/BookWorkspace';
import { ModelWorkspace } from './features/models/ModelWorkspace';
import { PlanningWorkspace } from './features/planning/PlanningWorkspace';
import { SettingsWorkspace } from './features/SettingsWorkspace';
import { AiAnalysisPanel } from './features/AiAnalysisPanel';
import { PhotoPlayer } from './features/PhotoPlayer';
import { usePhotoAnalyses } from './features/usePhotoAnalyses';

type Space = LibraryKind | 'books' | 'models' | 'planning' | 'search' | 'settings';
const spaces: { id: Space; label: string }[] = [{ id: 'collection', label: '收藏' }, { id: 'work', label: '作品' }, { id: 'books', label: '画册' }, { id: 'models', label: '模特' }, { id: 'planning', label: '策划' }, { id: 'search', label: '搜索' }, { id: 'settings', label: '设置' }];
const navigationSpaces = spaces.filter((item) => item.id !== 'search' && item.id !== 'settings');
const empty: LibrarySnapshot = { photos: [], groups: [], memberships: [] };

export default function App() {
  const mainRef = useRef<HTMLElement>(null);
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>(empty);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const [space, setSpace] = useState<Space>('collection');
  const [relinkBusy, setRelinkBusy] = useState(false);
  const [relinkConfirmation, setRelinkConfirmation] = useState<{ path: string; resolve: (confirmed: boolean) => void } | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [playingIds, setPlayingIds] = useState<string[] | null>(null);
  const [bookDirty, setBookDirty] = useState(false);
  const [modelDirty, setModelDirty] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [planningDirty, setPlanningDirty] = useState(false);
  const [planningBusy, setPlanningBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoDirty, setPhotoDirty] = useState(false);
  const [pendingSpace, setPendingSpace] = useState<Space | null>(null);
  const [pendingClose, setPendingClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeState = useRef({ dirty: false, busy: false });
  closeState.current = { dirty: bookDirty || photoDirty || modelDirty || planningDirty, busy: modelBusy || photoBusy || planningBusy || settingsBusy || relinkBusy };
  const analysis = usePhotoAnalyses(ready, libraryRevision);
  async function reload() {
    setLoading(true); setError('');
    if (!api.isDesktop()) { setLoading(false); return; }
    try { setSnapshot(await api.loadSnapshot()); setReady(true); }
    catch (cause) { setError(message(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    if (!api.isDesktop()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      if (!closeState.current.dirty && !closeState.current.busy) return;
      event.preventDefault();
      if (closeState.current.busy) { toast({ title: '正在处理，请完成后再关闭窗口', status: 'info' }); return; }
      setPendingClose(true);
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch((cause) => { if (!disposed) setError(`关闭保护无法启用：${message(cause)}`); });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  async function discardAndClose() {
    if (closeState.current.busy || closing) return;
    setClosing(true);
    try { await getCurrentWindow().destroy(); }
    catch (cause) { setError(`关闭窗口失败：${message(cause)}`); setPendingClose(false); setClosing(false); }
  }
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) { event.preventDefault(); navigate('search'); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [bookDirty, photoDirty, modelDirty, planningDirty, modelBusy, photoBusy, planningBusy, settingsBusy, space]);
  function navigate(next: Space) { if (modelBusy || photoBusy || planningBusy || settingsBusy) { feedback('正在处理，请完成后再切换工作区'); return; } if ((bookDirty || photoDirty || modelDirty || planningDirty) && (next !== space || next === 'collection' || next === 'work')) { setPendingSpace(next); return; } changeSpace(next); }
  function changeSpace(next: Space) { setSpace(next); if (mainRef.current) mainRef.current.scrollTop = 0; if (next === 'collection' || next === 'work') setNavigationRevision((revision) => revision + 1); setError(''); setPendingSpace(null); }
  function feedback(text: string, failure = false) { toast({ title: text, status: failure ? 'error' : 'success' }); }
  async function relinkPhoto(photo: Photo) {
    setRelinkBusy(true); setError('');
    try {
      const next = await api.relinkPhoto(photo.id, (path) => new Promise<boolean>((resolve) => setRelinkConfirmation({ path, resolve })));
      if (!next) return;
      setSnapshot(next); await analysis.reload(); toast({ title: '已重新定位照片，相簿与标注已保留' });
    } catch (cause) { throw cause; }
    finally { setRelinkBusy(false); }
  }
  function confirmRelink(confirmed: boolean) { relinkConfirmation?.resolve(confirmed); setRelinkConfirmation(null); }
  function openPlayer(ids: string[]) { const actual = ids.filter((id) => snapshot.photos.some((photo) => photo.id === id)); if (actual.length) setPlayingIds(actual); else feedback('没有可欣赏的照片', true); }
  function libraryChanged(next: LibrarySnapshot) { setPlayingIds(null); setSnapshot(next); setLibraryRevision((revision) => revision + 1); setBookDirty(false); setPhotoDirty(false); setPhotoBusy(false); setModelDirty(false); setModelBusy(false); setPlanningDirty(false); setPlanningBusy(false); setPendingSpace(null); setError(''); toast({ title: '已切换图库' }); }
  return <div className={`app-shell ${space === 'collection' || space === 'work' || space === 'search' ? 'gallery-shell' : ''}`} aria-busy={relinkBusy || loading || modelBusy || photoBusy || planningBusy || settingsBusy}>
    <header className="app-header" data-tauri-drag-region>
      <div className="header-left">
        <span className="wordmark">Foliune<span>.</span></span>
      </div>
      <PrimaryNavigation items={navigationSpaces} value={space} onChange={navigate} />
      <nav className="header-actions" aria-label="工具">
        <button type="button" className={`icon-button ${space === 'search' ? 'is-active' : ''}`} aria-label="搜索 · ⌘K / Ctrl K" title="搜索 · ⌘K / Ctrl K" aria-current={space === 'search' ? 'page' : undefined} onClick={() => navigate('search')}><Search size={19} /></button>
        <button type="button" className={`icon-button ${space === 'settings' ? 'is-active' : ''}`} aria-label="设置" title="设置" aria-current={space === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}><Settings2 size={18} /></button>
      </nav>
    </header>
    {!api.isDesktop() && <div className="desktop-hint">当前为浏览器预览 · 请在 Foliune 桌面应用中导入和管理本地照片</div>}
    {error && <div className="recovery-banner" role="alert"><span>{error}</span>{!ready && api.isDesktop() && <button type="button" onClick={() => void reload()}>重新读取</button>}</div>}
    {analysis.error && ready && <div className="recovery-banner" role="alert"><span>AI 分析记录读取失败：{analysis.error}</span><button type="button" onClick={() => void analysis.reload()}>重试</button></div>}
    <main ref={mainRef}>{loading ? <Busy /> : !ready ? <><section className="workspace-intro"><div><h1>{spaces.find((item) => item.id === space)?.label}</h1></div></section><EmptyState title={api.isDesktop() ? '暂时无法读取图库' : '请在桌面应用中使用'} description={api.isDesktop() ? '读取失败，请检查提示后重试。现有照片未作更改。' : '浏览器仅预览界面。本地照片、存储与编辑需在 Foliune 桌面应用中使用。'} action={api.isDesktop() ? <button type="button" className="button" onClick={() => void reload()}>重新读取</button> : undefined} /></> : space === 'collection' || space === 'work' || space === 'search' ? <LibraryWorkspace key={`${space}:${libraryRevision}:${navigationRevision}`} space={space} snapshot={snapshot} onSnapshot={setSnapshot} onFeedback={feedback} importDisabled={relinkBusy} onRelink={relinkPhoto} onPlay={openPlayer} onDirtyChange={setPhotoDirty} onBusyChange={setPhotoBusy} detailExtension={(photo) => <AiAnalysisPanel key={`${photo.id}:${photo.thumbnailPath}`} photo={photo} analyses={analysis.analyses} onAnalysis={analysis.record} onSettings={() => navigate('settings')} />} extraSearchText={(photo) => analysis.analyses.filter((item) => item.photoId === photo.id).map((item) => item.text).join(' ')} /> : space === 'books' ? <BookWorkspace key={libraryRevision} photos={snapshot.photos} onPlay={openPlayer} onDirtyChange={setBookDirty} onRelink={relinkPhoto} /> : space === 'models' ? <ModelWorkspace key={libraryRevision} photos={snapshot.photos} onSnapshot={setSnapshot} onDirtyChange={setModelDirty} onBusyChange={setModelBusy} onRelink={relinkPhoto} /> : space === 'planning' ? <PlanningWorkspace key={libraryRevision} photos={snapshot.photos} onDirtyChange={setPlanningDirty} onBusyChange={setPlanningBusy} /> : <SettingsWorkspace snapshot={snapshot} onLibraryChanged={libraryChanged} onBusyChange={setSettingsBusy} />}</main>
    {relinkConfirmation && <Modal title="确认替换照片" onClose={() => confirmRelink(false)}><p className="replacement-copy">将用所选文件替换此照片；所有相簿和画册中的引用都会使用该文件</p><p className="replacement-path">{relinkConfirmation.path}</p><div className="form-actions"><button type="button" className="button" autoFocus onClick={() => confirmRelink(false)}>取消</button><button type="button" className="button button-primary" onClick={() => confirmRelink(true)}>确认替换</button></div></Modal>}
    {pendingClose && <Modal title="放弃修改并关闭窗口？" onClose={() => { if (!closing) setPendingClose(false); }}><p className="replacement-copy">当前修改尚未保存，关闭窗口将放弃这些修改。</p><div className="form-actions"><button type="button" className="button" autoFocus disabled={closing} onClick={() => setPendingClose(false)}>继续编辑</button><button type="button" className="button" disabled={closing || modelBusy || photoBusy || planningBusy || settingsBusy || relinkBusy} onClick={() => void discardAndClose()}>{closing ? '正在关闭…' : '放弃并关闭'}</button></div></Modal>}
    {pendingSpace && <Modal title="离开未保存的修改？" onClose={() => setPendingSpace(null)}><p className="replacement-copy">当前修改尚未保存。离开将放弃这些修改。</p><div className="form-actions"><button type="button" className="button" autoFocus onClick={() => setPendingSpace(null)}>继续编辑</button><button type="button" className="button" disabled={modelBusy || photoBusy || planningBusy || settingsBusy} onClick={() => { if (modelBusy || photoBusy || planningBusy || settingsBusy) return; const next = pendingSpace; setBookDirty(false); setPhotoDirty(false); setModelDirty(false); setPlanningDirty(false); changeSpace(next); }}>放弃并离开</button></div></Modal>}
    {playingIds && <PhotoPlayer photos={snapshot.photos} photoIds={playingIds} onClose={() => setPlayingIds(null)} onRelink={relinkPhoto} onFeedback={feedback} />}
  </div>;
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
