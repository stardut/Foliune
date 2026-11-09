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
const LIBRARY_NAMES: Record<LibraryKind, string> = { collection: '收藏', work: '作品' };
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

export function PhotoPicker({ selectedIds, onConfirm, onClose, title = '从图库选择', ...props }: Omit<PhotoLibraryPickerProps, 'onChange' | 'actions'> & {
  onConfirm: (ids: string[]) => void; onClose: () => void; title?: string;
}) {
  const [selected, setSelected] = useState(() => [...new Set(selectedIds)]);
  return <Modal title={title} onClose={onClose} wide>
    <PhotoLibraryPicker {...props} selectedIds={selected} onChange={setSelected} actions={<>
      <button type="button" className="button" onClick={onClose}>取消</button>
      <button type="button" className="button button-primary" disabled={props.maxSelection !== undefined && selected.length > props.maxSelection} onClick={() => onConfirm(selected)}>确认选择</button>
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
    if (unassigned.length) result.push({ id: null, name: '未归入相簿', photos: unassigned });
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
        {canGoBack && <IconButton disabled={disabled} label={stage.kind === 'photos' ? '返回相簿' : '返回图库'} onClick={() => navigate(stage.kind === 'photos' ? { kind: 'albums', library: stage.library } : { kind: 'libraries' })}><ArrowLeft size={17} /></IconButton>}
        <h3 ref={stageHeading} tabIndex={-1}>{stage.kind === 'libraries' ? '选择图库' : stage.kind === 'albums' ? LIBRARY_NAMES[stage.library] : album?.name ?? '相簿'}</h3>
        {stage.kind === 'photos' && <span className="photo-picker-context">{LIBRARY_NAMES[stage.library]}</span>}
      </div>
      {stage.kind === 'photos' && <div className="photo-picker-tools">
        <div className="search-field"><Search size={16} /><input disabled={disabled} aria-label="搜索当前相簿照片" placeholder="搜索照片" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />{query && <IconButton disabled={disabled} label="清空搜索" onClick={() => { setQuery(''); setPage(0); }}><X size={14} /></IconButton>}</div>
      </div>}
      <div ref={scroll} className="photo-picker-scroll" aria-label="图库照片">
      {!!missingIds.length && <div className="photo-picker-missing" role="status"><span>{missingIds.length} 张已选照片记录缺失</span>{missingIds.map((id) => <button type="button" className="text-button" disabled={disabled} key={id} onClick={() => toggle(id)} aria-label={`移除第 ${order.get(id)} 张缺失照片`}>移除第 {order.get(id)} 张<X size={12} /></button>)}</div>}
      {stage.kind === 'libraries' && <div className="photo-picker-libraries">{libraries.map((kind) => <button key={kind} type="button" disabled={disabled} className="photo-picker-library" onClick={() => navigate({ kind: 'albums', library: kind })}>
        {kind === 'collection' ? <Images size={25} /> : <Camera size={25} />}<span>{LIBRARY_NAMES[kind]}</span><ChevronRight size={17} />
      </button>)}</div>}
      {stage.kind === 'albums' && (albums.length ? <div className="photo-picker-albums">{albums.map((item) => <button key={item.id === null ? 'unassigned' : `album:${item.id}`} type="button" disabled={disabled} className="photo-picker-album" onClick={() => navigate({ kind: 'photos', library: stage.library, albumId: item.id })}>
        <span className="photo-picker-album-preview" aria-hidden="true">{item.photos[0] ? <PhotoImage photo={item.photos[0]} lazy /> : <Images size={22} />}</span>
        <span className="photo-picker-album-name">{item.name}</span><span className="photo-picker-album-count">{item.photos.length} 张</span><ChevronRight size={16} />
      </button>)}</div> : <EmptyState title="还没有相簿" />)}
      {stage.kind === 'photos' && (filtered.length ? <div className="photo-picker-grid">{filtered.slice(actualPage * PHOTO_PAGE_SIZE, (actualPage + 1) * PHOTO_PAGE_SIZE).map((photo) => <button key={photo.id} type="button" className={`photo-picker-item ${order.has(photo.id) ? 'is-selected' : ''}`} aria-pressed={order.has(photo.id)} disabled={disabled || (!order.has(photo.id) && maxSelection !== undefined && selected.length >= maxSelection)} aria-label={`${order.has(photo.id) ? '取消选择' : '选择'} ${photo.title || photo.originalName}`} onClick={() => toggle(photo.id)}>
        <PhotoImage photo={photo} lazy /><span className="photo-picker-check" aria-hidden="true">{order.has(photo.id) ? <><Check size={12} />{order.get(photo.id)}</> : <span />}</span>
      </button>)}</div> : <EmptyState title={album?.photos.length ? '没有找到照片' : '相簿还没有照片'} />)}
      </div>
      {stage.kind === 'photos' && <PageControls page={actualPage} total={filtered.length} onPage={setPage} />}
      <div className="photo-picker-footer">
        <PhotoSelectionControls photos={filtered} selectedIds={selected} maxSelection={maxSelection} disabled={disabled}
          onSelect={(ids) => onChange([...new Set([...selected, ...ids])])} onClear={() => onChange([])} />
        {actions && <div className="form-actions">{actions}</div>}
      </div>
    </div>;
}
