import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Photo } from '../lib/types';
import { PhotoImage } from './PhotoImage';
import { EmptyState } from './ui';
import { PageControls, PHOTO_PAGE_SIZE } from './PageControls';

export function PhotoSourceGrid({ photos, selectedIds, onToggle, totalSelected, maxSelection, emptyTitle, disabled = false }: {
  photos: Photo[]; selectedIds: string[]; onToggle: (id: string) => void; totalSelected: number;
  maxSelection?: number; emptyTitle: string; disabled?: boolean;
}) {
  const [page, setPage] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const actualPage = Math.min(page, Math.max(0, Math.ceil(photos.length / PHOTO_PAGE_SIZE) - 1));
  const order = new Map(selectedIds.map((id, index) => [id, index + 1]));
  useEffect(() => { setPage(0); }, [photos]);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [actualPage, photos]);
  return <>
    <div className="photo-picker-scroll" ref={scroll} aria-label="可选择的照片">
      {photos.length ? <div className="photo-picker-grid">{photos.slice(actualPage * PHOTO_PAGE_SIZE, (actualPage + 1) * PHOTO_PAGE_SIZE).map((photo) => {
        const selected = order.has(photo.id);
        return <button key={photo.id} type="button" className={`photo-picker-item ${selected ? 'is-selected' : ''}`} aria-pressed={selected}
          disabled={disabled || (!selected && maxSelection !== undefined && totalSelected >= maxSelection)}
          aria-label={`${selected ? '取消选择' : '选择'} ${photo.title || photo.originalName}`} onClick={() => onToggle(photo.id)}>
          <PhotoImage photo={photo} lazy /><span className="photo-picker-check" aria-hidden="true">{selected ? <><Check size={12} />{order.get(photo.id)}</> : <span />}</span>
        </button>;
      })}</div> : <EmptyState title={emptyTitle} />}
    </div>
    <PageControls page={actualPage} total={photos.length} onPage={setPage} />
  </>;
}
