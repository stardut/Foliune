import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import type { Photo } from '../lib/types';
import { PhotoImage } from './PhotoImage';
import { PhotoSelectionControls } from './PhotoSelectionControls';
import { EmptyState, IconButton, Modal } from './ui';
import { PageControls, PHOTO_PAGE_SIZE } from './PageControls';
import './photo-picker.css';

export function PhotoPicker({ photos, selectedIds, onConfirm, onClose, title = '从图库选择', maxSelection }: {
  photos: Photo[]; selectedIds: string[]; onConfirm: (ids: string[]) => void; onClose: () => void; title?: string; maxSelection?: number;
}) {
  const [selected, setSelected] = useState(() => [...new Set(selectedIds)]);
  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState<'all' | 'work' | 'collection'>('all');
  const [page, setPage] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return photos.filter((photo) => (library === 'all' || photo.library === library)
      && (!term || [photo.title, photo.originalName, photo.location, photo.project, ...photo.tags].join(' ').toLocaleLowerCase().includes(term)));
  }, [photos, query, library]);
  const actualPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / PHOTO_PAGE_SIZE) - 1));
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [actualPage, query, library]);
  const order = new Map(selected.map((id, index) => [id, index + 1]));
  const availableIds = new Set(photos.map((photo) => photo.id));
  const missingIds = selected.filter((id) => !availableIds.has(id));
  function toggle(id: string) { setSelected((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : maxSelection !== undefined && ids.length >= maxSelection ? ids : [...ids, id]); }
  return <Modal title={title} onClose={onClose} wide>
    <div className="photo-picker">
      <div className="photo-picker-tools">
        <div className="search-field"><Search size={16} /><input autoFocus aria-label="搜索图库照片" placeholder="搜索照片" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} />{query && <IconButton label="清空搜索" onClick={() => { setQuery(''); setPage(0); }}><X size={14} /></IconButton>}</div>
        <div className="segmented" aria-label="照片来源">{([['all', '全部'], ['work', '作品'], ['collection', '收藏']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={library === value} className={library === value ? 'active' : ''} onClick={() => { setLibrary(value); setPage(0); }}>{label}</button>)}</div>
      </div>
      <div ref={scroll} className="photo-picker-scroll" aria-label="图库照片">
      {!!missingIds.length && <div className="photo-picker-missing" role="status"><span>{missingIds.length} 张已选照片记录缺失</span>{missingIds.map((id) => <button type="button" className="text-button" key={id} onClick={() => toggle(id)} aria-label={`移除第 ${order.get(id)} 张缺失照片`}>移除第 {order.get(id)} 张<X size={12} /></button>)}</div>}
      {filtered.length ? <div className="photo-picker-grid">{filtered.slice(actualPage * PHOTO_PAGE_SIZE, (actualPage + 1) * PHOTO_PAGE_SIZE).map((photo) => <button key={photo.id} type="button" className={`photo-picker-item ${order.has(photo.id) ? 'is-selected' : ''}`} aria-pressed={order.has(photo.id)} disabled={!order.has(photo.id) && maxSelection !== undefined && selected.length >= maxSelection} aria-label={`${order.has(photo.id) ? '取消选择' : '选择'} ${photo.title || photo.originalName}`} onClick={() => toggle(photo.id)}>
        <PhotoImage photo={photo} lazy /><span className="photo-picker-check" aria-hidden="true">{order.has(photo.id) ? <><Check size={12} />{order.get(photo.id)}</> : <span />}</span>
      </button>)}</div> : <EmptyState title={photos.length ? '没有找到照片' : '图库还没有照片'} />}
      </div>
      <PageControls page={actualPage} total={filtered.length} onPage={setPage} />
      <div className="photo-picker-footer">
        <PhotoSelectionControls photos={filtered} selectedIds={selected} maxSelection={maxSelection}
          onSelect={(ids) => setSelected((current) => [...new Set([...current, ...ids])])} onClear={() => setSelected([])} />
        <div className="form-actions"><button type="button" className="button" onClick={onClose}>取消</button><button type="button" className="button button-primary" disabled={maxSelection !== undefined && selected.length > maxSelection} onClick={() => onConfirm(selected)}>确认选择</button></div>
      </div>
    </div>
  </Modal>;
}
