import { t } from '../lib/i18n.ts';
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
  return <div className="photo-picker-scroll" aria-label={previewOnly ? t('已获取的照片预览', 'Downloaded photo previews') : t('可选择的照片', 'Available photos')}>
    {photos.length || loadingNext ? <div className="photo-picker-grid">
      {loadingNext && <div className="photo-picker-placeholder" aria-hidden="true"><span /><span /><span /></div>}
      {photos.map((photo) => {
        const selected = order.has(photo.id);
        return <button key={photo.id} type="button" className={`photo-picker-item ${!previewOnly && selected ? 'is-selected' : ''}`}
          data-preview={previewOnly || undefined} aria-pressed={previewOnly ? undefined : selected}
          disabled={previewOnly || disabled || (!selected && maxSelection !== undefined && totalSelected >= maxSelection)}
          aria-label={`${previewOnly ? t('预览', 'Preview') : selected ? t('取消选择', 'Deselect') : t('选择', 'Select')} ${photo.title || photo.originalName}`} onClick={() => onToggle(photo.id)}>
          <PhotoImage photo={photo} lazy />{!previewOnly && <span className="photo-picker-check" aria-hidden="true">{selected ? <><Check size={12} />{order.get(photo.id)}</> : <span />}</span>}
        </button>;
      })}
    </div> : !previewOnly && <EmptyState title={emptyTitle} />}
  </div>;
}
