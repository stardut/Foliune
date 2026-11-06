import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Photo } from '../lib/types';
import { PhotoImage } from './PhotoImage';
import { EmptyState } from './ui';
import { PageControls, PHOTO_PAGE_SIZE } from './PageControls';

export function PhotoSourceGrid({ photos, selectedIds, onToggle, totalSelected, maxSelection, emptyTitle,
  disabled = false, previewOnly = false, preservePosition = false, loadingNext = false }: {
  photos: Photo[]; selectedIds: string[]; onToggle: (id: string) => void; totalSelected: number;
  maxSelection?: number; emptyTitle: string; disabled?: boolean; previewOnly?: boolean; preservePosition?: boolean;
  loadingNext?: boolean;
}) {
  const [page, setPage] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const actualPage = Math.min(page, Math.max(0, Math.ceil(photos.length / PHOTO_PAGE_SIZE) - 1));
  const pageEnd = (actualPage + 1) * PHOTO_PAGE_SIZE;
  const showPlaceholder = loadingNext && photos.length < pageEnd;
  const order = new Map(selectedIds.map((id, index) => [id, index + 1]));
  const resetOnChange = preservePosition ? null : photos;
  useEffect(() => { setPage(0); }, [resetOnChange]);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [actualPage, resetOnChange]);
  return <>
    <div className="photo-picker-scroll" ref={scroll} aria-label={previewOnly ? '已获取的照片预览' : '可选择的照片'}>
      {photos.length || showPlaceholder ? <div className="photo-picker-grid">{photos.slice(actualPage * PHOTO_PAGE_SIZE, pageEnd).map((photo) => {
        const selected = order.has(photo.id);
        return <button key={photo.id} type="button" className={`photo-picker-item ${!previewOnly && selected ? 'is-selected' : ''}`}
          data-preview={previewOnly || undefined} aria-pressed={previewOnly ? undefined : selected}
          disabled={previewOnly || disabled || (!selected && maxSelection !== undefined && totalSelected >= maxSelection)}
          aria-label={`${previewOnly ? '预览' : selected ? '取消选择' : '选择'} ${photo.title || photo.originalName}`} onClick={() => onToggle(photo.id)}>
          <PhotoImage photo={photo} lazy />{!previewOnly && <span className="photo-picker-check" aria-hidden="true">{selected ? <><Check size={12} />{order.get(photo.id)}</> : <span />}</span>}
        </button>;
      })}
        {showPlaceholder && <div className="photo-picker-placeholder" aria-hidden="true"><span /><span /><span /></div>}
      </div> : !previewOnly && <EmptyState title={emptyTitle} />}
    </div>
    <PageControls page={actualPage} total={photos.length} onPage={setPage} />
  </>;
}
