import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, FolderPlus, Grid2X2, ImagePlus, LayoutTemplate, Play, Search, X } from 'lucide-react';
import * as api from '../lib/api';
import type { Group, LibraryKind, LibrarySnapshot, Photo } from '../lib/types';
import type { CurationDraft } from '../lib/curation-types';
import { useToast } from '../components/ToastProvider';
import { EmptyState, IconButton, Modal } from '../components/ui';
import { PhotoCanvas, SelectionBar } from './PhotoCanvas';
import { PhotoDetail } from './PhotoDetail';
import { GroupForm } from './GroupForm';
import { CurationWorkspace } from './CurationWorkspace';
import { PhotoImage } from '../components/PhotoImage';
import { PageControls, PHOTO_PAGE_SIZE } from '../components/PageControls';
import { AddPhotosToBook } from './books/AddPhotosToBook';
import { AlbumOverview } from './AlbumOverview';
import { libraryAlbums } from './library-albums';
import { AlbumDetailHeader } from './AlbumDetailHeader';
import { PhotoReview } from './PhotoReview';
import { photoReviewOrder, workPhotoSections, type WorkView } from './library-photo-order';
import { isPhotoMenuTracking, usePhotoMenu, type PhotoMenuAction } from './use-photo-menu';
import { useContextMenu } from './use-context-menu';
import { SocialWorkspace } from './social/SocialWorkspace';
import { CollageWorkspace } from './collage/CollageWorkspace';

let preferredPhotoLayout: 'exhibition' | 'grid' = 'exhibition';

export function LibraryWorkspace({ space, snapshot, onSnapshot, onFeedback, importDisabled = false, onRelink, detailExtension, extraSearchText, onPlay, onDirtyChange, onBusyChange }: {
  space: LibraryKind | 'search'; snapshot: LibrarySnapshot; onSnapshot: (snapshot: LibrarySnapshot) => void;
  onFeedback: (message: string, error?: boolean) => void; importDisabled?: boolean; onRelink: (photo: Photo) => Promise<void>;
  detailExtension?: (photo: Photo) => ReactNode; extraSearchText?: (photo: Photo) => string;
  onPlay: (photoIds: string[]) => void;
  onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [collage, setCollage] = useState<{ photoIds: string[] } | null>(null);
  const toast = useToast();
  const [social, setSocial] = useState<{ photoIds: string[] } | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const albumScroll = useRef(0);
  useLayoutEffect(() => {
    const main = workspaceRef.current?.closest('main');
    if (!main) return;
    main.scrollTop = (social || collage) ? 0 : albumScroll.current;
    if (social || collage) return;
    // The photo wall measures its width after remounting. Restore again once
    // that layout has committed, so a short initial wall cannot clamp the return.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { main.scrollTop = albumScroll.current; });
    });
    return () => cancelAnimationFrame(frame);
  }, [social, collage]);
  const [album, setAlbum] = useState<{ kind: 'group'; id: string } | { kind: 'ungrouped' } | null>(null);
  const groupId = album?.kind === 'group' ? album.id : null;
  const [groupForm, setGroupForm] = useState<'new' | Group | null>(null);
  const [ungroupedInfo, setUngroupedInfo] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [layout, setLayout] = useState(preferredPhotoLayout);
  const [status, setStatus] = useState<'active' | 'discarded'>('active');
  const [query, setQuery] = useState('');
  const [workView, setWorkView] = useState<WorkView>('time');
  const [addToGroup, setAddToGroup] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<CurationDraft | null>(null);
  const [comparing, setComparing] = useState<string[] | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Group | null>(null);
  const [addingToBook, setAddingToBook] = useState<string[] | null>(null);
  const [galleryPage, setGalleryPage] = useState(0);
  const mounted = useRef(true);
  const draftRef = useRef<CurationDraft | null>(null);
  draftRef.current = draft;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; const active = draftRef.current; if (active) void api.cancelCuration(active.id).catch((cause) => onFeedback(errorMessage(cause), true)); };
  }, []);
  const library: LibraryKind = space === 'work' ? 'work' : 'collection';
  const currentGroup = snapshot.groups.find((group) => group.id === groupId && group.library === library);
  const { albums, ungrouped } = useMemo(() => libraryAlbums(snapshot, library), [snapshot, library]);
  const albumHome = space !== 'search' && album === null;
  const albumHomeTitle = space === 'work' ? '作品相簿' : '收藏相簿';
  const detail = snapshot.photos.find((photo) => photo.id === detailId);
  function groupCounts(id: string) {
    const photoIds = new Set(snapshot.photos.filter((photo) => photo.library === library).map((photo) => photo.id));
    const members = snapshot.memberships.filter((member) => member.groupId === id && photoIds.has(member.photoId));
    const count = (status: 'active' | 'discarded') => new Set(members.filter((member) => member.status === status).map((member) => member.photoId)).size;
    return { active: count('active'), discarded: count('discarded') };
  }
  const discardedCount = groupId ? groupCounts(groupId).discarded : 0;
  const photos = useMemo(() => {
    let result = snapshot.photos.filter((photo) => space === 'search' || photo.library === library);
    if (space === 'search') {
      const term = query.trim().toLocaleLowerCase();
      result = term ? result.filter((photo) => [photo.title, photo.originalName, photo.annotation, photo.source, photo.location, photo.project, ...photo.tags, ...(photo.regions || []).map((region) => region.text), extraSearchText?.(photo) || ''].join(' ').toLocaleLowerCase().includes(term)) : [];
    } else if (album?.kind === 'ungrouped') {
      result = ungrouped;
    } else if (currentGroup) {
      const ids = snapshot.memberships.filter((member) => member.groupId === groupId && member.status === status).sort((a, b) => a.position - b.position).map((member) => member.photoId);
      result = result.filter((photo) => ids.includes(photo.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    } else {
      result = [];
    }
    if (space === 'work') result = [...result].sort((a, b) => {
      const order = workView === 'location' ? a.location.localeCompare(b.location) : workView === 'project' ? a.project.localeCompare(b.project) : 0;
      return order || (b.capturedAt || b.importedAt).localeCompare(a.capturedAt || a.importedAt);
    });
    return result;
  }, [snapshot, space, library, groupId, currentGroup, album, ungrouped, status, query, workView, extraSearchText]);
  const page = Math.min(galleryPage, Math.max(0, Math.ceil(photos.length / PHOTO_PAGE_SIZE) - 1));
  const visiblePhotos = photos.slice(page * PHOTO_PAGE_SIZE, (page + 1) * PHOTO_PAGE_SIZE);
  const workSections = useMemo(() => {
    if (space !== 'work' || albumHome) return [];
    return workPhotoSections(visiblePhotos, workView);
  }, [visiblePhotos, space, workView, albumHome]);
  const reviewPhotos = useMemo(() => photoReviewOrder(photos, space, workView, PHOTO_PAGE_SIZE), [photos, space, workView]);
  const menuContext = JSON.stringify([space, album?.kind, groupId, status, query, workView, page, layout, !!detailId, !!previewId, !!draft, !!groupForm, ungroupedInfo, !!addToGroup, !!addingToBook, !!comparing, !!deleteConfirm, !!social, !!collage]);
  const actionState = useRef({ context: menuContext, busy: busy || importDisabled, ids: new Set(photos.map((photo) => photo.id)) });
  actionState.current = { context: menuContext, busy: busy || importDisabled, ids: new Set(photos.map((photo) => photo.id)) };
  const openPhotoMenu = usePhotoMenu(menuContext, (message) => onFeedback(message, true));
  const albumMenuState = useRef({ context: menuContext, busy: busy || importDisabled, groups: snapshot.groups });
  albumMenuState.current = { context: menuContext, busy: busy || importDisabled, groups: snapshot.groups };
  const openAlbumMenu = useContextMenu('album', menuContext, (message) => onFeedback(message, true));
  useEffect(() => { setSelected([]); }, [space, groupId, status, query]);
  useEffect(() => { setGalleryPage(0); }, [space, groupId, status, query, workView]);
  useEffect(() => {
    if (social || collage) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !isPhotoMenuTracking() && !document.querySelector('dialog[open]')) setSelected([]); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [social, collage]);
  function openSocial(photoIds: string[]) {
    if (busy || importDisabled || !album || space === 'search' || !photoIds.length) return;
    albumScroll.current = workspaceRef.current?.closest('main')?.scrollTop ?? 0;
    setSocial({ photoIds });
  }
  function openCollage(photoIds: string[]) {
    if (busy || importDisabled || !album || space === 'search' || photoIds.length < 2) return;
    albumScroll.current = workspaceRef.current?.closest('main')?.scrollTop ?? 0;
    setCollage({ photoIds });
  }
  function changeLayout(next: typeof layout) { preferredPhotoLayout = next; setLayout(next); }
  function openAlbum(next: typeof album) { setAlbum(next); setStatus('active'); setDetailId(null); setSelected([]); setGalleryPage(0); }
  function togglePhoto(id: string) { setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]); }
  function showAlbumMenu(group: Group, at: { x: number; y: number }, trigger: HTMLElement) {
    const context = menuContext;
    const target = () => albumMenuState.current.groups.find((item) => item.id === group.id && item.library === library);
    const allowed = () => albumMenuState.current.context === context && !albumMenuState.current.busy && !!target();
    void openAlbumMenu([
      { id: 'info', text: '相簿信息…', disabled: busy || importDisabled, allowed, run: () => { const current = target(); if (current) setGroupForm(current); } },
      { id: 'delete', text: '删除相簿…', disabled: busy || importDisabled, allowed, run: () => { const current = target(); if (current) setDeleteConfirm(current); } },
    ], at, trigger);
  }
  async function run<T,>(operation: () => Promise<T>): Promise<T> {
    setBusy(true);
    try { return await operation(); }
    catch (cause) { onFeedback(errorMessage(cause), true); throw cause; }
    finally { setBusy(false); }
  }
  async function importFiles() {
    if (busy || draft || !currentGroup) return;
    try { const prepared = await run(() => api.prepareImport(library, currentGroup.id)); if (prepared) { if (mounted.current) setDraft(prepared); else await api.cancelCuration(prepared.id); } }
    catch { /* The real operation error is shown by run. */ }
  }
  async function prepareGroup(id: string, patch: { photoIds?: string[]; capacity?: number | null; name?: string; description?: string }) {
    const prepared = await run(() => api.prepareGroupCuration(id, patch)); if (mounted.current) setDraft(prepared); else await api.cancelCuration(prepared.id);
  }
  function validSelection(next: LibrarySnapshot, ids: string[]) {
    return ids.filter((id) => next.photos.some((photo) => photo.id === id) && (!groupId || next.memberships.some((member) => member.groupId === groupId && member.photoId === id && member.status === status)) && (album?.kind !== 'ungrouped' || !next.memberships.some((member) => member.photoId === id)));
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
    const ids = photo && !selected.includes(photo.id) ? [photo.id] : reviewPhotos.filter((item) => selected.includes(item.id)).map((item) => item.id);
    if (!ids.length) return;
    const single = photo || (ids.length === 1 ? photos.find((item) => item.id === ids[0]) : undefined);
    const context = menuContext;
    const allowed = () => actionState.current.context === context && !actionState.current.busy && ids.every((id) => actionState.current.ids.has(id));
    const action = (id: PhotoMenuAction['id'], text: string, run: () => void): PhotoMenuAction => ({ id, text, run, disabled: busy || importDisabled, allowed });
    const actions: PhotoMenuAction[] = [];
    if (single) {
      actions.push(action('preview', '放大挑选这张照片', () => setPreviewId(single.id)), action('detail', '这张照片的详情与标注', () => setDetailId(single.id)));
      actions.push(action('select', selected.includes(single.id) ? '取消选择这张照片' : '选择这张照片', () => togglePhoto(single.id)));
    }
    if (ids.length >= 2 && album && space !== 'search') actions.push(action('collage', `拼图 · ${ids.length} 张`, () => openCollage(ids)));
    if (ids.length === 2) actions.push(action('compare', '并排比较 2 张照片', () => setComparing(ids)));
    actions.push(action('play', `欣赏 ${ids.length} 张照片`, () => onPlay(ids)), action('book', `加入画册 · ${ids.length} 张`, () => setAddingToBook(ids)), action('group', `加入相簿 · ${ids.length} 张`, () => setAddToGroup(ids)));
    if (currentGroup) actions.push(action('membership', `${status === 'active' ? '从当前相簿废弃' : '恢复到当前相簿'} ${ids.length} 张照片`, () => void changeStatus(ids)));
    void openPhotoMenu(actions, at, trigger);
  }
  function canvas(items: Photo[]) { return <PhotoCanvas photos={items} selected={selected} onSelect={togglePhoto} onPreview={(photo) => setPreviewId(photo.id)} onMenu={showPhotoMenu} layout={layout} emptyAction={importButton} onRelink={onRelink} busy={busy} />; }
  return <section ref={workspaceRef} className={social || collage ? undefined : `library-workspace library-${space}`} aria-label={space === 'work' ? '作品图库' : space === 'search' ? '照片搜索' : '收藏图库'}>
    {collage ? <CollageWorkspace snapshot={snapshot} library={library} initialPhotoIds={collage.photoIds} sourceGroupId={groupId} onSnapshot={onSnapshot} onDirtyChange={onDirtyChange} onBusyChange={onBusyChange} onRelink={onRelink} onExit={() => setCollage(null)} onSaved={(next) => { onSnapshot(next); setSelected((ids) => validSelection(next, ids)); toast({ title: '保存成功', dismissible: false }); setCollage(null); }} /> : social ? <SocialWorkspace photos={snapshot.photos} initialPhotoIds={social.photoIds} onExit={() => setSocial(null)} onRelink={onRelink} /> : <>
    {album && space !== 'search' ? <AlbumDetailHeader
      name={currentGroup?.name || '未归入相簿'} homeTitle={albumHomeTitle}
      discarded={status === 'discarded'} activeLabel={space === 'work' ? '相簿' : '收藏'}
      hasGroup={!!currentGroup} canImport={!!currentGroup && !busy && !importDisabled} canPlay={!!photos.length && !busy}
      layout={layout} onBack={() => openAlbum(null)} onImport={() => void importFiles()}
      onPlay={() => onPlay(photos.map((photo) => photo.id))} onStatus={(discarded) => setStatus(discarded ? 'discarded' : 'active')}
      workView={space === 'work' ? workView : undefined} onWorkView={setWorkView}
      onLayout={changeLayout} onInfo={() => setUngroupedInfo(true)}
    /> : <section className="workspace-intro library-intro">
      <div className="intro-copy"><div className="library-title-line"><h1>{space === 'search' ? '搜索' : albumHomeTitle}</h1><p className="photo-count">{space === 'search' ? `${photos.length} 张结果` : `${albums.length} 本相簿`}</p></div></div>
      <div className="workspace-tools">
        {albumHome ? <button type="button" className="button" disabled={busy} onClick={() => setGroupForm('new')}><FolderPlus size={15} />新建相簿</button> : <>
          <button type="button" className="text-button" disabled={!photos.length || busy} onClick={() => onPlay(photos.map((photo) => photo.id))}><Play size={14} />欣赏</button>
          <div className="segmented" aria-label="浏览方式"><button type="button" className={layout === 'exhibition' ? 'active' : ''} aria-label="展览" aria-pressed={layout === 'exhibition'} onClick={() => changeLayout('exhibition')}><LayoutTemplate size={15} /><span>展览</span></button><button type="button" className={layout === 'grid' ? 'active' : ''} aria-label="总览" aria-pressed={layout === 'grid'} onClick={() => changeLayout('grid')}><Grid2X2 size={15} /><span>总览</span></button></div>
        </>}
      </div>
    </section>}
    {space === 'search' && <div className="search-field"><Search size={19} /><input autoFocus aria-label="搜索照片" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、标签、地点、项目、来源或标注" />{query && <IconButton label="清空搜索" onClick={() => setQuery('')}><X size={16} /></IconButton>}</div>}
    {albumHome ? albums.length || ungrouped.length ? <AlbumOverview albums={albums} ungrouped={ungrouped} busy={busy || importDisabled} onMenu={showAlbumMenu} onOpen={(id) => openAlbum({ kind: 'group', id })} onUngrouped={() => openAlbum({ kind: 'ungrouped' })} /> : <EmptyState title="还没有相簿" action={<button type="button" className="button" onClick={() => setGroupForm('new')}><FolderPlus size={15} />新建相簿</button>} /> : space === 'search' && !query.trim() ? <EmptyState title="搜索照片" /> : !photos.length && status === 'discarded' ? <EmptyState title="没有已废弃的照片" description="从当前相簿废弃的照片会保留在这里。" /> : space === 'search' && !photos.length ? <EmptyState title="没有找到照片" description="试试其他关键词。" /> : !photos.length && currentGroup ? <EmptyState title="相簿为空" description={discardedCount ? '可在“已废弃”中恢复照片。' : undefined} action={importButton} /> : !photos.length && album?.kind === 'ungrouped' ? <EmptyState title="照片都已归入相簿" action={<button type="button" className="button" onClick={() => openAlbum(null)}>{albumHomeTitle}</button>} /> : space === 'work' && photos.length ? workSections.map(([heading, items]) => <section className="work-section" key={heading}><div className="section-heading"><h2>{heading}</h2></div>{canvas(items)}</section>) : canvas(visiblePhotos)}
    {!albumHome && <PageControls page={page} total={photos.length} onPage={setGalleryPage} />}
    <SelectionBar count={albumHome ? 0 : selected.length} busy={busy || importDisabled} onClear={() => setSelected([])} onBook={() => setAddingToBook(reviewPhotos.filter((photo) => selected.includes(photo.id)).map((photo) => photo.id))} onMore={(at, trigger) => showPhotoMenu(null, at, trigger)} onCollage={album && space !== 'search' && selected.length >= 2 ? () => openCollage(reviewPhotos.filter((photo) => selected.includes(photo.id)).map((photo) => photo.id)) : undefined} onSocial={album && space !== 'search' ? () => openSocial(reviewPhotos.filter((photo) => selected.includes(photo.id)).map((photo) => photo.id)) : undefined} />
    {previewId && <PhotoReview photos={reviewPhotos} initialPhotoId={previewId} context={space === 'search' ? '搜索结果' : currentGroup?.name || '未归入相簿'} busy={busy || importDisabled} onClose={() => setPreviewId(null)} onRelink={onRelink} />}
    {detail && <PhotoDetail key={detail.id} photo={detail} busy={busy} onClose={() => setDetailId(null)} onRelink={onRelink} onDirtyChange={onDirtyChange} extension={detailExtension?.(detail)} onSave={async (patch) => { onSnapshot(await run(() => api.updatePhoto(detail.id, patch))); setDetailId(null); onFeedback('已保存照片信息'); }} />}
    {groupForm && <GroupForm group={groupForm === 'new' ? undefined : groupForm} counts={groupForm === 'new' ? undefined : groupCounts(groupForm.id)} busy={busy} onClose={() => setGroupForm(null)} onSave={async (values) => {
      if (groupForm === 'new') { const next = await run(() => api.createGroup({ library, ...values })); const created = next.groups.find((group) => !snapshot.groups.some((old) => old.id === group.id)); onSnapshot(next); if (created) openAlbum({ kind: 'group', id: created.id }); }
      else await prepareGroup(groupForm.id, values);
      setGroupForm(null);
    }} />}
    {ungroupedInfo && <Modal title="相簿信息" onClose={() => setUngroupedInfo(false)}><dl className="album-info"><div><dt>照片数量</dt><dd>{ungrouped.length} 张</dd></div><div><dt>照片上限</dt><dd>不限</dd></div><div><dt>简介</dt><dd>这些照片尚未关联任何相簿。选中照片可加入相簿；新照片请进入相簿后导入。</dd></div></dl></Modal>}
    {addToGroup && <Modal title="加入相簿" onClose={() => setAddToGroup(null)}><div className="group-list">{snapshot.groups.filter((group) => addToGroup.every((id) => snapshot.photos.find((photo) => photo.id === id)?.library === group.library)).map((group) => <button type="button" key={group.id} disabled={busy} onClick={() => void prepareGroup(group.id, { photoIds: addToGroup }).then(() => setAddToGroup(null)).catch(() => {})}>{group.name}<ArrowUpRight size={14} /></button>)}</div>{!snapshot.groups.some((group) => addToGroup.every((id) => snapshot.photos.find((photo) => photo.id === id)?.library === group.library)) && <p className="muted">没有可加入的同图库相簿。请先新建相簿；收藏与作品分别组织。</p>}</Modal>}
    {draft && <CurationWorkspace key={draft.id} draft={draft} onCancel={async () => { await api.cancelCuration(draft.id); setDraft(null); }} onCommit={async (kept) => {
      try { const next = await api.commitCuration(draft.id, kept); onSnapshot(next); setDraft(null); setSelected((ids) => validSelection(next, ids)); onFeedback('已确认选片并保存'); }
      catch (cause) { setDraft(null); onFeedback(`${errorMessage(cause)} 本次取舍未保存，请重新开始。`, true); }
    }} />}
    {comparing && <Modal title="并排比较" wide onClose={() => setComparing(null)}><div className="comparison-grid">{comparing.map((id) => snapshot.photos.find((photo) => photo.id === id)).filter((photo): photo is Photo => !!photo).map((photo) => <article key={photo.id}><PhotoImage photo={photo} original onRelink={onRelink} /><p>{photo.title || photo.originalName}</p><button type="button" className="button" onClick={() => setDetailId(photo.id)}>详情与标注</button></article>)}</div></Modal>}
    {deleteConfirm && <Modal title="删除相簿" onClose={() => setDeleteConfirm(null)}><p className="replacement-copy">删除“{deleteConfirm.name}”及其相簿关系？照片原文件、其他相簿和画册保留。</p><div className="form-actions"><button className="button" type="button" onClick={() => setDeleteConfirm(null)}>取消</button><button className="button button-primary" type="button" disabled={busy} onClick={() => void run(() => api.deleteGroup(deleteConfirm.id)).then((next) => { onSnapshot(next); setDeleteConfirm(null); setGroupForm(null); openAlbum(null); onFeedback('已删除相簿'); }).catch(() => {})}>删除相簿</button></div></Modal>}
    {addingToBook && <AddPhotosToBook photos={snapshot.photos} selectedIds={addingToBook} onClose={() => setAddingToBook(null)} onComplete={() => { setSelected((ids) => ids.filter((id) => !addingToBook.includes(id))); setAddingToBook(null); onFeedback('已加入画册'); }} />}
    </>}
  </section>;
}

function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
