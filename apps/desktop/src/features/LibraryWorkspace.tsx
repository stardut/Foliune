import { albumCount, photoCount, t } from '../lib/i18n';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, CheckCheck, FolderPlus, Grid2X2, ImagePlus, LayoutTemplate, Map as MapIcon, Play, X } from 'lucide-react';
import * as api from '../lib/api';
import type { AlbumCover, Group, LibraryKind, LibrarySnapshot, Photo } from '../lib/types';
import type { CurationDraft, GroupCurationPatch, GroupInfoInput } from '../lib/curation-types';
import { useToast } from '../components/ToastProvider';
import { exportedFileName } from '../lib/export-directory';
import { revealContent, slideContent } from '../lib/content-reveal';
import { EmptyState, Modal, WorkspaceHeader } from '../components/ui';
import { PhotoCanvas, SelectionBar, type PhotoCanvasHandle, type WallPhotoRestore } from './PhotoCanvas';
import { PhotoDetail } from './PhotoDetail';
import { GroupForm } from './GroupForm';
import { CurationWorkspace } from './CurationWorkspace';
import { PhotoImage } from '../components/PhotoImage';
import { PhotoSourceDialog } from '../components/PhotoSourceDialog';
import { AddPhotosToBook } from './books/AddPhotosToBook';
import { AlbumOverview } from './AlbumOverview';
import { AlbumCoverDialog } from './AlbumCoverDialog';
import { libraryAlbums, type LibraryAlbum } from './library-albums';
import { AlbumDetailHeader, type AlbumPhotoLayout } from './AlbumDetailHeader';
import { AlbumSortButton, albumSortLabels, photoSortLabels } from './AlbumSortButton';
import { PhotoReview, type ReviewPhotoMenu } from './PhotoReview';
import { wallReviewSource, type ReviewEntrySource } from './review-entry';
import { SinglePhotoView, type SinglePhotoCursor } from './SinglePhotoView';
import { sortAlbumPhotos, sortLibraryAlbums, workPhotoSections, type AlbumSort, type PhotoSort, type WorkView } from './library-photo-order';
import { isPhotoMenuTracking, usePhotoMenu, type PhotoMenuAction } from './use-photo-menu';
import { useContextMenu, type ContextMenuPosition } from './use-context-menu';
import { SocialWorkspace } from './social/SocialWorkspace';
import { CollageWorkspace } from './collage/CollageWorkspace';
import { COLLAGE_MAX_PHOTOS } from './collage/collage-layout';
import type { useWorkDirectory } from './use-work-directory';
import { WorksMap } from './works-map/WorksMap';
import { PhotoRegionBatchDialog, type PhotoRegionBatch } from './works-map/PhotoRegionBatchDialog';

let preferredPhotoLayout: Exclude<AlbumPhotoLayout, 'single'> = 'exhibition';
let prefersSinglePhoto = false;
const EMPTY_PHOTOS: Photo[] = [];
const ALBUM_SORT_KEY = 'foliune.album-sort';
const PHOTO_SORT_KEY = 'foliune.photo-sort';
const albumPhotoRegionLabel = t('设置相簿照片地区…', 'Set Album Photo Regions…');

function albumAirDropLabel(count: number) {
  return count ? t(`隔空投送整本 · ${count} 张`, `AirDrop Entire Album · ${photoCount(count)}`) : t('隔空投送整本', 'AirDrop Entire Album');
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
  onWorksMapRegionCoverChange: (regionId: string, photoId: string | null) => void;
  onFeedback: (message: string, error?: boolean) => void; importDisabled?: boolean; onRelink: (photo: Photo) => Promise<void>;
  detailExtension?: (photo: Photo) => ReactNode;
  onPlay: (photoIds: string[]) => void;
  onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
  onBrowsingIdleChange?: (idle: boolean) => void;
  onOpenWorkDirectorySettings?: () => void;
  workDirectory?: Pick<ReturnType<typeof useWorkDirectory>, 'state' | 'jobs' | 'retryJob' | 'retrying'>;
}

export function LibraryWorkspace({ space, snapshot, onSnapshot, onWorksMapRegionCoverChange, onFeedback, importDisabled = false, onRelink, detailExtension, searchResults, onPlay, onDirtyChange, onBusyChange, onBrowsingIdleChange, onOpenWorkDirectorySettings, workDirectory }: LibraryWorkspaceProps & (
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
  const pendingAlbumSlide = useRef<{ id: string | null; ready: boolean; play?: () => void } | null>(null);
  const cancelAlbumSlide = useRef<(() => void) | null>(null);
  const wallRef = useRef<PhotoCanvasHandle>(null);
  const albumHomeScroll = useRef(0);
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
  const [worksMap, setWorksMap] = useState(false);
  const [mapReview, setMapReview] = useState(false);
  const mapEntry = useRef<HTMLButtonElement>(null);
  const mapHomeScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    const main = workspaceRef.current?.closest('main');
    if (worksMap) main?.scrollTo({ top: 0 });
    else if (mapHomeScroll.current !== null) {
      main?.scrollTo({ top: mapHomeScroll.current });
      mapHomeScroll.current = null;
      mapEntry.current?.focus({ preventScroll: true });
    }
  }, [worksMap]);
  const [albumToolsOpen, setAlbumToolsOpen] = useState(false);
  const [albumSortOpen, setAlbumSortOpen] = useState(false);
  const [groupForm, setGroupForm] = useState<'new' | Group | null>(null);
  const [coverTarget, setCoverTarget] = useState<{ groupId: string; photoId: string; initialCover: AlbumCover | null } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [photoRegionBatch, setPhotoRegionBatch] = useState<PhotoRegionBatch | null>(null);
  const [preview, setPreview] = useState<{ id: string; scrollTop: number; trigger?: HTMLElement; entrySource?: ReviewEntrySource; directFullscreen?: boolean } | null>(null);
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
  const albumIndex = useMemo(() => space === 'search' ? null : libraryAlbums({ photos: snapshot.photos, groups: snapshot.groups, memberships: snapshot.memberships }, library), [snapshot.photos, snapshot.groups, snapshot.memberships, library, space]);
  const hasPendingAlbum = workDirectory?.jobs.some((job) => job.createdAlbum && !albumIndex?.byGroupId.has(job.albumId));
  const currentAlbum = groupId ? albumIndex?.byGroupId.get(groupId) : undefined;
  const currentGroup = currentAlbum?.group;
  const singleAlbum = space !== 'search' && !!currentGroup && layout === 'single';
  const albumHome = space !== 'search' && groupId === null;
  const orderedAlbums = useMemo(() => albumHome && albumIndex ? sortLibraryAlbums(albumIndex.albums, albumSort) : [], [albumHome, albumIndex, albumSort]);
  const browsingIdle = space !== 'search' && !busy && !albumToolsOpen && !albumSortOpen && !selected.length && !groupForm && !coverTarget && !deleteConfirm && !detailId && !photoRegionBatch && !preview && !mapReview
    && !pickingSource && !draft && !addToGroup && !addingToBook && !comparing && !social && !collage;
  useLayoutEffect(() => {
    onBrowsingIdleChange?.(browsingIdle);
    return () => onBrowsingIdleChange?.(false);
  }, [browsingIdle, onBrowsingIdleChange]);
  const albumHomeTitle = space === 'work' ? t('作品相簿', 'Work Albums') : t('收藏相簿', 'Collection Albums');
  const detail = detailId ? snapshot.photos.find((photo) => photo.id === detailId) : undefined;
  function groupCounts(id: string) {
    const album = albumIndex?.byGroupId.get(id);
    return { active: album?.photos.length ?? 0, discarded: album?.discardedPhotos.length ?? 0 };
  }
  const discardedCount = currentAlbum?.discardedPhotos.length ?? 0;
  const albumPhotos = (status === 'active' ? currentAlbum?.photos : currentAlbum?.discardedPhotos) ?? EMPTY_PHOTOS;
  const coverPhoto = coverTarget && status === 'active' && coverTarget.groupId === currentGroup?.id
    ? albumPhotos.find((photo) => photo.id === coverTarget.photoId) : undefined;
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
  const albumSlide = pendingAlbumSlide.current;
  const onAlbumWallReady = useCallback(() => {
    if (!albumSlide || pendingAlbumSlide.current !== albumSlide) return;
    albumSlide.ready = true;
    albumSlide.play?.();
  }, [albumSlide]);
  const settleAlbumSlide = useCallback(() => cancelAlbumSlide.current?.(), []);
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
    if (canGroup && workView !== 'none') {
      const emptyHeading = workView === 'location' ? t('未填写地点', 'No Location') : t('未归入项目', 'No Project');
      return workPhotoSections(albumPhotos, workView, photoSort, emptyHeading);
    }
  }, [albumPhotos, canGroup, workView, photoSort]);
  const photos = useMemo(() => {
    if (searchPhotos) return searchPhotos;
    if (workSections) return workSections.flatMap(([, items]) => items);
    return sortAlbumPhotos(albumPhotos, photoSort);
  }, [albumPhotos, photoSort, searchPhotos, workSections]);
  const wallPhotos = useMemo(() => previewCount === undefined ? photos : photos.slice(0, previewCount), [photos, previewCount]);
  const menuContext = JSON.stringify([space, groupId, status, searchTerm, previewCount, workView, albumSort, photoSort, layout, !!detailId, !!photoRegionBatch, !!preview, pickingSource, !!draft, !!groupForm, !!coverTarget, !!addToGroup, !!addingToBook, !!comparing, !!deleteConfirm, !!social, !!collage, worksMap]);
  const photoIds = useMemo(() => new Set(wallPhotos.map((photo) => photo.id)), [wallPhotos]);
  const currentSelection = useMemo(() => selected.filter((id) => photoIds.has(id)), [selected, photoIds]);
  const selectedIds = useMemo(() => new Set(currentSelection), [currentSelection]);
  const allSelected = photoIds.size > 0 && selectedIds.size === photoIds.size;
  const selectAllLabel = allSelected ? t('取消全选', 'Deselect All') : searchPreview ? t('全选预览照片', 'Select All Preview Photos') : t('全选', 'Select All');
  const actionState = useRef({ context: menuContext, busy: busy || importDisabled, ids: photoIds, preview });
  actionState.current = { context: menuContext, busy: busy || importDisabled, ids: photoIds, preview };
  const openPhotoMenu = usePhotoMenu(menuContext, (message) => onFeedback(message, true));
  const syncingAlbums = useMemo(() => new Set(workDirectory?.jobs.filter((job) => job.status !== 'failed' || workDirectory.retrying?.has(job.id)).map((job) => job.albumId)), [workDirectory?.jobs, workDirectory?.retrying]);
  const hiddenPhotoIds = useMemo(() => new Set(snapshot.hiddenPhotoIds), [snapshot.hiddenPhotoIds]);
  const albumMenuState = useRef({ context: menuContext, busy: busy || importDisabled, albumIndex, syncingAlbums, hiddenPhotoIds });
  albumMenuState.current = { context: menuContext, busy: busy || importDisabled, albumIndex, syncingAlbums, hiddenPhotoIds };
  const openAlbumMenu = useContextMenu('album', menuContext, (message) => onFeedback(message, true));
  useEffect(() => { setSelected([]); }, [space, groupId, status, searchTerm, searchPreview]);
  useEffect(() => {
    if (searchPreview) setSelected((ids) => ids.every((id) => photoIds.has(id)) ? ids : ids.filter((id) => photoIds.has(id)));
  }, [searchPreview, photoIds]);
  useLayoutEffect(() => {
    restoringAlbumScroll.current = false;
    if (space === 'search' || social || collage) return;
    const top = groupId === null ? albumHomeScroll.current : 0;
    if (groupId === null) albumHomeScroll.current = 0;
    workspaceRef.current?.closest('main')?.scrollTo({ top });
  }, [space, groupId, status, workView, albumSort, photoSort]);
  useLayoutEffect(() => {
    const request = pendingAlbumSlide.current;
    const workspace = workspaceRef.current;
    if (space === 'search' || !workspace || !request || request.id !== groupId) return;

    // Move the mounted surfaces together within the stationary scrollport.
    const surfaces = [...workspace.querySelectorAll(':scope > :is(.workspace-home-intro, .album-detail-header, .album-overview, .virtual-photo-wall, .album-single-view, .empty-state, .photo-wall-message)')];
    const hold = !request.ready && surfaces.some((surface) => surface.matches('.virtual-photo-wall'));
    const slide = slideContent(surfaces, groupId === null ? -20 : 20, hold);
    if (!slide) { pendingAlbumSlide.current = null; return; }

    let timer: number | undefined;
    const clearRequest = () => {
      window.clearTimeout(timer);
      request.play = undefined;
      if (pendingAlbumSlide.current === request) pendingAlbumSlide.current = null;
    };
    if (hold) {
      // Paint the title immediately and let the first wall units share its start.
      request.play = () => { clearRequest(); slide.play(); };
      timer = window.setTimeout(request.play, 200);
    } else clearRequest();

    const finish = () => {
      clearRequest();
      if (cancelAlbumSlide.current === cancel) cancelAlbumSlide.current = null;
    };
    const cancel = () => { finish(); slide.cancel(); };
    cancelAlbumSlide.current = cancel;
    void slide.finished.then(finish, finish);
    return cancel;
  }, [space, groupId, layout, status, workView, albumSort, photoSort, social, collage]);
  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!onReveal || !workspace || wallPhotos.length) return;
    const empty = workspace.querySelector(':scope > .empty-state');
    if (empty) onReveal([empty]);
  }, [onReveal, wallPhotos.length]);
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
    if (photoIds.length > COLLAGE_MAX_PHOTOS) {
      onFeedback(t(`拼图最多支持 ${COLLAGE_MAX_PHOTOS} 张照片，请减少选片后重试。`, `Collages support up to ${COLLAGE_MAX_PHOTOS} photos. Select fewer photos and try again.`), true);
      return;
    }
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
    if (albumHome && id !== null) {
      albumHomeScroll.current = workspaceRef.current?.closest('main')?.scrollTop ?? 0;
    }
    if (id !== groupId) {
      stopReveal();
      pendingAlbumSlide.current = { id, ready: false };
    }
    resetAlbumPosition(); setGroupId(id); setStatus('active'); setDetailId(null); setSelected([]);
  }
  function openWorksMap() {
    settleAlbumSlide();
    mapHomeScroll.current = workspaceRef.current?.closest('main')?.scrollTop ?? 0;
    setWorksMap(true);
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
    catch { onFeedback(t('无法记住排序偏好', 'Could not save the sort preference'), true); }
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
  function openPreview(photo: Photo, trigger?: HTMLElement, entrySource?: ReviewEntrySource, directFullscreen = false) {
    const main = workspaceRef.current?.closest('main');
    setPreview({ id: photo.id, scrollTop: main?.scrollTop ?? 0, trigger, entrySource, directFullscreen });
  }
  function openWallPreview(photo: Photo, trigger?: HTMLButtonElement) {
    openPreview(photo, trigger, trigger && space !== 'search' && currentGroup ? wallReviewSource(photo, trigger) : undefined);
  }
  function closePreview(visibleId?: string) {
    setPreview(null);
    if (preview?.directFullscreen) {
      if (singleAlbum) {
        const main = workspaceRef.current?.closest('main');
        if (main) main.scrollTop = preview.scrollTop;
        preview.trigger?.focus({ preventScroll: true });
      } else setRestorePhoto({ id: preview.id, scrollTop: preview.scrollTop, focus: preview.trigger ?? true });
      return;
    }
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
  function selectedInPhotoOrder() { return wallPhotos.filter((photo) => selectedIds.has(photo.id)).map((photo) => photo.id); }
  function clearSelectionFromBar() {
    if (!wallRef.current?.focusViewportPhoto()) {
      workspaceRef.current?.querySelector<HTMLButtonElement>('.photo-interaction-target, .album-filmstrip-thumb[tabindex="0"]')?.focus({ preventScroll: true });
    }
    setSelected([]);
  }
  function toggleAllSelection() {
    if (!busy && !importDisabled) setSelected(allSelected ? [] : [...photoIds]);
  }
  function openPhotoRegionBatch(album: LibraryAlbum, requestedIds?: ReadonlySet<string>) {
    const hidden = albumMenuState.current.hiddenPhotoIds;
    const photos: PhotoRegionBatch['photos'] = [];
    for (const { id, location, locationRegionId } of album.photos) {
      if (hidden.has(id) || (requestedIds && !requestedIds.has(id))) continue;
      photos.push({ id, location, locationRegionId: locationRegionId ?? '' });
    }
    if (photos.length) {
      setPhotoRegionBatch({ groupId: album.group.id, albumName: requestedIds ? undefined : album.group.name, photos });
    }
  }
  function showAlbumMenu(group: Group, at: ContextMenuPosition, trigger: HTMLElement) {
    const context = menuContext;
    const target = () => albumMenuState.current.albumIndex?.byGroupId.get(group.id);
    const allowed = () => albumMenuState.current.context === context && !albumMenuState.current.busy && !!target();
    const canDelete = () => allowed() && !albumMenuState.current.syncingAlbums.has(group.id);
    const count = target()?.photos.length ?? 0;
    const canShare = () => allowed() && count > 0 && target()?.photos.length === count;
    const canSetRegion = () => allowed() && !!target()?.photos.some(({ id }) => !albumMenuState.current.hiddenPhotoIds.has(id));
    void openAlbumMenu([
      { id: 'info', text: t('相簿信息…', 'Album Info…'), disabled: busy || importDisabled, allowed, run: () => { const current = target(); if (current) setGroupForm(current.group); } },
      ...(group.library === 'work' ? [{ id: 'shooting-region', text: albumPhotoRegionLabel, disabled: !canSetRegion(), allowed: canSetRegion, run: () => { const current = target(); if (current) openPhotoRegionBatch(current); } }] : []),
      ...(supportsAirDrop ? [{ id: 'airdrop', text: albumAirDropLabel(count), disabled: !canShare(), allowed: canShare, run: () => void shareAirDrop(group.id) }] : []),
      { id: 'delete', text: t('删除相簿…', 'Delete Album…'), disabled: !canDelete(), allowed: canDelete, run: () => { const current = target(); if (current) setDeleteConfirm(current.group); } },
    ], at, trigger);
  }
  async function shareAirDrop(id: string, ids?: string[]) {
    if (sharingRef.current || busy || importDisabled) return;
    sharingRef.current = true;
    setSharing(true);
    toast({ title: t('正在准备隔空投送…', 'Preparing AirDrop…'), status: 'info' });
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
  async function saveCover(id: string, cover: AlbumCover, expected: AlbumCover | null) {
    setBusy(true);
    try {
      onSnapshot(await api.updateGroup(id, { cover }, expected));
      setCoverTarget(null);
      onFeedback(t('已设置相簿封面', 'Album cover set'));
    } finally { setBusy(false); }
  }
  function importFiles() {
    if (busy || importDisabled || draft || !currentGroup) return;
    setPickingSource(true);
  }
  async function showCuration(prepared: CurationDraft) {
    if (mounted.current) setDraft(prepared);
    else await api.cancelCuration(prepared.id);
  }
  async function prepareGroup(id: string, patch: GroupCurationPatch) {
    await showCuration(await run(() => api.prepareGroupCuration(id, patch)));
  }
  async function saveAlbumInfo(group: Group, info: GroupInfoInput) {
    const expected = { name: group.name, description: group.description, capacity: group.capacity };
    if (info.name === expected.name && info.description === expected.description && info.capacity === expected.capacity) return;
    const result = await run(() => api.saveAlbumInfo(group.id, info, expected));
    if (result.status === 'needsCuration') await showCuration(result.draft);
    else {
      onSnapshot(result.snapshot);
      onFeedback(t('已保存相簿信息', 'Album info saved'));
    }
  }
  function validSelection(next: LibrarySnapshot, ids: string[]) {
    return ids.filter((id) => next.photos.some((photo) => photo.id === id) && (!groupId || next.memberships.some((member) => member.groupId === groupId && member.photoId === id && member.status === status)));
  }
  async function changeStatus(ids: string[]) {
    if (!groupId || busy) return;
    try {
      if (status === 'discarded') await prepareGroup(groupId, { photoIds: ids });
      else { const next = await run(() => api.setMembershipStatuses(groupId, ids, 'discarded')); onSnapshot(next); setSelected((current) => validSelection(next, current)); onFeedback(t('已从当前相簿废弃，原文件保留', 'Moved to this album’s rejects. Original files preserved.')); }
    } catch { /* Error is already visible. */ }
  }
  const importButton = currentGroup ? <button type="button" className="button button-primary" onClick={() => void importFiles()} disabled={busy || importDisabled}><ImagePlus size={15} />{busy ? t('处理中…', 'Working…') : t('导入照片', 'Import Photos')}</button> : undefined;
  function showPhotoMenu(photo: Photo | null, at: ContextMenuPosition, trigger: HTMLElement, review?: ReviewPhotoMenu) {
    const ids = photo && (review || !selectedIds.has(photo.id)) ? [photo.id] : selectedInPhotoOrder();
    if (!ids.length) return;
    const single = photo || (ids.length === 1 ? photos.find((item) => item.id === ids[0]) : undefined);
    const context = menuContext;
    const allowed = () => mounted.current && actionState.current.context === context && !actionState.current.busy
      && (review ? actionState.current.preview === preview : ids.every((id) => actionState.current.ids.has(id)));
    const action = (id: PhotoMenuAction['id'], text: string, run: () => void): PhotoMenuAction => ({
      id, text, run: review ? () => review.leaveReview(run, allowed) : run, disabled: busy || importDisabled, allowed,
    });
    const countSuffix = ids.length > 1 ? t(` · ${ids.length} 张`, ` · ${photoCount(ids.length)}`) : '';
    const actions: PhotoMenuAction[] = [];
    if (single) {
      if (!review) {
        actions.push(action('preview', t('查看大图', 'View Photo'), () => openPreview(single, trigger)), action('fullscreen', t('全屏查看', 'View Full Screen'), () => openPreview(single, trigger, undefined, true)));
      } else if (review.canToggleFullscreen) {
        actions.push({ ...action('fullscreen', review.fullscreen ? t('退出全屏', 'Exit Full Screen') : t('全屏查看', 'View Full Screen'), review.toggleFullscreen), run: review.toggleFullscreen });
      }
      actions.push(action('detail', t('详情', 'Details'), () => setDetailId(single.id)));
      if (!review) actions.push(action('select', selectedIds.has(single.id) ? t('取消选择', 'Deselect') : t('选择', 'Select'), () => togglePhoto(single.id)));
    }
    if (!review) actions.push({
      ...action('select-all', selectAllLabel, allSelected && !photo ? clearSelectionFromBar : toggleAllSelection),
      allowed: () => allowed() && actionState.current.ids === photoIds,
    });
    if (photo && currentGroup && status === 'active') {
      actions.push(action('cover', t('设为封面…', 'Set as Cover…'), () => setCoverTarget({ groupId: currentGroup.id, photoId: photo.id, initialCover: currentGroup.cover ?? null })));
    }
    if (!review && space === 'work' && currentGroup && status === 'active' && ids.length > 1) {
      actions.push(action('shooting-region', t(`设置拍摄地区…${countSuffix}`, `Set Shooting Region…${countSuffix}`), () => {
        const album = albumMenuState.current.albumIndex?.byGroupId.get(currentGroup.id);
        if (album) openPhotoRegionBatch(album, new Set(ids));
      }));
    }
    if (ids.length >= 2 && groupId && space !== 'search') actions.push(action('collage', t(`拼图${countSuffix}`, `Collage${countSuffix}`), () => openCollage(ids)));
    if (ids.length === 2) actions.push(action('compare', t(`并排比较${countSuffix}`, `Compare Side by Side${countSuffix}`), () => setComparing(ids)));
    actions.push(action('play', t(`欣赏${countSuffix}`, `Play Slideshow${countSuffix}`), () => onPlay(ids)), action('book', t(`加入画册${countSuffix}`, `Add to Photo Book${countSuffix}`), () => setAddingToBook(ids)), action('group', t(`加入相簿${countSuffix}`, `Add to Album${countSuffix}`), () => setAddToGroup(ids)));
    if (supportsAirDrop && currentGroup && status === 'active') {
      actions.push(action('airdrop', t(`隔空投送${countSuffix}`, `AirDrop${countSuffix}`), () => void shareAirDrop(currentGroup.id, ids)));
    }
    if (currentGroup) actions.push(action('membership', `${status === 'active' ? t('从相簿废弃', 'Move to Rejects') : t('恢复到相簿', 'Restore to Album')}${countSuffix}`, () => void changeStatus(ids)));
    void openPhotoMenu(actions, at, trigger);
  }
  function canvas() {
    if (singleAlbum) return <SinglePhotoView key={`${groupId}:${status}`} photos={photos} selected={currentSelection} initialCursor={photoCursor.current} rememberCursor={rememberSinglePhoto} onMenu={showPhotoMenu} onRelink={onRelink} busy={busy || importDisabled} onLayoutReady={restoreAlbumScroll}
      restorePhotoId={restorePhoto?.id} onPhotoRestored={finishSingleRestore} onReveal={onReveal} />;
    return <PhotoCanvas ref={wallRef} photos={wallPhotos} sections={workSections} onLayoutReady={searchResults?.onLayoutReady ?? restoreAlbumScroll} selected={currentSelection} onSelect={togglePhoto} onPreview={openWallPreview} onMenu={showPhotoMenu} layout={previewCount !== undefined ? 'grid' : layout === 'single' ? preferredPhotoLayout : layout} emptyAction={importButton} onRelink={onRelink} busy={busy}
      compactAlbumPair={!!currentGroup} restore={restorePhoto} onRestored={finishWallRestore}
      onReveal={onReveal ?? (albumSlide && albumSlide.id === groupId ? onAlbumWallReady : undefined)} />;
  }
  return <section ref={workspaceRef} className={social || collage ? undefined : `library-workspace library-${space}${singleAlbum && photos.length ? ' album-single-layout' : ''}${previewCount !== undefined ? ' search-photo-preview' : ''}`} aria-label={space === 'work' ? t('作品图库', 'Work Library') : space === 'search' ? t('照片搜索结果', 'Photo Search Results') : t('收藏图库', 'Collection Library')}>
    {worksMap && albumHome && space === 'work' && albumIndex
      ? <WorksMap albums={albumIndex.albums} hiddenPhotoIds={snapshot.hiddenPhotoIds} onBack={() => setWorksMap(false)} onReviewChange={setMapReview}
        regionCovers={snapshot.worksMapRegionCovers} busy={busy || importDisabled} onFeedback={onFeedback}
        onSetCover={async (regionId, photoId) => {
          setBusy(true);
          try {
            await api.setWorksMapRegionCover(regionId, photoId);
            onWorksMapRegionCoverChange(regionId, photoId);
            onFeedback(photoId ? t('已设置地区封面', 'Region cover set') : t('已恢复自动封面', 'Automatic cover restored'));
          } finally { setBusy(false); }
        }} />
      : collage ? <CollageWorkspace snapshot={snapshot} library={library} initialPhotoIds={collage.photoIds} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} onRelink={onRelink} onExit={returnToAlbum} onExported={(path) => { toast({ title: t(`已导出 ${exportedFileName(path)}`, `Exported ${exportedFileName(path)}`), dismissible: false }); returnToAlbum(); }} /> : social ? <SocialWorkspace snapshot={snapshot} initialPhotoIds={social.photoIds} onExit={returnToAlbum} onRelink={onRelink} /> : <>
    {currentGroup && space !== 'search' ? <AlbumDetailHeader
      name={currentGroup.name} homeTitle={albumHomeTitle}
      discarded={status === 'discarded'} activeLabel={space === 'work' ? t('相簿', 'Album') : t('收藏', 'Collection')}
      canImport={!busy && !importDisabled} canPlay={!!photos.length && !busy} canSort={!!photos.length}
      selection={photos.length ? { allSelected, disabled: busy || importDisabled, run: toggleAllSelection } : undefined}
      airDrop={supportsAirDrop ? { label: albumAirDropLabel(currentAlbum?.photos.length ?? 0), disabled: busy || importDisabled || !currentAlbum?.photos.length, run: () => void shareAirDrop(currentGroup.id) } : undefined}
      shootingRegion={space === 'work' && status === 'active' && currentAlbum ? { label: albumPhotoRegionLabel,
        disabled: busy || importDisabled || !currentAlbum.photos.some(({ id }) => !hiddenPhotoIds.has(id)), run: () => openPhotoRegionBatch(currentAlbum) } : undefined}
      layout={layout} sort={photoSort} onSort={changePhotoSort} onBack={() => openAlbum(null)} onImport={() => void importFiles()}
      onPlay={() => onPlay(photos.map((photo) => photo.id))} onStatus={changeAlbumStatus}
      workView={canGroup ? workView : undefined} onWorkView={(next) => { if (next !== workView) changePhotoOrder(); setWorkView(next); }}
      onLayout={changeLayout} onMenuOpenChange={setAlbumToolsOpen}
      onBeforeMenuOpen={settleAlbumSlide}
      onFocusWall={() => wallRef.current?.focusViewportPhoto(photoCursor.current?.id) ?? false}
    /> : space !== 'search' ? <WorkspaceHeader title={albumHomeTitle} count={albumIndex?.albums.length || !hasPendingAlbum ? t(`${albumIndex?.albums.length ?? 0} 本相簿`, albumCount(albumIndex?.albums.length ?? 0)) : undefined}>
      {space === 'work' && <button ref={mapEntry} type="button" className="text-button" onClick={openWorksMap}><MapIcon size={16} aria-hidden="true" />{t('地图', 'Map')}</button>}
      <AlbumSortButton label={t('相簿排序', 'Sort Albums')} labels={albumSortLabels} value={albumSort} disabled={!orderedAlbums.length} onChange={changeAlbumSort} onBeforeOpen={settleAlbumSlide} onOpenChange={setAlbumSortOpen} />
      <button type="button" className="button" disabled={busy} onClick={() => setGroupForm('new')}><FolderPlus size={15} />{t('新建相簿', 'New Album')}</button>
    </WorkspaceHeader> : previewCount === undefined && <div className="search-group-heading">
      <h2>{t('照片', 'Photos')} <span className="photo-count">{photos.length}</span></h2>
      <div className="workspace-tools">
        <button type="button" className="text-button" disabled={!photos.length || busy || importDisabled} onClick={toggleAllSelection}>
          {allSelected ? <X size={14} aria-hidden="true" /> : <CheckCheck size={14} aria-hidden="true" />}{selectAllLabel}
        </button>
        <button type="button" className="text-button" disabled={!photos.length || busy} onClick={() => onPlay(photos.map((photo) => photo.id))}><Play size={14} />{t('欣赏', 'Slideshow')}</button>
        <div className="segmented" aria-label={t('浏览方式', 'View Mode')}><button type="button" className={layout === 'exhibition' ? 'active' : ''} aria-label={t('展览', 'Exhibition')} aria-pressed={layout === 'exhibition'} onClick={() => changeLayout('exhibition')}><LayoutTemplate size={15} /><span>{t('展览', 'Exhibition')}</span></button><button type="button" className={layout === 'grid' ? 'active' : ''} aria-label={t('总览', 'Grid')} aria-pressed={layout === 'grid'} onClick={() => changeLayout('grid')}><Grid2X2 size={15} /><span>{t('总览', 'Grid')}</span></button></div>
      </div>
    </div>}
    {albumHome ? (orderedAlbums.length || hasPendingAlbum)
      ? <AlbumOverview albums={orderedAlbums} busy={busy || importDisabled} jobs={workDirectory?.jobs} retrying={workDirectory?.retrying} onRetry={workDirectory?.retryJob} onMenu={showAlbumMenu} onOpen={openAlbum} />
      : <EmptyState title={t('还没有相簿', 'No albums yet')} action={<>
        <button type="button" className="button" onClick={() => setGroupForm('new')}><FolderPlus size={15} />{t('新建相簿', 'New Album')}</button>
        {workDirectory?.state?.status === 'unbound' && onOpenWorkDirectorySettings && <button type="button" className="text-button work-directory-settings-link" onClick={onOpenWorkDirectorySettings}>{t('在设置中绑定作品目录', 'Link a Work Folder in Settings')}</button>}
      </>} /> : !photos.length && status === 'discarded' ? <EmptyState title={t('没有已废弃的照片', 'No rejected photos')} description={t('从当前相簿废弃的照片会保留在这里。', 'Photos moved to this album’s rejects appear here.')} /> : !photos.length && currentGroup ? <EmptyState title={t('相簿为空', 'This album is empty')} description={discardedCount ? t('可在“已废弃”中恢复照片。', 'Restore photos from the Rejects view.') : undefined} action={importButton} /> : canvas()}
    <SelectionBar count={albumHome ? 0 : currentSelection.length} busy={busy || importDisabled} onClear={clearSelectionFromBar} onBook={() => setAddingToBook(selectedInPhotoOrder())} onMore={(at, trigger) => showPhotoMenu(null, at, trigger)} onCollage={currentGroup && space !== 'search' && currentSelection.length >= 2 ? () => openCollage(selectedInPhotoOrder()) : undefined} onSocial={currentGroup && space !== 'search' ? () => openSocial(selectedInPhotoOrder()) : undefined} />
    {preview && <PhotoReview photos={photos} initialPhotoId={preview.id} entrySource={preview.entrySource} fullscreen={preview.directFullscreen ? 'direct' : 'available'} context={space === 'search' ? t('搜索结果', 'Search Results') : currentGroup?.name || albumHomeTitle} busy={busy || importDisabled} onClose={closePreview} onRelink={onRelink} onPhotoMenu={showPhotoMenu} returnLabel={singleAlbum ? t('返回相簿', 'Back to Album') : undefined} />}
    {currentGroup && coverTarget && coverPhoto && <AlbumCoverDialog photo={coverPhoto} albumName={currentGroup.name} photoCount={currentAlbum?.photos.length ?? 0} initialCover={coverTarget.initialCover} busy={busy || importDisabled}
      onClose={() => setCoverTarget(null)} onSave={(cover) => saveCover(currentGroup.id, cover, coverTarget.initialCover)} />}
    {detail && <PhotoDetail key={detail.id} photo={detail} busy={busy} onClose={() => setDetailId(null)} onRelink={onRelink} onDirtyChange={onDirtyChange} extension={detailExtension?.(detail)} onSave={async (patch, expected) => {
      if (Object.keys(patch).length) {
        onSnapshot(await run(() => api.updatePhoto(detail.id, patch, expected)));
        onFeedback(t('已保存照片信息', 'Photo info saved'));
      }
      setDetailId(null);
    }} />}
    {photoRegionBatch && <PhotoRegionBatchDialog batch={photoRegionBatch} busy={busy || importDisabled} onDirtyChange={onDirtyChange}
      onClose={() => setPhotoRegionBatch(null)} onSave={async (regionId, photos) => {
        setBusy(true);
        try {
          onSnapshot(await api.setPhotoRegions(photos, regionId, photoRegionBatch.groupId));
          setPhotoRegionBatch(null);
          onFeedback(t(`已更新 ${photos.length} 张照片的拍摄地区`, `Shooting region set for ${photoCount(photos.length)}`));
        } finally { setBusy(false); }
      }} />}
    {groupForm && <GroupForm group={groupForm === 'new' ? undefined : groupForm}
      defaultCapacity={groupForm === 'new' && library === 'collection' ? 50 : undefined}
      counts={groupForm === 'new' ? undefined : groupCounts(groupForm.id)} busy={busy} onClose={() => setGroupForm(null)} onSave={async (values) => {
      if (groupForm === 'new') { const next = await run(() => api.createGroup({ library, ...values })); const created = next.groups.find((group) => group.library === library && !group.boundFolder && !snapshot.groups.some((old) => old.id === group.id)); onSnapshot(next); if (created) openAlbum(created.id); }
      else await saveAlbumInfo(groupForm, values);
      setGroupForm(null);
    }} />}
    {addToGroup && <Modal title={t('加入相簿', 'Add to Album')} onClose={() => setAddToGroup(null)}><div className="group-list">{snapshot.groups.filter((group) => addToGroup.every((id) => snapshot.photos.find((photo) => photo.id === id)?.library === group.library)).map((group) => <button type="button" key={group.id} disabled={busy} onClick={() => void prepareGroup(group.id, { photoIds: addToGroup }).then(() => setAddToGroup(null)).catch(() => {})}>{group.name}<ArrowUpRight size={14} /></button>)}</div>{!snapshot.groups.some((group) => addToGroup.every((id) => snapshot.photos.find((photo) => photo.id === id)?.library === group.library)) && <p className="muted">{t('没有可加入的同图库相簿。请先新建相簿；收藏与作品分别组织。', 'Create an album in this library first. Collection and Work have separate albums.')}</p>}</Modal>}
    {pickingSource && currentGroup && <PhotoSourceDialog snapshot={snapshot} library={library} groupId={currentGroup.id} allowLibrary={false} title={t('导入照片', 'Import Photos')} onBusyChange={setSourceBusy} onClose={() => setPickingSource(false)} onConfirm={({ snapshot: next }) => { if (next) onSnapshot(next); setPickingSource(false); setSelected([]); onFeedback(t('已确认选片并保存', 'Selection confirmed and saved')); }} />}
    {draft && <CurationWorkspace key={draft.id} draft={draft} onCancel={async () => { await api.cancelCuration(draft.id); setDraft(null); }} onCommit={async (kept) => {
      try { const next = await api.commitCuration(draft.id, kept); onSnapshot(next); setDraft(null); setSelected((ids) => validSelection(next, ids)); onFeedback(t('已确认选片并保存', 'Selection confirmed and saved')); }
      catch (cause) { setDraft(null); onFeedback(t(`${errorMessage(cause)} 本次取舍未保存，请重新开始。`, `${errorMessage(cause)} Your selection was not saved. Please start again.`), true); }
    }} />}
    {comparing && <Modal title={t('并排比较', 'Side-by-Side Comparison')} wide onClose={() => setComparing(null)}><div className="comparison-grid">{comparing.map((id) => snapshot.photos.find((photo) => photo.id === id)).filter((photo): photo is Photo => !!photo).map((photo) => <article key={photo.id}><PhotoImage photo={photo} original onRelink={onRelink} /><p>{photo.title || photo.originalName}</p><button type="button" className="button" onClick={() => setDetailId(photo.id)}>{t('详情', 'Details')}</button></article>)}</div></Modal>}
    {deleteConfirm && <Modal title={t('删除相簿', 'Delete Album')} onClose={() => setDeleteConfirm(null)}><p className="replacement-copy">{t(`删除“${deleteConfirm.name}”？仅在此相簿使用的照片将从搜索和图库选片中移除，照片文件会保留。`,
      `Delete “${deleteConfirm.name}”? Photos used only in this album will be removed from search and the photo picker. Photo files will be kept.`)}{deleteConfirm.boundFolder && t('源文件夹将停止同步。', ' The source folder will stop syncing.')}</p><div className="form-actions"><button className="button" type="button" onClick={() => setDeleteConfirm(null)}>{t('取消', 'Cancel')}</button><button className="button button-primary" type="button" disabled={busy || syncingAlbums.has(deleteConfirm.id)} onClick={() => void run(() => api.deleteGroup(deleteConfirm.id)).then((next) => { onSnapshot(next); setDeleteConfirm(null); setGroupForm(null); openAlbum(null); onFeedback(t('已删除相簿', 'Album deleted')); }).catch(() => {})}>{t('删除相簿', 'Delete Album')}</button></div></Modal>}
    {addingToBook && <AddPhotosToBook snapshot={snapshot} onSnapshot={onSnapshot} onBusyChange={setBookBusy} photos={snapshot.photos} selectedIds={addingToBook} onClose={() => setAddingToBook(null)} onComplete={() => { setSelected((ids) => ids.filter((id) => !addingToBook.includes(id))); setAddingToBook(null); searchResults?.onBooksChange(); onFeedback(t('已加入画册', 'Added to photo book')); }} />}
    </>}
  </section>;
}

function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
