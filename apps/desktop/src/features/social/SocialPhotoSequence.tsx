import { t } from '../../lib/i18n';
import { useId, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from '../../components/ui';
import type { Photo } from '../../lib/types';
import { SocialThumbnail } from './SocialThumbnail';
import { movePhotoId, socialGridColumns } from './social-photo-order';
import { useSocialPhotoSort } from './useSocialPhotoSort';

export function SocialPhotoSequence({ ids, photos, onChange }: {
  ids: string[]; photos: Photo[]; onChange: (ids: string[]) => void;
}) {
  const instructionsId = useId();
  const [announcement, announce] = useState('');
  const { listRef, drag, start } = useSocialPhotoSort(ids, onChange, announce);
  const photosById = new Map(photos.map((photo) => [photo.id, photo]));
  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (drag || !event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const columns = socialGridColumns([...(listRef.current?.children ?? [])].map((item) => item.getBoundingClientRect()));
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns;
    const index = ids.indexOf(id);
    const target = Math.max(0, Math.min(ids.length - 1, index + delta));
    if (target === index) {
      announce(delta < 0 ? t('已是第一张照片', 'Already the first photo') : t('已是最后一张照片', 'Already the last photo'));
      return;
    }
    onChange(movePhotoId(ids, id, target));
    announce(t(`照片已移至第 ${target + 1} 张，共 ${ids.length} 张`, `Moved photo to position ${target + 1} of ${ids.length}`));
    const handle = event.currentTarget;
    requestAnimationFrame(() => {
      if (!handle.isConnected) return;
      handle.focus({ preventScroll: true });
      handle.scrollIntoView({ block: 'nearest' });
    });
  }
  function content(id: string, index: number) {
    return <><span className="social-sequence-thumb"><SocialThumbnail photo={photosById.get(id)} /></span><span className="social-sequence-number">{index + 1}</span></>;
  }
  return <>
    <p id={instructionsId} className="social-sort-sr">{t('拖动照片调整顺序。按住 Alt 后，左右方向键移动一张，上下方向键移动一行；末行不足时移至最后一张。拖动时按 Escape 取消。', 'Drag photos to reorder. Hold Alt and press Left or Right to move one position, or Up or Down to move one row. A shorter final row ends at the last photo. Press Escape while dragging to cancel.')}</p>
    <ol ref={listRef} className={`social-photo-sequence${drag ? ' is-sorting' : ''}`} aria-label={t('照片顺序', 'Photo Order')}>{ids.map((id, index) => {
      const photo = photosById.get(id);
      const name = photo ? photo.title || photo.originalName : t('照片引用缺失', 'Photo reference missing');
      return <li key={id} data-photo-id={id} className={drag?.id === id ? 'is-sort-placeholder' : undefined}>
        <button type="button" className="social-sequence-handle" aria-label={t(`第 ${index + 1} 张：${name}，拖动调整顺序`, `Photo ${index + 1}: ${name}. Drag to reorder`)} aria-describedby={instructionsId} aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown" title={name} onPointerDown={(event) => start(event, id)} onKeyDown={(event) => moveWithKeyboard(event, id)}>{content(id, index)}</button>
        <div className="social-sequence-actions"><IconButton label={t(`移除第 ${index + 1} 张：${name}`, `Remove photo ${index + 1}: ${name}`)} disabled={!!drag} onClick={() => onChange(ids.filter((photoId) => photoId !== id))}><X size={14} /></IconButton></div>
      </li>;
    })}</ol>
    <span className="social-sort-sr" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    {drag && createPortal(<div className={`social-sequence-drag${drag.valid ? '' : ' is-outside'}`} style={{ left: drag.left, top: drag.top, width: drag.width, height: drag.height }} aria-hidden="true">{content(drag.id, ids.indexOf(drag.id))}</div>, document.body)}
  </>;
}
