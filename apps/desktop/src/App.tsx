import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, Settings2 } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import * as api from './lib/api';
import { getBook } from './lib/book-api';
import type { BookDetail } from './lib/book-types';
import { listModels } from './lib/model-api';
import type { ModelProfile } from './lib/model-types';
import { listPlans } from './lib/planning-api';
import type { ShootPlan } from './lib/planning-types';
import type { LibraryKind, LibrarySnapshot, Photo } from './lib/types';
import { isWorkspaceVisible, readWorkspaceVisibility, saveWorkspaceVisibility, type OptionalWorkspace } from './lib/workspace-visibility';
import { Busy, EmptyState, Modal, WorkspaceHeader } from './components/ui';
import { useToast } from './components/ToastProvider';
import { PrimaryNavigation } from './components/PrimaryNavigation';
import { LibraryWorkspace } from './features/LibraryWorkspace';
import { BookWorkspace } from './features/books/BookWorkspace';
import { ModelWorkspace } from './features/models/ModelWorkspace';
import { PlanningWorkspace } from './features/planning/PlanningWorkspace';
import { SearchWorkspace, type SearchSession } from './features/search/SearchWorkspace';
import { SettingsWorkspace } from './features/SettingsWorkspace';
import { PhotoPlayer } from './features/PhotoPlayer';
import { WorkDirectoryDiscovery } from './features/WorkDirectory';
import { useWorkDirectory } from './features/use-work-directory';
import { mergeWorkDirectoryAvailability, recordDirectoryCommit, replaceLibrarySnapshot, type LibraryView } from './features/work-directory-snapshot';
import type { WorkDirectoryCommit } from './lib/work-directory-api';

type Space = LibraryKind | 'books' | 'models' | 'planning' | 'search' | 'settings';
type SearchDetail = { space: 'books'; book: BookDetail } | { space: 'models'; model: ModelProfile } | { space: 'planning'; plan: ShootPlan };
type SearchTarget = { space: SearchDetail['space']; id: string };
const spaces: { id: Space; label: string }[] = [{ id: 'work', label: '作品' }, { id: 'collection', label: '收藏' }, { id: 'books', label: '画册' }, { id: 'models', label: '模特' }, { id: 'planning', label: '策划' }, { id: 'search', label: '搜索' }, { id: 'settings', label: '设置' }];
const primarySpaces = spaces.filter((item) => item.id !== 'search' && item.id !== 'settings');
const primaryNavigationDurationMs = 360;
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const empty: LibrarySnapshot = { photos: [], groups: [], memberships: [] };
const initialSearchSession: SearchSession = { query: '', category: 'all', scrollTop: 0 };

export default function App() {
  const mainRef = useRef<HTMLElement>(null);
  const [{ snapshot }, setLibraryView] = useState<LibraryView>({ snapshot: empty, pendingCommits: [], observedPhotos: [] });
  const setSnapshot = useCallback((next: LibrarySnapshot) => setLibraryView((view) => replaceLibrarySnapshot(view, next)), []);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const [space, setSpace] = useState<Space>('collection');
  const [workspaceVisibility, setWorkspaceVisibility] = useState(readWorkspaceVisibility);
  const navigationSpaces = useMemo(() => primarySpaces.filter(({ id }) => isWorkspaceVisible(id, workspaceVisibility)), [workspaceVisibility]);
  const previousSpace = useRef(space);
  const searchSession = useRef<SearchSession>({ ...initialSearchSession });
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const [relinkBusy, setRelinkBusy] = useState(false);
  const [relinkConfirmation, setRelinkConfirmation] = useState<{ path: string; resolve: (confirmed: boolean) => void } | null>(null);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [playingIds, setPlayingIds] = useState<string[] | null>(null);
  const [bookDirty, setBookDirty] = useState(false);
  const [bookBusy, setBookBusy] = useState(false);
  const [modelDirty, setModelDirty] = useState(false);
  const [modelBusy, setModelBusy] = useState(false);
  const [planningDirty, setPlanningDirty] = useState(false);
  const [planningBusy, setPlanningBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoDirty, setPhotoDirty] = useState(false);
  const [photoBrowsingIdle, setPhotoBrowsingIdle] = useState(false);
  const [pendingSpace, setPendingSpace] = useState<{ space: Space; target?: SearchTarget } | null>(null);
  const [pendingClose, setPendingClose] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeState = useRef({ dirty: false, busy: false });
  const onDirectorySynced = useCallback((commit: WorkDirectoryCommit) => {
    setLibraryView((view) => recordDirectoryCommit(view, commit));
  }, []);
  const onDirectoryAvailability = useCallback((fresh: LibrarySnapshot) => {
    setLibraryView((view) => {
      const next = mergeWorkDirectoryAvailability(view.snapshot, fresh);
      return next === view.snapshot ? view : { ...view, snapshot: next };
    });
  }, []);
  const workDirectory = useWorkDirectory(ready, onDirectorySynced, onDirectoryAvailability);
  const workspaceDirty = bookDirty || photoDirty || modelDirty || planningDirty;
  const workspaceBusy = bookBusy || modelBusy || photoBusy || planningBusy || settingsBusy || relinkBusy || workDirectory.blocking;
  const discoveryIdle = ready && !loading && (space === 'settings' || (photoBrowsingIdle && (space === 'collection' || space === 'work')))
    && !workspaceDirty && !workspaceBusy && !pendingSpace && !pendingClose && !relinkConfirmation && !playingIds;
  closeState.current = { dirty: workspaceDirty, busy: workspaceBusy };
  async function reload() {
    setLoading(true); setError('');
    if (!api.isDesktop()) { setLoading(false); return; }
    try { setSnapshot(await api.loadSnapshot()); setReady(true); }
    catch (cause) { setError(message(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);
  useLayoutEffect(() => {
    const previous = previousSpace.current;
    if (previous === space) return;
    previousSpace.current = space;
    const main = mainRef.current;
    if (!main || loading) return;

    const motionPreference = window.matchMedia(reducedMotionQuery);
    if (motionPreference.matches) return;

    const from = navigationSpaces.findIndex((item) => item.id === previous);
    const to = navigationSpaces.findIndex((item) => item.id === space);
    const isPrimaryTransition = from >= 0 && to >= 0;
    // Primary workspaces have a single root. Move it within the stationary scrollport.
    const surface = isPrimaryTransition ? (ready ? main.firstElementChild : null) : main;
    if (!surface) return;

    const frames = isPrimaryTransition
      ? [{ transform: `translate3d(${to > from ? 24 : -24}%, 0, 0)` }, { transform: 'translate3d(0, 0, 0)' }]
      : [{ opacity: .65 }, { opacity: 1 }];
    const animation = surface.animate(frames, {
      duration: isPrimaryTransition ? primaryNavigationDurationMs : 240,
      easing: isPrimaryTransition ? 'cubic-bezier(.25, .5, .3, 1)' : 'cubic-bezier(.2, .72, .2, 1)',
      fill: 'backwards',
    });
    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      if (event.matches) animation.cancel();
    };
    motionPreference.addEventListener('change', onMotionPreferenceChange);
    return () => {
      motionPreference.removeEventListener('change', onMotionPreferenceChange);
      animation.cancel();
    };
  }, [space, loading, ready, navigationSpaces]);
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
      // WKWebView can report keyCode 229 without setting isComposing.
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) { event.preventDefault(); openSearch(); }
    };
    window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle);
  }, [workspaceDirty, workspaceBusy, space, searchTarget]);
  function openSearch() {
    if (space === 'search') {
      const input = mainRef.current?.querySelector<HTMLInputElement>('#global-search-input');
      input?.focus({ preventScroll: true });
      input?.scrollIntoView({ block: 'nearest' });
      return;
    }
    navigate('search');
  }
  function navigate(next: Space, target?: SearchTarget) {
    if (workspaceBusy) { feedback('正在处理，请完成后再切换工作区'); return; }
    if (workspaceDirty && (next !== space || searchTarget || next === 'collection' || next === 'work')) { setPendingSpace({ space: next, target }); return; }
    changeSpace(next, target);
  }
  function changeSpace(next: Space, target?: SearchTarget) {
    if (!isWorkspaceVisible(next, workspaceVisibility)) return;
    setSpace(next); setSearchTarget(target ?? null);
    if (mainRef.current) mainRef.current.scrollTop = 0;
    if (next === 'collection' || next === 'work') setNavigationRevision((revision) => revision + 1);
    setError(''); setPendingSpace(null);
  }
  function feedback(text: string, failure = false) { toast({ title: text, status: failure ? 'error' : 'success' }); }
  function changeWorkspaceVisibility(workspace: OptionalWorkspace, visible: boolean) {
    setWorkspaceVisibility((current) => ({ ...current, [workspace]: visible }));
    if (!visible) {
      const session = searchSession.current;
      const categoryHidden = session.category === workspace;
      if (categoryHidden) session.category = 'all';
      if (categoryHidden || session.focusResult?.startsWith(`${workspace}:`)) {
        session.focusResult = undefined;
        session.scrollTop = 0;
      }
    }
    try { saveWorkspaceVisibility(workspace, visible); }
    catch { feedback('无法记住工作区显示设置', true); }
  }
  async function relinkPhoto(photo: Photo) {
    setRelinkBusy(true); setError('');
    try {
      const next = await api.relinkPhoto(photo.id, (path) => new Promise<boolean>((resolve) => setRelinkConfirmation({ path, resolve })));
      if (!next) return;
      setSnapshot(next); toast({ title: '已重新定位照片，相簿与标注已保留' });
    } catch (cause) { throw cause; }
    finally { setRelinkBusy(false); }
  }
  function confirmRelink(confirmed: boolean) { relinkConfirmation?.resolve(confirmed); setRelinkConfirmation(null); }
  function openPlayer(ids: string[]) { const actual = ids.filter((id) => snapshot.photos.some((photo) => photo.id === id)); if (actual.length) setPlayingIds(actual); else feedback('没有可欣赏的照片', true); }
  function returnToSearch() {
    if (relinkBusy) { feedback('正在处理，请完成后再切换工作区'); return; }
    changeSpace('search');
  }
  function renderWorkspace(result?: SearchDetail) {
    const libraryProps = { snapshot, onSnapshot: setSnapshot, onFeedback: feedback, importDisabled: relinkBusy, onRelink: relinkPhoto, onPlay: openPlayer, onDirtyChange: setPhotoDirty, onBusyChange: setPhotoBusy };
    if (space === 'search') return <SearchWorkspace {...libraryProps} session={searchSession.current} workspaceVisibility={workspaceVisibility}
      onOpenBook={(id) => navigate('books', { space: 'books', id })}
      onOpenModel={(model) => navigate('models', { space: 'models', id: model.id })}
      onOpenPlan={(plan) => navigate('planning', { space: 'planning', id: plan.id })} />;
    if (space === 'collection' || space === 'work') return <LibraryWorkspace key={`${space}:${navigationRevision}`} space={space} {...libraryProps}
      onBrowsingIdleChange={setPhotoBrowsingIdle}
      workDirectory={space === 'work' ? workDirectory : undefined}
      onOpenWorkDirectorySettings={space === 'work' ? () => navigate('settings') : undefined} />;
    if (space === 'books') return <BookWorkspace photos={snapshot.photos} onSnapshot={setSnapshot} onPlay={openPlayer} onDirtyChange={setBookDirty} onBusyChange={setBookBusy} onRelink={relinkPhoto}
      initialBook={result?.space === 'books' ? result.book : undefined} onBackToSearch={result ? returnToSearch : undefined} />;
    if (space === 'models') return <ModelWorkspace photos={snapshot.photos} onSnapshot={setSnapshot} onDirtyChange={setModelDirty} onBusyChange={setModelBusy} onRelink={relinkPhoto}
      initialModel={result?.space === 'models' ? result.model : undefined} onBackToSearch={result ? returnToSearch : undefined} />;
    if (space === 'planning') return <PlanningWorkspace photos={snapshot.photos} onSnapshot={setSnapshot} onDirtyChange={setPlanningDirty} onBusyChange={setPlanningBusy}
      initialPlan={result?.space === 'planning' ? result.plan : undefined} onBackToSearch={result ? returnToSearch : undefined} />;
    return <SettingsWorkspace snapshot={snapshot} directory={workDirectory} onRestored={setSnapshot} onBusyChange={setSettingsBusy}
      workspaceVisibility={workspaceVisibility} onWorkspaceVisibilityChange={changeWorkspaceVisibility} />;
  }
  return <div className={`app-shell ${space === 'collection' || space === 'work' || space === 'search' ? 'gallery-shell' : ''}`} aria-busy={loading || workspaceBusy}>
    <header className="app-header" data-tauri-drag-region>
      <div className="header-left">
        <span className="wordmark">Foliune<span>.</span></span>
      </div>
      <PrimaryNavigation items={navigationSpaces} value={space} durationMs={primaryNavigationDurationMs} onChange={navigate} />
      <nav className="header-actions" aria-label="工具">
        <button type="button" className={`icon-button ${space === 'search' ? 'is-active' : ''}`} aria-label="全局搜索 · ⌘K / Ctrl K" title="全局搜索 · ⌘K / Ctrl K" aria-current={space === 'search' ? 'page' : undefined} onClick={openSearch}><Search size={19} /></button>
        <button type="button" className={`icon-button ${space === 'settings' ? 'is-active' : ''}`} aria-label="设置" title="设置" aria-current={space === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}><Settings2 size={18} /></button>
      </nav>
    </header>
    {!api.isDesktop() && <div className="desktop-hint">当前为浏览器预览 · 请在 Foliune 桌面应用中导入和管理本地照片</div>}
    {error && <div className="recovery-banner" role="alert"><span>{error}</span>{!ready && api.isDesktop() && <button type="button" onClick={() => void reload()}>重新读取</button>}</div>}
    <main ref={mainRef}>{loading ? <Busy /> : !ready ? <><WorkspaceHeader title={spaces.find((item) => item.id === space)?.label} /><EmptyState title={api.isDesktop() ? '暂时无法读取图库' : '请在桌面应用中使用'} description={api.isDesktop() ? '读取失败，请检查提示后重试。现有照片未作更改。' : '浏览器仅预览界面。本地照片、存储与编辑需在 Foliune 桌面应用中使用。'} action={api.isDesktop() ? <button type="button" className="button" onClick={() => void reload()}>重新读取</button> : undefined} /></> : searchTarget ? <SearchResultLoader key={`${searchTarget.space}:${searchTarget.id}`} target={searchTarget} onBack={returnToSearch}>{renderWorkspace}</SearchResultLoader> : renderWorkspace()}</main>
    {relinkConfirmation && <Modal title="确认替换照片" onClose={() => confirmRelink(false)}><p className="replacement-copy">将用所选文件替换此照片；所有相簿和画册中的引用都会使用该文件</p><p className="replacement-path">{relinkConfirmation.path}</p><div className="form-actions"><button type="button" className="button" autoFocus onClick={() => confirmRelink(false)}>取消</button><button type="button" className="button button-primary" onClick={() => confirmRelink(true)}>确认替换</button></div></Modal>}
    {pendingClose && <Modal title="放弃修改并关闭窗口？" onClose={() => { if (!closing) setPendingClose(false); }}><p className="replacement-copy">当前修改尚未保存，关闭窗口将放弃这些修改。</p><div className="form-actions"><button type="button" className="button" autoFocus disabled={closing} onClick={() => setPendingClose(false)}>继续编辑</button><button type="button" className="button" disabled={closing || workspaceBusy} onClick={() => void discardAndClose()}>{closing ? '正在关闭…' : '放弃并关闭'}</button></div></Modal>}
    {pendingSpace && <Modal title="离开未保存的修改？" onClose={() => setPendingSpace(null)}><p className="replacement-copy">当前修改尚未保存。离开将放弃这些修改。</p><div className="form-actions"><button type="button" className="button" autoFocus onClick={() => setPendingSpace(null)}>继续编辑</button><button type="button" className="button" disabled={workspaceBusy} onClick={() => { if (workspaceBusy) return; setBookDirty(false); setPhotoDirty(false); setModelDirty(false); setPlanningDirty(false); changeSpace(pendingSpace.space, pendingSpace.target); }}>放弃并离开</button></div></Modal>}
    {playingIds && <PhotoPlayer photos={snapshot.photos} photoIds={playingIds} onClose={() => setPlayingIds(null)} onRelink={relinkPhoto} onFeedback={feedback} />}
    <WorkDirectoryDiscovery directory={workDirectory} idle={discoveryIdle} />
  </div>;
}

async function loadSearchDetail({ space, id }: SearchTarget): Promise<SearchDetail> {
  if (space === 'books') return { space, book: await getBook(id) };
  if (space === 'models') {
    const model = (await listModels()).find((item) => item.id === id);
    if (!model) throw new Error('模特档案不存在');
    return { space, model };
  }
  const plan = (await listPlans()).find((item) => item.id === id);
  if (!plan) throw new Error('拍摄策划不存在');
  return { space, plan };
}

function SearchResultLoader({ target, onBack, children }: { target: SearchTarget; onBack: () => void; children: (result: SearchDetail) => ReactNode }) {
  const [detail, setDetail] = useState<SearchDetail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const title = spaces.find((item) => item.id === target.space)?.label;
  useEffect(() => {
    let current = true;
    void loadSearchDetail(target).then((next) => { if (current) setDetail(next); })
      .catch((cause: unknown) => { if (current) setError(message(cause)); });
    return () => { current = false; };
  }, [target, attempt]);
  useLayoutEffect(() => {
    if (document.activeElement !== document.body) return;
    const heading = root.current?.querySelector('h1');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [detail, attempt]);
  return <div ref={root}>{detail ? children(detail) : <>
    <WorkspaceHeader title={title}><button type="button" className="button" onClick={onBack}>返回搜索</button></WorkspaceHeader>
    {error ? <div role="alert"><EmptyState title="暂时无法打开结果" description={error} action={<button type="button" className="button" onClick={() => { setError(''); setAttempt((value) => value + 1); }}>重新读取</button>} /></div> : <Busy label={`正在读取${title}`} />}
  </>}</div>;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
