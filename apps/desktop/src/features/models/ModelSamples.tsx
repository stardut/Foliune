import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { ImageOff } from 'lucide-react';
import type { Photo } from '../../lib/types';
import { PhotoImage } from '../../components/PhotoImage';
import { PhotoReview } from '../PhotoReview';
import { useContextMenu, type ContextMenuAction, type ContextMenuPosition } from '../use-context-menu';

export function ModelSamples({ ids, coverId, photos, disabled, onChange, onCover, onRelink }: {
  ids: string[]; coverId: string | null; photos: Photo[]; disabled: boolean;
  onChange: (ids: string[]) => void; onCover: (id: string) => void; onRelink?: (photo: Photo) => Promise<void>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const map = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const ordered = ids.flatMap((id) => { const photo = map.get(id); return photo ? [photo] : []; });
  const context = JSON.stringify([ids, coverId, disabled]);
  const current = useRef({ context, disabled }); current.current = { context, disabled };
  const menu = useContextMenu('photo', context, setError);
  function open(id: string, at: ContextMenuPosition, trigger: HTMLElement) {
    if (disabled) return;
    const index = ids.indexOf(id);
    const allowed = () => current.current.context === context && !current.current.disabled;
    const action = (key: string, text: string, run: () => void, unavailable = false): ContextMenuAction => ({ id: key, text, run, allowed, disabled: unavailable });
    function move(offset: number) { const next = [...ids]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange(next); }
    void menu([
      action('preview', '查看大图', () => setPreview(id), !map.has(id)),
      action('cover', id === coverId ? '当前封面' : '设为封面', () => onCover(id), id === coverId || !map.has(id)),
      action('previous', '向前移动', () => move(-1), index <= 0),
      action('next', '向后移动', () => move(1), index >= ids.length - 1),
      action('remove', '移除样片', () => onChange(ids.filter((item) => item !== id))),
    ], at, trigger);
  }
  return <>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="model-samples">{ids.map((id, index) => {
      const photo = map.get(id);
      const label = photo ? `查看 ${photo.title || photo.originalName}` : `第 ${index + 1} 张样片记录缺失`;
      const menuTrigger = {
        'aria-label': id === coverId ? `${label}，当前封面` : label,
        'aria-haspopup': 'menu' as const,
        'aria-keyshortcuts': 'ContextMenu Shift+F10',
        onContextMenu(event: MouseEvent<HTMLElement>) {
          event.preventDefault();
          event.stopPropagation();
          open(id, { x: event.clientX, y: event.clientY, source: 'mouse' }, event.currentTarget);
        },
        onKeyDown(event: KeyboardEvent<HTMLElement>) {
          if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
          event.preventDefault();
          event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          open(id, { x: bounds.left + 16, y: bounds.top + 16, source: 'position' }, event.currentTarget);
        },
      };
      return <article className="model-sample" key={id}>
        {photo ? <button type="button" className="model-sample-image" disabled={disabled} onClick={() => setPreview(id)} {...menuTrigger}>
          <PhotoImage photo={photo} lazy />
        </button> : <div className="model-sample-image model-missing" role="img" tabIndex={disabled ? -1 : 0} aria-disabled={disabled || undefined} {...menuTrigger}>
          <ImageOff size={22} aria-hidden="true" />样片记录缺失
        </div>}
      </article>;
    })}</div>
    {preview && <PhotoReview photos={ordered} initialPhotoId={preview} context="模特样片" returnLabel="返回模特样片" busy={disabled} onClose={() => setPreview(null)} onRelink={onRelink ?? (async () => { throw new Error('请返回图库重新定位这张照片。'); })} />}
  </>;
}
