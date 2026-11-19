import { t } from './lib/i18n.ts';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Search, Settings2 } from 'lucide-react';
import { TauriEvent } from '@tauri-apps/api/event';
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
import { currentModalHost, subscribeModalStack } from './lib/modal-stack';
import { Busy, EmptyState, Modal, WorkspaceHeader } from './components/ui';
import { useToast } from './components/ToastProvider';
import { PrimaryNavigation } from './components/PrimaryNavigation';
import { LibraryWorkspace } from './features/LibraryWorkspace';
import { BookWorkspace } from './features/books/BookWorkspace';
import { ModelWorkspace } from './features/models/ModelWorkspace';
import { PlanningWorkspace } from './features/planning/PlanningWorkspace';
import { SearchWorkspace, type SearchSession } from './features/search/SearchWorkspace';
import { LanguageSettings, SettingsWorkspace } from './features/SettingsWorkspace';
import { AppUpdateDialog } from './features/AppUpdateDialog';
import { rememberUpdateNotice, useAppUpdate } from './features/use-app-update';
import { useCliInstall, useCliInstallNotice } from './features/use-cli-install';
import { isContextMenuTracking, subscribeContextMenu } from './features/use-context-menu';
import { PhotoPlayer } from './features/PhotoPlayer';
import { useAppreciationSettings } from './features/use-appreciation-settings';
import { WorkDirectoryDiscovery } from './features/WorkDirectory';
import { useWorkDirectory } from './features/use-work-directory';
import { mergeWorkDirectoryAvailability, recordDirectoryCommit, replaceLibrarySnapshot, type LibraryView } from './features/work-directory-snapshot';
import type { WorkDirectoryCommit } from './lib/work-directory-api';

type Space = LibraryKind | 'books' | 'models' | 'planning' | 'search' | 'settings';
type SearchDetail = { space: 'books'; book: BookDetail } | { space: 'models'; model: ModelProfile } | { space: 'planning'; plan: ShootPlan };
type SearchTarget = { space: SearchDetail['space']; id: string };
const spaces: { id: Space; label: string }[] = [{ id: 'work', label: t('作品', 'Work') }, { id: 'collection', label: t('收藏', 'Collection') }, { id: 'books', label: t('画册', 'Books') }, { id: 'models', label: t('模特', 'Models') }, { id: 'planning', label: t('策划', 'Shoot Plans') }, { id: 'search', label: t('搜索', 'Search') }, { id: 'settings', label: t('设置', 'Settings') }];
const primarySpaces = spaces.filter((item) => item.id !== 'search' && item.id !== 'settings');
const primaryNavigationDurationMs = 360;
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const empty: LibrarySnapshot = { photos: [], groups: [], memberships: [] };
const initialSearchSession: SearchSession = { query: '', category: 'all', scrollTop: 0 };

export default function App({ resumeSettings = false }: { resumeSettings?: boolean }) {
  const mainRef = useRef<HTMLElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const [{ snapshot }, setLibraryView] = useState<LibraryView>({ snapshot: empty, pendingCommits: [], observedPhotos: [] });
  const setSnapshot = useCallback((next: LibrarySnapshot) => setLibraryView((view) => replaceLibrarySnapshot(view, next)), []);
  const updateWorksMapRegionCover = useCallback((regionId: string, photoId: string | null) => {
    setLibraryView((view) => {
      const worksMapRegionCovers = { ...view.snapshot.worksMapRegionCovers };
      if (photoId === null) delete worksMapRegionCovers[regionId];
      else worksMapRegionCovers[regionId] = photoId;
      return { ...view, snapshot: { ...view.snapshot, worksMapRegionCovers } };
    });
  }, []);
  const [loading, setLoading] = useState(true);
  const libraryVersion = useRef<number | null>(null);
  const [externalRevision, setExternalRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const [space, setSpace] = useState<Space>(resumeSettings ? 'settings' : 'work');
  const [workspaceVisibility, setWorkspaceVisibility] = useState(readWorkspaceVisibility);
  const navigationSpaces = useMemo(() => primarySpaces.filter(({ id }) => isWorkspaceVisible(id, workspaceVisibility)), [workspaceVisibility]);
  const previousSpace = useRef(space);
  const searchSession = useRef<SearchSession>({ ...initialSearchSession });
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const [relinkBusy, setRelinkBusy] = useState(false);
  const [relinkConfirmation, setRelinkConfirmation] = useState<{ path: string; resolve: (confirmed: boolean) => void } | null>(null);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [playingIds, setPlayingIds] = useState<string[] | null>(null);
  const appreciation = useAppreciationSettings(feedback);
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
  const appUpdate = useAppUpdate();
  const cliInstall = useCliInstall(ready);
  const installingCli = cliInstall.state.type === 'installing';
  const updating = appUpdate.status.type === 'updating';
  const workDirectory = useWorkDirectory(ready, onDirectorySynced, onDirectoryAvailability, updating);
  const updateVersion = 'version' in appUpdate.status ? appUpdate.status.version : null;
  const modalHost = useSyncExternalStore(subscribeModalStack, currentModalHost);
  const menuOpen = useSyncExternalStore(subscribeContextMenu, isContextMenuTracking);
  const noticedVersions = useRef(new Set<string>());
  const updateNotice = useRef<{ version: string; dismiss: () => void } | null>(null);
  const startFromNotice = useRef(() => {});
  const workspaceDirty = bookDirty || photoDirty || modelDirty || planningDirty;
  const workspaceBusy = bookBusy || modelBusy || photoBusy || planningBusy || settingsBusy || relinkBusy || workDirectory.blocking || updating || installingCli;
  const updateBlocked = !ready || loading || workspaceDirty || workspaceBusy || workDirectory.busy || !!workDirectory.retrying?.size
    || workDirectory.jobs.some((job) => job.status === 'running' || (job.status === 'queued' && workDirectory.state?.status === 'connected'))
    || !!(pendingSpace || pendingClose || relinkConfirmation || playingIds || closing);
  const gallery = space === 'collection' || space === 'work';
  // Simulated layouts keep unsaved input locally without reporting workspace dirtiness.
  const noticeSafe = !gallery || photoBrowsingIdle;
  const discoveryIdle = ready && !loading && (space === 'settings' || (gallery && photoBrowsingIdle))
    && !workspaceDirty && !workspaceBusy && !pendingSpace && !pendingClose && !relinkConfirmation && !playingIds && !appUpdate.dialogOpen;
  closeState.current = { dirty: workspaceDirty, busy: workspaceBusy };
  startFromNotice.current = () => startUpdate('notice');

  const cliBlocked = updateBlocked || appUpdate.dialogOpen || modalHost !== document.body || menuOpen;
  const cliNoticeAllowed = cliInstall.state.type === 'available' && space !== 'settings';
  const directoryDiscoveryPending = workDirectory.state?.status === 'connected' && !!workDirectory.state.candidates.length && !workDirectory.retryPending;
  useCliInstallNotice(cliNoticeAllowed && !cliBlocked && noticeSafe && !directoryDiscoveryPending, cliNoticeAllowed, () => startCliInstall(true));

  useEffect(() => {
    if (updateNotice.current && (appUpdate.status.type === 'current' || (updateVersion && updateNotice.current.version !== updateVersion))) {
      updateNotice.current.dismiss();
      updateNotice.current = null;
    }
    if (!updateVersion || noticedVersions.current.has(updateVersion) || updateBlocked || !noticeSafe || modalHost !== document.body) return;
    noticedVersions.current.add(updateVersion);
    if (rememberUpdateNotice(updateVersion) && space !== 'settings') {
      const dismiss = toast({ title: t(`Foliune ${updateVersion} 可更新`, `Foliune ${updateVersion} is available`), status: 'info', duration: null,
        action: { label: t('立即更新', 'Update Now'), onClick: () => startFromNotice.current() } });
      updateNotice.current = { version: updateVersion, dismiss };
    }
  }, [appUpdate.status.type, updateVersion, updateBlocked, noticeSafe, modalHost, space, toast]);

  function startUpdate(source: 'notice' | 'settings' | 'retry') {
    if (appUpdate.status.type === 'checking') {
      toast({ title: t('正在检查更新，请稍候。', 'Checking for updates…'), status: 'info' });
      return;
    }
    if (updateBlocked || (source === 'notice' && !noticeSafe) || isContextMenuTracking()
      || (source !== 'retry' && (appUpdate.dialogOpen || document.querySelector('dialog[open]')))) {
      toast({ title: t('请先完成当前编辑或图库操作。', 'Finish the current edit or library operation first.'), status: 'info' });
      return;
    }
    if (source === 'notice') settingsButton.current?.focus({ preventScroll: true });
    void appUpdate.start();
    updateNotice.current?.dismiss();
    updateNotice.current = null;
  }

  function startCliInstall(fromNotice: boolean) {
    if (cliBlocked || (fromNotice && !noticeSafe) || isContextMenuTracking() || document.querySelector('dialog[open]')) {
      toast({ title: t('请先完成当前编辑或图库操作。', 'Finish the current edit or library operation first.'), status: 'info' });
      return;
    }
    if (fromNotice) settingsButton.current?.focus({ preventScroll: true });
    void cliInstall.start(fromNotice);
  }

  async function reload() {
    setLoading(true); setError('');
    if (!api.isDesktop()) { setLoading(false); return; }
    try {
      const fresh = await api.snapshotAfterExternalEdit(null);
      if (fresh.snapshot) setSnapshot(fresh.snapshot);
      libraryVersion.current = fresh.version;
      setReady(true);
    }
    catch (cause) { setError(message(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    if (!ready || loading || workspaceDirty || workspaceBusy) return;
    let active = true;
    let reading = false;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const fresh = await api.snapshotAfterExternalEdit(libraryVersion.current);
        if (!active || closeState.current.dirty || closeState.current.busy) return;
        if (fresh.snapshot) {
          setSnapshot(fresh.snapshot);
          setExternalRevision((current) => current + 1);
        }
        libraryVersion.current = fresh.version;
      } catch (cause) {
        if (active) toast({ title: message(cause), status: 'error' });
      } finally { reading = false; }
    };
    void getCurrentWindow().listen(TauriEvent.WINDOW_FOCUS, refresh).then((stop) => {
      if (!active) { stop(); return; }
      unlisten = stop;
      void refresh();
    }).catch((cause: unknown) => { if (active) toast({ title: message(cause), status: 'error' }); });
    return () => { active = false; unlisten?.(); };
  }, [ready, loading, workspaceDirty, workspaceBusy, setSnapshot, toast]);
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
      if (closeState.current.busy) { toast({ title: t('正在处理，请完成后再关闭窗口', 'Wait for the current operation to finish before closing the window.'), status: 'info' }); return; }
      setPendingClose(true);
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; }).catch((cause) => { if (!disposed) setError(t(`关闭保护无法启用：${message(cause)}`, `Could not protect unsaved changes on close: ${message(cause)}`)); });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  async function discardAndClose() {
    if (closeState.current.busy || closing) return;
    setClosing(true);
    try { await getCurrentWindow().destroy(); }
    catch (cause) { setError(t(`关闭窗口失败：${message(cause)}`, `Could not close the window: ${message(cause)}`)); setPendingClose(false); setClosing(false); }
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
    if (workspaceBusy) { feedback(t('正在处理，请完成后再切换工作区', 'Wait for the current operation to finish before switching workspaces.')); return; }
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
    catch { feedback(t('无法记住工作区显示设置', 'Could not save workspace visibility.'), true); }
  }
  async function relinkPhoto(photo: Photo) {
    setRelinkBusy(true); setError('');
    try {
      const next = await api.relinkPhoto(photo.id, (path) => new Promise<boolean>((resolve) => setRelinkConfirmation({ path, resolve })));
      if (!next) return;
      setSnapshot(next); toast({ title: t('已重新定位照片，相簿与标注已保留', 'Photo relinked. Albums and annotations were preserved.') });
    } catch (cause) { throw cause; }
    finally { setRelinkBusy(false); }
  }
  function confirmRelink(confirmed: boolean) { relinkConfirmation?.resolve(confirmed); setRelinkConfirmation(null); }
  function openPlayer(ids: string[]) {
    const actual = ids.filter((id) => snapshot.photos.some((photo) => photo.id === id));
    if (!actual.length) { feedback(t('没有可欣赏的照片', 'No photos to play.'), true); return; }
    // Mount the audio during the slideshow gesture, before the native Space transition.
    flushSync(() => setPlayingIds(actual));
  }
  function returnToSearch() {
    if (relinkBusy) { feedback(t('正在处理，请完成后再切换工作区', 'Wait for the current operation to finish before switching workspaces.')); return; }
    changeSpace('search');
  }
  function renderWorkspace(result?: SearchDetail) {
    const libraryProps = { snapshot, onSnapshot: setSnapshot, onWorksMapRegionCoverChange: updateWorksMapRegionCover, onFeedback: feedback, importDisabled: relinkBusy, onRelink: relinkPhoto, onPlay: openPlayer, onDirtyChange: setPhotoDirty, onBusyChange: setPhotoBusy };
    if (space === 'search') return <SearchWorkspace {...libraryProps} externalRevision={externalRevision} session={searchSession.current} workspaceVisibility={workspaceVisibility}
      onOpenBook={(id) => navigate('books', { space: 'books', id })}
      onOpenModel={(model) => navigate('models', { space: 'models', id: model.id })}
      onOpenPlan={(plan) => navigate('planning', { space: 'planning', id: plan.id })} />;
    if (space === 'collection' || space === 'work') return <LibraryWorkspace key={`${space}:${navigationRevision}`} space={space} {...libraryProps}
      onBrowsingIdleChange={setPhotoBrowsingIdle}
      workDirectory={space === 'work' ? workDirectory : undefined}
      onOpenWorkDirectorySettings={space === 'work' ? () => navigate('settings') : undefined} />;
    if (space === 'books') return <BookWorkspace externalRevision={externalRevision} snapshot={snapshot} photos={snapshot.photos} onSnapshot={setSnapshot} onPlay={openPlayer} onDirtyChange={setBookDirty} onBusyChange={setBookBusy} onRelink={relinkPhoto}
      initialBook={result?.space === 'books' ? result.book : undefined} onBackToSearch={result ? returnToSearch : undefined} />;
    if (space === 'models') return <ModelWorkspace externalRevision={externalRevision} snapshot={snapshot} photos={snapshot.photos} onSnapshot={setSnapshot} onDirtyChange={setModelDirty} onBusyChange={setModelBusy} onRelink={relinkPhoto}
      initialModel={result?.space === 'models' ? result.model : undefined} onBackToSearch={result ? returnToSearch : undefined} />;
    if (space === 'planning') return <PlanningWorkspace snapshot={snapshot} photos={snapshot.photos} onSnapshot={setSnapshot} onDirtyChange={setPlanningDirty} onBusyChange={setPlanningBusy}
      initialPlan={result?.space === 'planning' ? result.plan : undefined} onBackToSearch={result ? returnToSearch : undefined} />;
    return <SettingsWorkspace appreciation={appreciation} snapshot={snapshot} directory={workDirectory} onRestored={setSnapshot} onBusyChange={setSettingsBusy}
      workspaceVisibility={workspaceVisibility} onWorkspaceVisibilityChange={changeWorkspaceVisibility}
      update={appUpdate} updateBlocked={updateBlocked} onUpdate={() => startUpdate('settings')}
      cli={cliInstall} cliBlocked={cliBlocked} onInstallCli={() => startCliInstall(false)} />;
  }
  return <div className={`app-shell ${gallery || space === 'search' ? 'gallery-shell' : ''}`}>
    <header className="app-header" data-tauri-drag-region>
      <div className="header-left">
        <span className="wordmark">Foliune<span>.</span></span>
      </div>
      <PrimaryNavigation items={navigationSpaces} value={space} durationMs={primaryNavigationDurationMs} onChange={navigate} />
      <nav className="header-actions" aria-label={t('工具', 'Tools')}>
        <button type="button" className={`icon-button ${space === 'search' ? 'is-active' : ''}`} aria-label={t('全局搜索 · ⌘K / Ctrl K', 'Search All · ⌘K / Ctrl K')} title={t('全局搜索 · ⌘K / Ctrl K', 'Search All · ⌘K / Ctrl K')} aria-current={space === 'search' ? 'page' : undefined} onClick={openSearch}><Search size={19} /></button>
        <button ref={settingsButton} type="button" className={`icon-button ${space === 'settings' ? 'is-active' : ''} ${updateVersion && space !== 'settings' ? 'settings-update-notice' : ''}`}
          aria-label={updateVersion ? t('设置，有可用更新', 'Settings, update available') : t('设置', 'Settings')} title={updateVersion ? t('设置 · 有可用更新', 'Settings · Update available') : t('设置', 'Settings')}
          aria-current={space === 'settings' ? 'page' : undefined} onClick={() => navigate('settings')}><Settings2 size={18} /></button>
      </nav>
    </header>
    {!api.isDesktop() && <div className="desktop-hint">{t('当前为浏览器预览 · 请在 Foliune 桌面应用中导入和管理本地照片', 'Browser preview · Use the Foliune desktop app to import and manage local photos.')}</div>}
    {error && <div className="recovery-banner" role="alert"><span>{error}</span>{!ready && api.isDesktop() && <button type="button" onClick={() => void reload()}>{t('重新读取', 'Reload')}</button>}</div>}
    <main ref={mainRef} aria-busy={loading || workspaceBusy}>{loading ? <Busy /> : !ready ? <><WorkspaceHeader title={spaces.find((item) => item.id === space)?.label} />{space === 'settings' && api.isDesktop() && <LanguageSettings disabled={workspaceBusy} />}<EmptyState title={api.isDesktop() ? t('暂时无法读取图库', 'Could not load the library') : t('请在桌面应用中使用', 'Open Foliune on your desktop')} description={api.isDesktop() ? t('读取失败，请检查提示后重试。现有照片未作更改。', 'Check the error above and try again. Your photos are unchanged.') : t('浏览器仅预览界面。本地照片、存储与编辑需在 Foliune 桌面应用中使用。', 'Use the Foliune desktop app to access your local library and edit photos.')} action={api.isDesktop() ? <button type="button" className="button" onClick={() => void reload()}>{t('重新读取', 'Reload')}</button> : undefined} /></> : searchTarget ? <SearchResultLoader key={`${searchTarget.space}:${searchTarget.id}`} target={searchTarget} onBack={returnToSearch}>{renderWorkspace}</SearchResultLoader> : renderWorkspace()}</main>
    {relinkConfirmation && <Modal title={t('确认替换照片', 'Replace this photo?')} onClose={() => confirmRelink(false)}><p className="replacement-copy">{t('将用所选文件替换此照片；所有相簿和画册中的引用都会使用该文件', 'This photo will use the selected file in every album and photo book that references it.')}</p><p className="replacement-path">{relinkConfirmation.path}</p><div className="form-actions"><button type="button" className="button" autoFocus onClick={() => confirmRelink(false)}>{t('取消', 'Cancel')}</button><button type="button" className="button button-primary" onClick={() => confirmRelink(true)}>{t('确认替换', 'Replace Photo')}</button></div></Modal>}
    {pendingClose && <Modal title={t('放弃修改并关闭窗口？', 'Discard changes and close the window?')} onClose={() => { if (!closing) setPendingClose(false); }}><p className="replacement-copy">{t('当前修改尚未保存，关闭窗口将放弃这些修改。', 'Closing the window will discard your unsaved changes.')}</p><div className="form-actions"><button type="button" className="button" autoFocus disabled={closing} onClick={() => setPendingClose(false)}>{t('继续编辑', 'Keep Editing')}</button><button type="button" className="button" disabled={closing || workspaceBusy} onClick={() => void discardAndClose()}>{closing ? t('正在关闭…', 'Closing…') : t('放弃并关闭', 'Discard and Close')}</button></div></Modal>}
    {pendingSpace && <Modal title={t('离开未保存的修改？', 'Discard unsaved changes?')} onClose={() => setPendingSpace(null)}><p className="replacement-copy">{t('当前修改尚未保存。离开将放弃这些修改。', 'Leaving this workspace will discard your unsaved changes.')}</p><div className="form-actions"><button type="button" className="button" autoFocus onClick={() => setPendingSpace(null)}>{t('继续编辑', 'Keep Editing')}</button><button type="button" className="button" disabled={workspaceBusy} onClick={() => { if (workspaceBusy) return; setBookDirty(false); setPhotoDirty(false); setModelDirty(false); setPlanningDirty(false); changeSpace(pendingSpace.space, pendingSpace.target); }}>{t('放弃并离开', 'Discard and Leave')}</button></div></Modal>}
    {playingIds && <PhotoPlayer preferences={appreciation.preferences} music={appreciation.music} analysis={appreciation.analysis} photos={snapshot.photos} photoIds={playingIds} onClose={() => setPlayingIds(null)} onRelink={relinkPhoto} onFeedback={feedback} />}
    {appUpdate.dialogOpen && (appUpdate.status.type === 'updating' || appUpdate.status.type === 'updateError') &&
      <AppUpdateDialog status={appUpdate.status} retryBlocked={updateBlocked} onRetry={() => startUpdate('retry')} onClose={appUpdate.closeDialog} />}
    <WorkDirectoryDiscovery directory={workDirectory} idle={discoveryIdle} />
  </div>;
}

async function loadSearchDetail({ space, id }: SearchTarget): Promise<SearchDetail> {
  if (space === 'books') return { space, book: await getBook(id) };
  if (space === 'models') {
    const model = (await listModels()).find((item) => item.id === id);
    if (!model) throw new Error(t('模特档案不存在', 'This model profile no longer exists.'));
    return { space, model };
  }
  const plan = (await listPlans()).find((item) => item.id === id);
  if (!plan) throw new Error(t('拍摄策划不存在', 'This shoot plan no longer exists.'));
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
  return <div ref={root} className="search-result-detail">{detail ? children(detail) : <>
    <WorkspaceHeader title={title}><button type="button" className="button" onClick={onBack}>{t('返回搜索', 'Back to Search')}</button></WorkspaceHeader>
    {error ? <div role="alert"><EmptyState title={t('暂时无法打开结果', 'Could not open this result')} description={error} action={<button type="button" className="button" onClick={() => { setError(''); setAttempt((value) => value + 1); }}>{t('重新读取', 'Reload')}</button>} /></div> : <Busy label={t(`正在读取${title}`, `Loading ${title}…`)} />}
  </>}</div>;
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
