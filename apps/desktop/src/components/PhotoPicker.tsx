import { photoCount, t } from '../lib/i18n.ts';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Camera, Check, ChevronRight, Images, Search, X } from 'lucide-react';
import type { LibraryKind, LibrarySnapshot, Photo } from '../lib/types';
import { libraryAlbums } from '../features/library-albums';
import { PhotoImage } from './PhotoImage';
import { PhotoSelectionControls } from './PhotoSelectionControls';
import { EmptyState, IconButton, Modal } from './ui';
import { PageControls, PHOTO_PAGE_SIZE } from './PageControls';
import './photo-picker.css';

const LIBRARIES: LibraryKind[] = ['collection', 'work'];
const LIBRARY_NAMES: Record<LibraryKind, string> = { collection: t('收藏', 'Collection'), work: t('作品', 'Work') };
type PickerStage = { kind: 'libraries' } | { kind: 'albums'; library: LibraryKind } | { kind: 'photos'; library: LibraryKind; albumId: string | null };

interface PhotoLibraryPickerProps {
  snapshot: LibrarySnapshot;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  maxSelection?: number;
  allowedLibraries?: LibraryKind[];
  actions?: ReactNode;
  disabled?: boolean;
}

export function PhotoPicker({ selectedIds, onConfirm, onClose, title = t('从图库选择', 'Choose from Library'), ...props }: Omit<PhotoLibraryPickerProps, 'onChange' | 'actions'> & {
  onConfirm: (ids: string[]) => void; onClose: () => void; title?: string;
}) {
  const [selected, setSelected] = useState(() => [...new Set(selectedIds)]);
  return <Modal title={title} onClose={onClose} wide glass>
    <PhotoLibraryPicker {...props} selectedIds={selected} onChange={setSelected} actions={<>
      <button type="button" className="button" onClick={onClose}>{t('取消', 'Cancel')}</button>
      <button type="button" className="button button-primary" disabled={props.maxSelection !== undefined && selected.length > props.maxSelection} onClick={() => onConfirm(selected)}>{t('确认选择', 'Confirm Selection')}</button>
    </>} />
  </Modal>;
}

export function PhotoLibraryPicker({ snapshot, selectedIds: selected, onChange, maxSelection, allowedLibraries = LIBRARIES, actions, disabled = false }: PhotoLibraryPickerProps) {
  const libraries = [...new Set(allowedLibraries)];
  const [stage, setStage] = useState<PickerStage>(() => libraries.length === 1 ? { kind: 'albums', library: libraries[0] } : { kind: 'libraries' });
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const library = stage.kind === 'libraries' ? null : stage.library;
  const albums = useMemo(() => {
    if (!library) return [];
    const { albums } = libraryAlbums(snapshot, library);
    const assignedIds = new Set(albums.flatMap((album) => album.photos.map((photo) => photo.id)));
    const result: { id: string | null; name: string; photos: Photo[] }[] = albums.map(({ group, photos }) => ({ id: group.id, name: group.name, photos }));
    const unassigned = snapshot.photos.filter((photo) => photo.library === library && !assignedIds.has(photo.id));
    if (unassigned.length) result.push({ id: null, name: t('未归入相簿', 'Outside Albums'), photos: unassigned });
    return result;
  }, [snapshot, library]);
  const album = stage.kind === 'photos' ? albums.find((item) => item.id === stage.albumId) : undefined;
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return (album?.photos ?? []).filter((photo) => !term || [photo.title, photo.originalName, photo.location, photo.project, ...photo.tags].join(' ').toLocaleLowerCase().includes(term));
  }, [album, query]);
  const actualPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PHOTO_PAGE_SIZE) - 1));
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [actualPage, query, stage]);
  useEffect(() => { stageHeading.current?.focus(); }, [stage]);
  const order = new Map(selected.map((id, index) => [id, index + 1]));
  const availableIds = new Set(snapshot.photos.map((photo) => photo.id));
  const missingIds = selected.filter((id) => !availableIds.has(id));
  function toggle(id: string) { onChange(selected.includes(id) ? selected.filter((item) => item !== id) : maxSelection !== undefined && selected.length >= maxSelection ? selected : [...selected, id]); }
  function navigate(next: PickerStage) { setStage(next); setQuery(''); setPage(0); }
  const canGoBack = stage.kind === 'photos' || (stage.kind === 'albums' && libraries.length > 1);
  return <div className="photo-picker">
      <div className="photo-picker-navigation">
        {canGoBack && <IconButton disabled={disabled} label={stage.kind === 'photos' ? t('返回相簿', 'Back to Albums') : t('返回图库', 'Back to Libraries')} onClick={() => navigate(stage.kind === 'photos' ? { kind: 'albums', library: stage.library } : { kind: 'libraries' })}><ArrowLeft size={17} /></IconButton>}
        <h3 ref={stageHeading} tabIndex={-1}>{stage.kind === 'libraries' ? t('选择图库', 'Choose a Library') : stage.kind === 'albums' ? LIBRARY_NAMES[stage.library] : album?.name ?? t('相簿', 'Album')}</h3>
        {stage.kind === 'photos' && <span className="photo-picker-context">{LIBRARY_NAMES[stage.library]}</span>}
      </div>
      {stage.kind === 'photos' && <div className="photo-picker-tools">
        <div className="search-field"><Search size={16} /><input disabled={disabled} aria-label={t('搜索当前相簿照片', 'Search photos in this album')} placeholder={t('搜索照片', 'Search photos')} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />{query && <IconButton disabled={disabled} label={t('清空搜索', 'Clear Search')} onClick={() => { setQuery(''); setPage(0); }}><X size={14} /></IconButton>}</div>
      </div>}
      <div ref={scroll} className="photo-picker-scroll" aria-label={t('图库照片', 'Library photos')}>
      {!!missingIds.length && <div className="photo-picker-missing" role="status"><span>{t(`${missingIds.length} 张已选照片记录缺失`, `Missing selected photos: ${missingIds.length}`)}</span>{missingIds.map((id) => <button type="button" className="text-button" disabled={disabled} key={id} onClick={() => toggle(id)} aria-label={t(`移除第 ${order.get(id)} 张缺失照片`, `Remove missing photo ${order.get(id)}`)}>{t(`移除第 ${order.get(id)} 张`, `Remove ${order.get(id)}`)}<X size={12} /></button>)}</div>}
      {stage.kind === 'libraries' && <div className="photo-picker-libraries">{libraries.map((kind) => <button key={kind} type="button" disabled={disabled} className="photo-picker-library" onClick={() => navigate({ kind: 'albums', library: kind })}>
        {kind === 'collection' ? <Images size={25} /> : <Camera size={25} />}<span>{LIBRARY_NAMES[kind]}</span><ChevronRight size={17} />
      </button>)}</div>}
      {stage.kind === 'albums' && (albums.length ? <div className="photo-picker-albums">{albums.map((item) => <button key={item.id === null ? 'unassigned' : `album:${item.id}`} type="button" disabled={disabled} className="photo-picker-album" onClick={() => navigate({ kind: 'photos', library: stage.library, albumId: item.id })}>
        <span className="photo-picker-album-preview" aria-hidden="true">{item.photos[0] ? <PhotoImage photo={item.photos[0]} lazy /> : <Images size={22} />}</span>
        <span className="photo-picker-album-name">{item.name}</span><span className="photo-picker-album-count">{t(`${item.photos.length} 张`, photoCount(item.photos.length))}</span><ChevronRight size={16} />
      </button>)}</div> : <EmptyState title={t('还没有相簿', 'No albums yet')} />)}
      {stage.kind === 'photos' && (filtered.length ? <div className="photo-picker-grid">{filtered.slice(actualPage * PHOTO_PAGE_SIZE, (actualPage + 1) * PHOTO_PAGE_SIZE).map((photo) => <button key={photo.id} type="button" className={`photo-picker-item ${order.has(photo.id) ? 'is-selected' : ''}`} aria-pressed={order.has(photo.id)} disabled={disabled || (!order.has(photo.id) && maxSelection !== undefined && selected.length >= maxSelection)} aria-label={`${order.has(photo.id) ? t('取消选择', 'Deselect') : t('选择', 'Select')} ${photo.title || photo.originalName}`} onClick={() => toggle(photo.id)}>
        <PhotoImage photo={photo} lazy /><span className="photo-picker-check" aria-hidden="true">{order.has(photo.id) ? <><Check size={12} />{order.get(photo.id)}</> : <span />}</span>
      </button>)}</div> : <EmptyState title={album?.photos.length ? t('没有找到照片', 'No photos found') : t('相簿还没有照片', 'This album has no photos yet')} />)}
      </div>
      {stage.kind === 'photos' && <PageControls page={actualPage} total={filtered.length} onPage={setPage} />}
      <div className="photo-picker-footer">
        <PhotoSelectionControls photos={filtered} selectedIds={selected} maxSelection={maxSelection} disabled={disabled}
          onSelect={(ids) => onChange([...new Set([...selected, ...ids])])} onClear={() => onChange([])} />
        {actions && <div className="form-actions">{actions}</div>}
      </div>
    </div>;
}
