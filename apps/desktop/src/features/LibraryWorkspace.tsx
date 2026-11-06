import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, FolderPlus, Grid2X2, ImagePlus, LayoutTemplate, Play } from 'lucide-react';
import * as api from '../lib/api';
import type { Group, LibraryKind, LibrarySnapshot, Photo } from '../lib/types';
import type { CurationDraft } from '../lib/curation-types';
import { useToast } from '../components/ToastProvider';
import { exportedFileName } from '../lib/export-directory';
import { revealContent } from '../lib/content-reveal';
import { EmptyState, Modal, WorkspaceHeader } from '../components/ui';
import { PhotoCanvas, SelectionBar, type PhotoCanvasHandle, type WallPhotoRestore } from './PhotoCanvas';
import { PhotoDetail } from './PhotoDetail';
import { GroupForm } from './GroupForm';
import { CurationWorkspace } from './CurationWorkspace';
import { PhotoImage } from '../components/PhotoImage';
import { PhotoSourceDialog } from '../components/PhotoSourceDialog';
import { AddPhotosToBook } from './books/AddPhotosToBook';
import { AlbumOverview } from './AlbumOverview';
import { libraryAlbums } from './library-albums';
import { AlbumDetailHeader, type AlbumPhotoLayout } from './AlbumDetailHeader';
import { AlbumSortButton, albumSortLabels, photoSortLabels } from './AlbumSortButton';
import { PhotoReview } from './PhotoReview';
import { wallReviewSource, type ReviewEntrySource } from './review-entry';
import { SinglePhotoView, type SinglePhotoCursor } from './SinglePhotoView';
import { sortAlbumPhotos, sortLibraryAlbums, workPhotoSections, type AlbumSort, type PhotoSort, type WorkView } from './library-photo-order';
import { isPhotoMenuTracking, usePhotoMenu, type PhotoMenuAction } from './use-photo-menu';
import { useContextMenu } from './use-context-menu';
import { SocialWorkspace } from './social/SocialWorkspace';
import { CollageWorkspace } from './collage/CollageWorkspace';
import type { useWorkDirectory } from './use-work-directory';

let preferredPhotoLayout: Exclude<AlbumPhotoLayout, 'single'> = 'exhibition';
let prefersSinglePhoto = false;
const EMPTY_PHOTOS: Photo[] = [];
const ALBUM_SORT_KEY = 'foliune.album-sort';
const PHOTO_SORT_KEY = 'foliune.photo-sort';

function albumAirDropLabel(count: number) {
  return count ? `隔空投送整本 · ${count} 张` : '隔空投送整本';
}

function readSortPreference<Sort extends PhotoSort>(key: string, labels: Record<Sort, string>, fallback: Sort): Sort {
  try {
    const saved = window.localStorage.getItem(key);
    if (saved !== null && Object.prototype.hasOwnProperty.call(labels, saved)) return saved as Sort;
  } catch { /* Sorting remains available when local storage is unavailable. */ }
  return fallback;
}

interface SearchPhotoWall {
  term: string;
  photos: Photo[];
  previewCount?: number;
  onLayoutReady: () => void;
  onBooksChange: () => void;
}

export interface LibraryWorkspaceProps {
  snapshot: LibrarySnapshot; onSnapshot: (snapshot: LibrarySnapshot) => void;
  onFeedback: (message: string, error?: boolean) => void; importDisabled?: boolean; onRelink: (photo: Photo) => Promise<void>;
  detailExtension?: (photo: Photo) => ReactNode;
  onPlay: (photoIds: string[]) => void;
  onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
  onBrowsingIdleChange?: (idle: boolean) => void;
  workDirectoryControl?: ReactNode;
  workDirectory?: Pick<ReturnType<typeof useWorkDirectory>, 'jobs' | 'retryJob' | 'retrying'>;
}

export function LibraryWorkspace({ space, snapshot, onSnapshot, onFeedback, importDisabled = false, onRelink, detailExtension, searchResults, onPlay, onDirtyChange, onBusyChange, onBrowsingIdleChange, workDirectoryControl, workDirectory }: LibraryWorkspaceProps & (
  { space: LibraryKind; searchResults?: never } | { space: 'search'; searchResults: SearchPhotoWall }
)) {
  const [working, setBusy] = useState(false);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [pickingSource, setPickingSource] = useState(false);
  const [bookBusy, setBookBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sharingRef = useRef(false);
  const busy = working || sourceBusy || bookBusy || sharing;
  const supportsAirDrop = api.isDesktop() && window.navigator.userAgent.includes('Macintosh');
  const [collage, setCollage] = useState<{ photoIds: string[] } | null>(null);
  useEffect(() => { if (!collage) onBusyChange?.(busy); return () => { if (!collage) onBusyChange?.(false); }; }, [busy, collage, onBusyChange]);
  const toast = useToast();
  const [social, setSocial] = useState<{ photoIds: string[] } | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const [revealRequest, setRevealRequest] = useState<{ searchScope: string } | null>(null);
  const pendingReveal = useRef<typeof revealRequest>(null);
  const cancelReveal = useRef<(() => void) | null>(null);
  const wallRef = useRef<PhotoCanvasHandle>(null);
  const albumScroll = useRef(0);
  const photoCursor = useRef<SinglePhotoCursor | null>(null);
  const rememberSinglePhoto = useCallback((cursor: SinglePhotoCursor) => { photoCursor.current = cursor; }, []);
  const [restorePhoto, setRestorePhoto] = useState<WallPhotoRestore>();
  const finishWallRestore = useCallback((restored: WallPhotoRestore) => setRestorePhoto((pending) => pending === restored ? undefined : pending), []);
  const finishSingleRestore = useCallback(() => setRestorePhoto(undefined), []);
  const restoringAlbumScroll = useRef(false);
  useLayoutEffect(() => {
    if (social || collage) workspaceRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [social, collage]);
  const restoreAlbumScroll = useCallback(() => {
    if (!restoringAlbumScroll.current) return;
    const main = workspaceRef.current?.closest('main');
    if (!main) return;
    main.scrollTop = albumScroll.current;
    restoringAlbumScroll.current = false;
  }, []);
  function returnToAlbum() {
    restoringAlbumScroll.current = true;
    setSocial(null);
    setCollage(null);
  }
  const [groupId, setGroupId] = useState<string | null>(null);
  const [albumToolsOpen, setAlbumToolsOpen] = useState(false);
  const [albumSortOpen, setAlbumSortOpen] = useState(false);
  const [groupForm, setGroupForm] = useState<'new' | Group | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; scrollTop: number; trigger?: HTMLElement; entrySource?: ReviewEntrySource } | null>(null);
  const [layout, setLayout] = useState<AlbumPhotoLayout>(() => space !== 'search' && prefersSinglePhoto ? 'single' : preferredPhotoLayout);
  const [status, setStatus] = useState<'active' | 'discarded'>('active');
  const [albumSort, setAlbumSort] = useState(() => readSortPreference<AlbumSort>(ALBUM_SORT_KEY, albumSortLabels, 'time-asc'));
  const [photoSort, setPhotoSort] = useState(() => readSortPreference<PhotoSort>(PHOTO_SORT_KEY, photoSortLabels, 'time-desc'));
  const [workView, setWorkView] = useState<WorkView>('none');
  const [addToGroup, setAddToGroup] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<CurationDraft | null>(null);
  const [comparing, setComparing] = useState<string[] | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Group | null>(null);
  const [addingToBook, setAddingToBook] = useState<string[] | null>(null);
  const mounted = useRef(true);
  const draftRef = useRef<CurationDraft | null>(null);
  draftRef.current = draft;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; const active = draftRef.current; if (active) void api.cancelCuration(active.id).catch((cause) => onFeedback(errorMessage(cause), true)); };
  }, []);
  const library: LibraryKind = space === 'work' ? 'work' : 'collection';
  const albumIndex = useMemo(() => space === 'search' ? null : libraryAlbums(snapshot, library), [snapshot, library, space]);
  const hasPendingAlbum = workDirectory?.jobs.some((job) => job.createdAlbum && !albumIndex?.byGroupId.has(job.albumId));
  const currentAlbum = groupId ? albumIndex?.byGroupId.get(groupId) : undefined;
  const currentGroup = currentAlbum?.group;
  const singleAlbum = space !== 'search' && !!currentGroup && layout === 'single';
  const albumHome = space !== 'search' && groupId === null;
  const orderedAlbums = useMemo(() => albumHome && albumIndex ? sortLibraryAlbums(albumIndex.albums, albumSort) : [], [albumHome, albumIndex, albumSort]);
  const browsingIdle = space !== 'search' && !busy && !albumToolsOpen && !albumSortOpen && !selected.length && !groupForm && !deleteConfirm && !detailId && !preview
    && !pickingSource && !draft && !addToGroup && !addingToBook && !comparing && !social && !collage;
  useLayoutEffect(() => {
    onBrowsingIdleChange?.(browsingIdle);
    return () => onBrowsingIdleChange?.(false);
  }, [browsingIdle, onBrowsingIdleChange]);
  const albumHomeTitle = space === 'work' ? '作品相簿' : '收藏相簿';
  const detail = detailId ? snapshot.photos.find((photo) => photo.id === detailId) : undefined;
  function groupCounts(id: string) {
    const album = albumIndex?.byGroupId.get(id);
    return { active: album?.photos.length ?? 0, discarded: album?.discardedPhotos.length ?? 0 };
  }
  const discardedCount = currentAlbum?.discardedPhotos.length ?? 0;
  const albumPhotos = (status === 'active' ? currentAlbum?.photos : currentAlbum?.discardedPhotos) ?? EMPTY_PHOTOS;
  const searchPhotos = searchResults?.photos;
  const previewCount = searchResults?.previewCount;
  const searchPreview = previewCount !== undefined;
  const searchTerm = searchResults?.term;
  const searchScope = JSON.stringify([searchTerm, searchPreview]);
  const reveal = useCallback((elements: readonly Element[]) => {
    if (!revealRequest || pendingReveal.current !== revealRequest || revealRequest.searchScope !== searchScope) return;
    pendingReveal.current = null;
    cancelReveal.current = revealContent(elements);
    setRevealRequest(null);
  }, [revealRequest, searchScope]);
  const onReveal = revealRequest?.searchScope === searchScope ? reveal : undefined;
  useLayoutEffect(() => {
    setRevealRequest((request) => request?.searchScope === searchScope ? request : null);
    return () => {
      cancelReveal.current?.();
      cancelReveal.current = null;
      pendingReveal.current = null;
    };
  }, [searchScope]);
  const canGroup = space === 'work' && !albumHome && (photoSort === 'time-asc' || photoSort === 'time-desc');
  const workSections = useMemo(() => {
    if (canGroup && workView !== 'none') return workPhotoSections(albumPhotos, workView, photoSort);
  }, [albumPhotos, canGroup, workView, photoSort]);
  const photos = useMemo(() => {
    if (searchPhotos) return searchPhotos;
    if (workSections) return workSections.flatMap(([, items]) => items);
    return sortAlbumPhotos(albumPhotos, photoSort);
  }, [albumPhotos, photoSort, searchPhotos, workSections]);
  const wallPhotos = useMemo(() => previewCount === undefined ? photos : photos.slice(0, previewCount), [photos, previewCount]);
  const menuContext = JSON.stringify([space, groupId, status, searchTerm, previewCount, workView, albumSort, photoSort, layout, !!detailId, !!preview, pickingSource, !!draft, !!groupForm, !!addToGroup, !!addingToBook, !!comparing, !!deleteConfirm, !!social, !!collage]);
  const photoIds = useMemo(() => new Set(wallPhotos.map((photo) => photo.id)), [wallPhotos]);
  const currentSelection = useMemo(() => space === 'search' ? selected.filter((id) => photoIds.has(id)) : selected, [space, selected, photoIds]);
  const actionState = useRef({ context: menuContext, busy: busy || importDisabled, ids: photoIds });
  actionState.current = { context: menuContext, busy: busy || importDisabled, ids: photoIds };
  const openPhotoMenu = usePhotoMenu(menuContext, (message) => onFeedback(message, true));
  const syncingAlbums = useMemo(() => new Set(workDirectory?.jobs.filter((job) => job.status !== 'failed' || workDirectory.retrying?.has(job.id)).map((job) => job.albumId)), [workDirectory?.jobs, workDirectory?.retrying]);
  const albumMenuState = useRef({ context: menuContext, busy: busy || importDisabled, albumIndex, syncingAlbums });
  albumMenuState.current = { context: menuContext, busy: busy || importDisabled, albumIndex, syncingAlbums };
  const openAlbumMenu = useContextMenu('album', menuContext, (message) => onFeedback(message, true));
  useEffect(() => { setSelected([]); }, [space, groupId, status, searchTerm, searchPreview]);
  useEffect(() => {
    if (searchPreview) setSelected((ids) => ids.every((id) => photoIds.has(id)) ? ids : ids.filter((id) => photoIds.has(id)));
  }, [searchPreview, photoIds]);
  useLayoutEffect(() => {
    restoringAlbumScroll.current = false;
    if (space !== 'search' && !social && !collage) workspaceRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [space, groupId, status, workView, albumSort, photoSort]);
  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!onReveal || !workspace || (!albumHome && wallPhotos.length)) return;
    const empty = workspace.querySelector(':scope > .empty-state');
    if (empty) { onReveal([empty]); return; }
    const overview = workspace.querySelector(':scope > .album-overview');
    const main = workspace.closest('main');
    if (!overview || !main) return;
    const top = main.getBoundingClientRect().top + main.clientTop;
    const bottom = top + main.clientHeight;
    const cards: Element[] = [];
    for (const card of overview.children) {
      const bounds = card.getBoundingClientRect();
      if (bounds.top >= bottom) break;
      if (bounds.bottom > top) cards.push(card);
    }
    onReveal(cards);
  }, [onReveal, albumHome, wallPhotos.length]);
  useEffect(() => {
    if (social || collage) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPhotoMenuTracking() && !document.querySelector('dialog[open]')) setSelected([]);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [social, collage]);
  function stopReveal() {
    cancelReveal.current?.();
    cancelReveal.current = null;
    pendingReveal.current = null;
    setRevealRequest(null);
  }
  function requestReveal() {
    cancelReveal.current?.();
    cancelReveal.current = null;
    const request = { searchScope };
    pendingReveal.current = request;
    setRevealRequest(request);
  }
  function openSocial(photoIds: string[]) {
    if (busy || importDisabled || !groupId || space === 'search' || !photoIds.length) return;
    stopReveal();
    albumScroll.current = workspaceRef.current?.closest('main')?.scrollTop ?? 0;
    setSocial({ photoIds });
  }
  function openCollage(photoIds: string[]) {
    if (busy || importDisabled || !groupId || space === 'search' || photoIds.length < 2) return;
    stopReveal();
    albumScroll.current = workspaceRef.current?.closest('main')?.scrollTop ?? 0;
    setCollage({ photoIds });
  }
  function changeLayout(next: AlbumPhotoLayout) {
    if (next === layout) return;
    requestReveal();
    if (next !== 'single') preferredPhotoLayout = next;
    if (space !== 'search') {
      prefersSinglePhoto = next === 'single';
      const remembered = photoCursor.current;
      const current = remembered && photoIds.has(remembered.id) ? remembered : null;
      const cursor = singleAlbum || (restorePhoto && restorePhoto.id === current?.id)
        ? current : wallRef.current?.viewportPhoto(current?.id) ?? current;
      photoCursor.current = cursor;
      if (next === 'single') {
        setRestorePhoto(undefined);
        workspaceRef.current?.closest('main')?.scrollTo({ top: 0 });
      } else {
        setRestorePhoto(cursor ? { id: cursor.id } : undefined);
      }
    }
    setLayout(next);
  }
  function resetAlbumPosition() {
    photoCursor.current = null;
    setRestorePhoto(undefined);
    setPreview(null);
  }
  function openAlbum(id: string | null) {
    if (id !== groupId) requestReveal();
    resetAlbumPosition(); setGroupId(id); setStatus('active'); setDetailId(null); setSelected([]);
  }
  function changeAlbumStatus(discarded: boolean) {
    stopReveal();
    resetAlbumPosition();
    setStatus(discarded ? 'discarded' : 'active');
  }
  function changePhotoOrder() {
    stopReveal();
    if (!singleAlbum) photoCursor.current = null;
    setRestorePhoto(undefined);
  }
  function saveSortPreference(key: string, sort: PhotoSort) {
    try { window.localStorage.setItem(key, sort); }
    catch { onFeedback('无法记住排序偏好', true); }
  }
  function changeAlbumSort(next: AlbumSort) {
    stopReveal();
    setAlbumSort(next);
    saveSortPreference(ALBUM_SORT_KEY, next);
  }
  function changePhotoSort(next: PhotoSort) {
    if (next !== photoSort) changePhotoOrder();
    setPhotoSort(next);
    saveSortPreference(PHOTO_SORT_KEY, next);
  }
  function openPreview(photo: Photo, trigger?: HTMLElement, entrySource?: ReviewEntrySource) {
    const main = workspaceRef.current?.closest('main');
    setPreview({ id: photo.id, scrollTop: main?.scrollTop ?? 0, trigger, entrySource });
  }
  function openWallPreview(photo: Photo, trigger?: HTMLButtonElement) {
    openPreview(photo, trigger, trigger && space !== 'search' && currentGroup ? wallReviewSource(photo, trigger) : undefined);
  }
  function closePreview(visibleId?: string) {
    setPreview(null);
    if (!preview || space === 'search') return;
    const displayed = visibleId && photoIds.has(visibleId) ? visibleId : undefined;
    const id = displayed ?? preview.id;
    const index = photos.findIndex((photo) => photo.id === id);
    const changed = id !== preview.id;
    const changeSingle = singleAlbum && displayed !== undefined && photoCursor.current?.id !== id;
    if (index !== -1 && (changeSingle || !singleAlbum)) photoCursor.current = { id, index };
    if (changed || changeSingle) setRestorePhoto({ id, focus: true });
    else if (singleAlbum) {
      const main = workspaceRef.current?.closest('main');
      if (main) main.scrollTop = preview.scrollTop;
      preview.trigger?.focus({ preventScroll: true });
    } else setRestorePhoto({ id, scrollTop: preview.scrollTop, focus: preview.trigger ?? true });
  }
  function togglePhoto(id: string) { setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]); }
  function showAlbumMenu(group: Group, at: { x: number; y: number }, trigger: HTMLElement) {
    const context = menuContext;
    const target = () => albumMenuState.current.albumIndex?.byGroupId.get(group.id);
    const allowed = () => albumMenuState.current.context === context && !albumMenuState.current.busy && !!target();
    const canDelete = () => allowed() && !albumMenuState.current.syncingAlbums.has(group.id);
    const count = target()?.photos.length ?? 0;
    const canShare = () => allowed() && count > 0 && target()?.photos.length === count;
    void openAlbumMenu([
      { id: 'info', text: '相簿信息…', disabled: busy || importDisabled, allowed, run: () => { const current = target(); if (current) setGroupForm(current.group); } },
      ...(supportsAirDrop ? [{ id: 'airdrop', text: albumAirDropLabel(count), disabled: !canShare(), allowed: canShare, run: () => void shareAirDrop(group.id) }] : []),
      { id: 'delete', text: '删除相簿…', disabled: !canDelete(), allowed: canDelete, run: () => { const current = target(); if (current) setDeleteConfirm(current.group); } },
    ], at, trigger);
  }
  async function shareAirDrop(id: string, ids?: string[]) {
    if (sharingRef.current || busy || importDisabled) return;
    sharingRef.current = true;
    setSharing(true);
    toast({ title: '正在准备隔空投送…', status: 'info' });
    try { await api.shareAlbumAirDrop(id, ids); }
    catch (cause) { onFeedback(errorMessage(cause), true); }
    finally {
      sharingRef.current = false;
      setSharing(false);
    }
  }
  async function run<T,>(operation: () => Promise<T>): Promise<T> {
    setBusy(true);
    try { return await operation(); }
    catch (cause) { onFeedback(errorMessage(cause), true); throw cause; }
    finally { setBusy(false); }
  }
  function importFiles() {
    if (busy || importDisabled || draft || !currentGroup) return;
    setPickingSource(true);
  }
  async function prepareGroup(id: string, patch: { photoIds?: string[]; capacity?: number | null; name?: string; description?: string }) {
    const prepared = await run(() => api.prepareGroupCuration(id, patch)); if (mounted.current) setDraft(prepared); else await api.cancelCuration(prepared.id);
  }
  function validSelection(next: LibrarySnapshot, ids: string[]) {
    return ids.filter((id) => next.photos.some((photo) => photo.id === id) && (!groupId || next.memberships.some((member) => member.groupId === groupId && member.photoId === id && member.status === status)));
  }
  async function changeStatus(ids: string[]) {
    if (!groupId || busy) return;
    try {
      if (status === 'discarded') await prepareGroup(groupId, { photoIds: ids });
      else { const next = await run(() => api.setMembershipStatuses(groupId, ids, 'discarded')); onSnapshot(next); setSelected((current) => validSelection(next, current)); onFeedback('已从当前相簿废弃，原文件保留'); }
    } catch { /* Error is already visible. */ }
  }
  const importButton = currentGroup ? <button type="button" className="button button-primary" onClick={() => void importFiles()} disabled={busy || importDisabled}><ImagePlus size={15} />{busy ? '处理中…' : '导入照片'}</button> : undefined;
  function showPhotoMenu(photo: Photo | null, at: { x: number; y: number }, trigger: HTMLElement) {
    const ids = photo && !currentSelection.includes(photo.id) ? [photo.id] : photos.filter((item) => currentSelection.includes(item.id)).map((item) => item.id);
    if (!ids.length) return;
    const single = photo || (ids.length === 1 ? photos.find((item) => item.id === ids[0]) : undefined);
    const context = menuContext;
    const allowed = () => actionState.current.context === context && !actionState.current.busy && ids.every((id) => actionState.current.ids.has(id));
    const action = (id: PhotoMenuAction['id'], text: string, run: () => void): PhotoMenuAction => ({ id, text, run, disabled: busy || importDisabled, allowed });
    const countSuffix = ids.length > 1 ? ` · ${ids.length} 张` : '';
    const actions: PhotoMenuAction[] = [];
    if (single) {
      actions.push(action('preview', '查看大图', () => openPreview(single, trigger)), action('detail', '详情与标注', () => setDetailId(single.id)));
      actions.push(action('select', currentSelection.includes(single.id) ? '取消选择' : '选择', () => togglePhoto(single.id)));
    }
    if (ids.length >= 2 && groupId && space !== 'search') actions.push(action('collage', `拼图${countSuffix}`, () => openCollage(ids)));
    if (ids.length === 2) actions.push(action('compare', `并排比较${countSuffix}`, () => setComparing(ids)));
    actions.push(action('play', `欣赏${countSuffix}`, () => onPlay(ids)), action('book', `加入画册${countSuffix}`, () => setAddingToBook(ids)), action('group', `加入相簿${countSuffix}`, () => setAddToGroup(ids)));
    if (supportsAirDrop && currentGroup && status === 'active') {
      actions.push(action('airdrop', `隔空投送${countSuffix}`, () => void shareAirDrop(currentGroup.id, ids)));
    }
    if (currentGroup) actions.push(action('membership', `${status === 'active' ? '从相簿废弃' : '恢复到相簿'}${countSuffix}`, () => void changeStatus(ids)));
    void openPhotoMenu(actions, at, trigger);
  }
  function canvas() {
    if (singleAlbum) return <SinglePhotoView key={`${groupId}:${status}`} photos={photos} selected={selected} initialCursor={photoCursor.current} rememberCursor={rememberSinglePhoto} onMenu={showPhotoMenu} onRelink={onRelink} busy={busy || importDisabled} onLayoutReady={restoreAlbumScroll}
      restorePhotoId={restorePhoto?.id} onPhotoRestored={finishSingleRestore} onReveal={onReveal} />;
    return <PhotoCanvas ref={wallRef} photos={wallPhotos} sections={workSections} onLayoutReady={searchResults?.onLayoutReady ?? restoreAlbumScroll} selected={currentSelection} onSelect={togglePhoto} onPreview={openWallPreview} onMenu={showPhotoMenu} layout={previewCount !== undefined ? 'grid' : layout === 'single' ? preferredPhotoLayout : layout} emptyAction={importButton} onRelink={onRelink} busy={busy}
      restore={restorePhoto} onRestored={finishWallRestore} onReveal={onReveal} />;
  }
  return <section ref={workspaceRef} className={social || collage ? undefined : `library-workspace library-${space}${singleAlbum && photos.length ? ' album-single-layout' : ''}${previewCount !== undefined ? ' search-photo-preview' : ''}`} aria-label={space === 'work' ? '作品图库' : space === 'search' ? '照片搜索结果' : '收藏图库'}>
    {collage ? <CollageWorkspace snapshot={snapshot} library={library} initialPhotoIds={collage.photoIds} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} onRelink={onRelink} onExit={returnToAlbum} onExported={(path) => { toast({ title: `已导出 ${exportedFileName(path)}`, dismissible: false }); returnToAlbum(); }} /> : social ? <SocialWorkspace photos={snapshot.photos} initialPhotoIds={social.photoIds} onExit={returnToAlbum} onRelink={onRelink} /> : <>
    {currentGroup && space !== 'search' ? <AlbumDetailHeader
      name={currentGroup.name} homeTitle={albumHomeTitle}
      discarded={status === 'discarded'} activeLabel={space === 'work' ? '相簿' : '收藏'}
      canImport={!busy && !importDisabled} canPlay={!!photos.length && !busy} canSort={!!photos.length}
      airDrop={supportsAirDrop ? { label: albumAirDropLabel(currentAlbum?.photos.length ?? 0), disabled: busy || importDisabled || !currentAlbum?.photos.length, run: () => void shareAirDrop(currentGroup.id) } : undefined}
      layout={layout} sort={photoSort} onSort={changePhotoSort} onBack={() => openAlbum(null)} onImport={() => void importFiles()}
      onPlay={() => onPlay(photos.map((photo) => photo.id))} onStatus={changeAlbumStatus}
      workView={canGroup ? workView : undefined} onWorkView={(next) => { if (next !== workView) changePhotoOrder(); setWorkView(next); }}
      onLayout={changeLayout} onMenuOpenChange={setAlbumToolsOpen} onSortOpenChange={setAlbumSortOpen}
      onFocusWall={() => wallRef.current?.focusViewportPhoto(photoCursor.current?.id) ?? false}
    /> : space !== 'search' ? <WorkspaceHeader title={albumHomeTitle} count={albumIndex?.albums.length || !hasPendingAlbum ? `${albumIndex?.albums.length ?? 0} 本相簿` : undefined}>
      {workDirectoryControl}
      <AlbumSortButton label="相簿排序" labels={albumSortLabels} value={albumSort} disabled={!orderedAlbums.length} onChange={changeAlbumSort} onOpenChange={setAlbumSortOpen} />
      <button type="button" className="button" disabled={busy} onClick={() => setGroupForm('new')}><FolderPlus size={15} />新建相簿</button>
    </WorkspaceHeader> : previewCount === undefined && <div className="search-group-heading">
      <h2>照片 <span className="photo-count">{photos.length}</span></h2>
      <div className="workspace-tools">
        <button type="button" className="text-button" disabled={!photos.length || busy} onClick={() => onPlay(photos.map((photo) => photo.id))}><Play size={14} />欣赏</button>
        <div className="segmented" aria-label="浏览方式"><button type="button" className={layout === 'exhibition' ? 'active' : ''} aria-label="展览" aria-pressed={layout === 'exhibition'} onClick={() => changeLayout('exhibition')}><LayoutTemplate size={15} /><span>展览</span></button><button type="button" className={layout === 'grid' ? 'active' : ''} aria-label="总览" aria-pressed={layout === 'grid'} onClick={() => changeLayout('grid')}><Grid2X2 size={15} /><span>总览</span></button></div>
      </div>
    </div>}
    {albumHome ? (orderedAlbums.length || hasPendingAlbum)
      ? <AlbumOverview albums={orderedAlbums} busy={busy || importDisabled} jobs={workDirectory?.jobs} retrying={workDirectory?.retrying} onRetry={workDirectory?.retryJob} onMenu={showAlbumMenu} onOpen={openAlbum} />
      : <EmptyState title="还没有相簿" action={<button type="button" className="button" onClick={() => setGroupForm('new')}><FolderPlus size={15} />新建相簿</button>} /> : !photos.length && status === 'discarded' ? <EmptyState title="没有已废弃的照片" description="从当前相簿废弃的照片会保留在这里。" /> : !photos.length && currentGroup ? <EmptyState title="相簿为空" description={discardedCount ? '可在“已废弃”中恢复照片。' : undefined} action={importButton} /> : canvas()}
    <SelectionBar count={albumHome ? 0 : currentSelection.length} busy={busy || importDisabled} onClear={() => setSelected([])} onBook={() => setAddingToBook(photos.filter((photo) => currentSelection.includes(photo.id)).map((photo) => photo.id))} onMore={(at, trigger) => showPhotoMenu(null, at, trigger)} onCollage={currentGroup && space !== 'search' && selected.length >= 2 ? () => openCollage(photos.filter((photo) => selected.includes(photo.id)).map((photo) => photo.id)) : undefined} onSocial={currentGroup && space !== 'search' ? () => openSocial(photos.filter((photo) => selected.includes(photo.id)).map((photo) => photo.id)) : undefined} />
    {preview && <PhotoReview photos={photos} initialPhotoId={preview.id} entrySource={preview.entrySource} context={space === 'search' ? '搜索结果' : currentGroup?.name || albumHomeTitle} busy={busy || importDisabled} onClose={closePreview} onRelink={onRelink} returnLabel={singleAlbum ? '返回相簿' : undefined} />}
    {detail && <PhotoDetail key={detail.id} photo={detail} busy={busy} onClose={() => setDetailId(null)} onRelink={onRelink} onDirtyChange={onDirtyChange} extension={detailExtension?.(detail)} onSave={async (patch) => { onSnapshot(await run(() => api.updatePhoto(detail.id, patch))); setDetailId(null); onFeedback('已保存照片信息'); }} />}
    {groupForm && <GroupForm group={groupForm === 'new' ? undefined : groupForm} counts={groupForm === 'new' ? undefined : groupCounts(groupForm.id)} busy={busy} onClose={() => setGroupForm(null)} onSave={async (values) => {
      if (groupForm === 'new') { const next = await run(() => api.createGroup({ library, ...values })); const created = next.groups.find((group) => group.library === library && !group.boundFolder && !snapshot.groups.some((old) => old.id === group.id)); onSnapshot(next); if (created) openAlbum(created.id); }
      else await prepareGroup(groupForm.id, values);
      setGroupForm(null);
    }} />}
    {addToGroup && <Modal title="加入相簿" onClose={() => setAddToGroup(null)}><div className="group-list">{snapshot.groups.filter((group) => addToGroup.every((id) => snapshot.photos.find((photo) => photo.id === id)?.library === group.library)).map((group) => <button type="button" key={group.id} disabled={busy} onClick={() => void prepareGroup(group.id, { photoIds: addToGroup }).then(() => setAddToGroup(null)).catch(() => {})}>{group.name}<ArrowUpRight size={14} /></button>)}</div>{!snapshot.groups.some((group) => addToGroup.every((id) => snapshot.photos.find((photo) => photo.id === id)?.library === group.library)) && <p className="muted">没有可加入的同图库相簿。请先新建相簿；收藏与作品分别组织。</p>}</Modal>}
    {pickingSource && currentGroup && <PhotoSourceDialog photos={snapshot.photos} library={library} groupId={currentGroup.id} allowLibrary={false} title="导入照片" onBusyChange={setSourceBusy} onClose={() => setPickingSource(false)} onConfirm={({ snapshot: next }) => { if (next) onSnapshot(next); setPickingSource(false); setSelected([]); onFeedback('已确认选片并保存'); }} />}
    {draft && <CurationWorkspace key={draft.id} draft={draft} onCancel={async () => { await api.cancelCuration(draft.id); setDraft(null); }} onCommit={async (kept) => {
      try { const next = await api.commitCuration(draft.id, kept); onSnapshot(next); setDraft(null); setSelected((ids) => validSelection(next, ids)); onFeedback('已确认选片并保存'); }
      catch (cause) { setDraft(null); onFeedback(`${errorMessage(cause)} 本次取舍未保存，请重新开始。`, true); }
    }} />}
    {comparing && <Modal title="并排比较" wide onClose={() => setComparing(null)}><div className="comparison-grid">{comparing.map((id) => snapshot.photos.find((photo) => photo.id === id)).filter((photo): photo is Photo => !!photo).map((photo) => <article key={photo.id}><PhotoImage photo={photo} original onRelink={onRelink} /><p>{photo.title || photo.originalName}</p><button type="button" className="button" onClick={() => setDetailId(photo.id)}>详情与标注</button></article>)}</div></Modal>}
    {deleteConfirm && <Modal title="删除相簿" onClose={() => setDeleteConfirm(null)}><p className="replacement-copy">删除“{deleteConfirm.name}”？仅在此相簿使用的照片将从搜索和图库选片中移除，照片文件会保留。{deleteConfirm.boundFolder && '源文件夹将停止同步。'}</p><div className="form-actions"><button className="button" type="button" onClick={() => setDeleteConfirm(null)}>取消</button><button className="button button-primary" type="button" disabled={busy || syncingAlbums.has(deleteConfirm.id)} onClick={() => void run(() => api.deleteGroup(deleteConfirm.id)).then((next) => { onSnapshot(next); setDeleteConfirm(null); setGroupForm(null); openAlbum(null); onFeedback('已删除相簿'); }).catch(() => {})}>删除相簿</button></div></Modal>}
    {addingToBook && <AddPhotosToBook onSnapshot={onSnapshot} onBusyChange={setBookBusy} photos={snapshot.photos} selectedIds={addingToBook} onClose={() => setAddingToBook(null)} onComplete={() => { setSelected((ids) => ids.filter((id) => !addingToBook.includes(id))); setAddingToBook(null); searchResults?.onBooksChange(); onFeedback('已加入画册'); }} />}
    </>}
  </section>;
}

function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
