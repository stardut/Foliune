import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { ImageOff } from 'lucide-react';
import type { Photo } from '../../lib/types';
import { originalReadUrl, photoUnavailableLabel } from '../../lib/photo-availability';
import { cropFor, type CollageLayout, type CollageState, type PhotoCrop } from './collage-layout';

export function CollagePreview({ state, layout, photos, activeId, editing, disabled, onSelect, onEdit, onCrop, onSwap }: {
  state: CollageState; layout: CollageLayout; photos: Photo[]; activeId: string | null; editing: boolean; disabled: boolean;
  onSwap: (first: string, second: string) => void;
  onSelect: (id: string) => void; onEdit: (id: string) => void; onCrop: (id: string, crop: PhotoCrop, commit: boolean) => void;
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth - 48, height: element.clientHeight - 48 });
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);
  const scale = Math.min(Math.max(1, size.width) / layout.width, Math.max(1, size.height) / layout.height);
  return <div className="collage-preview-stage" ref={stage}>
    <div className="collage-paper" aria-label="拼图预览" style={{ width: layout.width * scale, height: layout.height * scale, background: state.background }}>
      {layout.items.map((item) => {
        const photo = photos.find((candidate) => candidate.id === item.photoId)!;
        return <PreviewPhoto key={`${photo.id}:${photo.originalUrl}:${photo.originalAvailable}`} photo={photo} rect={{ x: item.x * scale, y: item.y * scale, width: item.width * scale, height: item.height * scale }} crop={cropFor(state, photo.id)}
          targeted={dropTarget === photo.id} onTarget={setDropTarget} onSwap={(target) => onSwap(photo.id, target)} active={activeId === photo.id} editing={editing && activeId === photo.id} disabled={disabled}
          onSelect={() => onSelect(photo.id)} onEdit={() => onEdit(photo.id)} onCrop={(crop, commit) => onCrop(photo.id, crop, commit)} />;
      })}
    </div>
  </div>;
}

function PreviewPhoto({ photo, rect, crop, active, editing, disabled, targeted, onTarget, onSwap, onSelect, onEdit, onCrop }: {
  photo: Photo; rect: { x: number; y: number; width: number; height: number }; crop: PhotoCrop;
  targeted: boolean; onTarget: (id: string | null) => void; onSwap: (id: string) => void;
  active: boolean; editing: boolean; disabled: boolean; onSelect: () => void; onEdit: () => void;
  onCrop: (crop: PhotoCrop, commit: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [readSession] = useState(() => crypto.randomUUID());
  const drag = useRef<{ x: number; y: number; crop: PhotoCrop; latest: PhotoCrop; moved: boolean; target: string | null; mode: 'crop' | 'swap' } | null>(null);
  const suppressClick = useRef(false);
  const factor = (crop.fit === 'contain' ? Math.min(rect.width / photo.width, rect.height / photo.height) : Math.max(rect.width / photo.width, rect.height / photo.height) * crop.zoom);
  const imageWidth = photo.width * factor, imageHeight = photo.height * factor;
  const left = (rect.width - imageWidth) * (crop.fit === 'contain' ? .5 : crop.offsetX);
  const top = (rect.height - imageHeight) * (crop.fit === 'contain' ? .5 : crop.offsetY);
  function endDrag(event: PointerEvent<HTMLButtonElement>, cancelled = false) {
    if (!drag.current) return;
    const start = drag.current;
    const value = cancelled ? start.crop : start.latest;
    drag.current = null; onTarget(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (start.mode === 'crop') onCrop(value, true);
    else if (start.moved && !cancelled) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); if (start.target) onSwap(start.target); }
  }
  return <button type="button" disabled={disabled} className={`collage-photo ${active ? 'is-active' : ''} ${editing ? 'is-editing' : ''} ${targeted ? 'is-swap-target' : ''}`} data-collage-photo={photo.id}
    style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} aria-label={`${photo.title || photo.originalName}${editing ? '，拖动调整裁切' : ''}`} aria-pressed={active}
    onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(); }} onDoubleClick={onEdit}
    onKeyDown={(event) => { if (editing && crop.fit === 'cover' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); const step = event.shiftKey ? .1 : .02; const clamp = (value: number) => Math.max(0, Math.min(1, value)); onCrop({ ...crop, offsetX: clamp(crop.offsetX + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0)), offsetY: clamp(crop.offsetY + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0)) }, true); } else if (event.key === 'Enter' && active) { event.preventDefault(); onEdit(); } }}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      if (editing && crop.fit === 'cover') event.preventDefault();
      drag.current = { x: event.clientX, y: event.clientY, crop, latest: crop, moved: false, target: null, mode: editing && crop.fit === 'cover' ? 'crop' : 'swap' }; event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      const start = drag.current; if (!start) return;
      if (start.mode === 'swap') {
        if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
        start.moved = true;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-collage-photo]');
        const id = target?.closest('.collage-paper') === event.currentTarget.closest('.collage-paper') ? target?.dataset.collagePhoto || null : null;
        start.target = id !== photo.id ? id : null; onTarget(start.target); return;
      }
      const clamp = (value: number) => Math.min(1, Math.max(0, value));
      const next = { ...start.crop, offsetX: imageWidth > rect.width ? clamp(start.crop.offsetX - (event.clientX - start.x) / (imageWidth - rect.width)) : .5, offsetY: imageHeight > rect.height ? clamp(start.crop.offsetY - (event.clientY - start.y) / (imageHeight - rect.height)) : .5 };
      start.latest = next; onCrop(next, false);
    }} onPointerUp={(event) => endDrag(event)} onPointerCancel={(event) => endDrag(event, true)}>
    {photo.originalAvailable && !failed ? <img src={originalReadUrl(photo, readSession)} alt="" draggable={false} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} style={{ width: imageWidth, height: imageHeight, left, top }} /> : <span className="collage-preview-missing"><ImageOff size={20} /><span>{photoUnavailableLabel(photo)}</span></span>}
    {!failed && photo.originalAvailable && !loaded && <span className="collage-preview-loading">读取原图…</span>}
  </button>;
}
