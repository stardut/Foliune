import { Check } from 'lucide-react';
import type { Photo } from '../lib/types';
import { PhotoImage } from './PhotoImage';
import { EmptyState } from './ui';

export function PhotoSourceGrid({ photos, selectedIds, onToggle, totalSelected, maxSelection, emptyTitle,
  disabled = false, previewOnly = false, loadingNext = false }: {
  photos: Photo[]; selectedIds: string[]; onToggle: (id: string) => void; totalSelected: number;
  maxSelection?: number; emptyTitle: string; disabled?: boolean; previewOnly?: boolean; loadingNext?: boolean;
}) {
  const order = new Map(selectedIds.map((id, index) => [id, index + 1]));
  return <div className="photo-picker-scroll" aria-label={previewOnly ? '已获取的照片预览' : '可选择的照片'}>
    {photos.length || loadingNext ? <div className="photo-picker-grid">
      {loadingNext && <div className="photo-picker-placeholder" aria-hidden="true"><span /><span /><span /></div>}
      {photos.map((photo) => {
        const selected = order.has(photo.id);
        return <button key={photo.id} type="button" className={`photo-picker-item ${!previewOnly && selected ? 'is-selected' : ''}`}
          data-preview={previewOnly || undefined} aria-pressed={previewOnly ? undefined : selected}
          disabled={previewOnly || disabled || (!selected && maxSelection !== undefined && totalSelected >= maxSelection)}
          aria-label={`${previewOnly ? '预览' : selected ? '取消选择' : '选择'} ${photo.title || photo.originalName}`} onClick={() => onToggle(photo.id)}>
          <PhotoImage photo={photo} lazy />{!previewOnly && <span className="photo-picker-check" aria-hidden="true">{selected ? <><Check size={12} />{order.get(photo.id)}</> : <span />}</span>}
        </button>;
      })}
    </div> : !previewOnly && <EmptyState title={emptyTitle} />}
  </div>;
}
