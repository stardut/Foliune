import { t } from '../lib/i18n.ts';
import type { Photo } from '../lib/types';

export function PhotoSelectionControls({ photos, selectedIds, maxSelection, disabled = false, onSelect, onClear }: {
  photos: Photo[];
  selectedIds: string[];
  maxSelection?: number;
  disabled?: boolean;
  onSelect: (ids: string[]) => void;
  onClear: () => void;
}) {
  const selected = new Set(selectedIds);
  const unselected = [...new Set(photos.map((photo) => photo.id))].filter((id) => !selected.has(id));
  const remaining = maxSelection === undefined ? unselected.length : Math.max(0, maxSelection - selected.size);
  const label = unselected.length > remaining ? t(`选满 ${maxSelection} 张`, `Select up to ${maxSelection}`) : t('全选', 'Select All');

  return <div className="photo-picker-selection">
    <span role="status">{t(`已选 ${selected.size} 张`, `${selected.size} selected`)}{maxSelection !== undefined ? t(` / 最多 ${maxSelection} 张`, ` / ${maxSelection} max`) : ''}</span>
    <button type="button" className="text-button" disabled={disabled || !unselected.length || !remaining}
      onClick={() => onSelect(unselected.slice(0, remaining))}>{label}</button>
    <button type="button" className="text-button" disabled={disabled || !selected.size} onClick={onClear}>{t('取消全选', 'Clear Selection')}</button>
  </div>;
}
