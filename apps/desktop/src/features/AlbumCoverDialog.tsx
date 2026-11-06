import { useId, useRef, useState } from 'react';
import { PhotoImage } from '../components/PhotoImage';
import { Modal } from '../components/ui';
import type { AlbumCover, Photo } from '../lib/types';
import { albumCoverStyle, shiftAlbumCover } from './album-cover';

export function AlbumCoverDialog({ photo, initialCover, busy, onClose, onSave }: {
  photo: Photo;
  initialCover?: AlbumCover | null;
  busy: boolean;
  onClose: () => void;
  onSave: (cover: AlbumCover) => Promise<void>;
}) {
  const [cover, setCover] = useState(() => initialCover?.photoId === photo.id
    ? initialCover : { photoId: photo.id, offsetX: .5, offsetY: .5, zoom: 1 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const instructionsId = useId();
  const editable = ready && !busy;
  function shift(frame: HTMLElement, dx: number, dy: number) {
    const bounds = frame.getBoundingClientRect();
    setCover((previous) => shiftAlbumCover(previous, photo, bounds, dx, dy));
  }
  function endDrag(id: number) {
    if (pointer.current?.id !== id) return;
    pointer.current = null;
    setDragging(false);
  }
  async function save() {
    if (!editable) return;
    setError('');
    try { await onSave(cover); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <Modal title="设置相簿封面" onClose={onClose} closeDisabled={busy}>
    <div className="album-cover-editor">
      <p id={instructionsId} className="sr-only">拖动照片或使用方向键调整取景。</p>
      <div className="album-cover album-cover-editor-frame" role="group" aria-label="封面取景" aria-describedby={instructionsId}
        style={albumCoverStyle(cover)} tabIndex={editable ? 0 : undefined}
        data-editable={editable || undefined} data-dragging={dragging || undefined}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (!editable || event.button !== 0 || pointer.current) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const previous = pointer.current;
          if (!editable || previous?.id !== event.pointerId) return;
          shift(event.currentTarget, event.clientX - previous.x, event.clientY - previous.y);
          previous.x = event.clientX;
          previous.y = event.clientY;
        }}
        onPointerUp={(event) => endDrag(event.pointerId)} onLostPointerCapture={(event) => endDrag(event.pointerId)}
        onPointerCancel={(event) => endDrag(event.pointerId)}
        onKeyDown={(event) => {
          if (!editable) return;
          const step = event.shiftKey ? 32 : 8;
          const dx = event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0;
          const dy = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0;
          if (!dx && !dy) return;
          event.preventDefault();
          shift(event.currentTarget, dx, dy);
        }}>
        <PhotoImage photo={photo} onReadyChange={setReady} />
      </div>
      <label className="album-cover-zoom">
        缩放
        <input type="range" min={1} max={3} step={.01} value={cover.zoom} disabled={!editable}
          aria-valuetext={`${Math.round(cover.zoom * 100)}%`}
          onChange={(event) => setCover({ ...cover, zoom: Number(event.currentTarget.value) })} />
        <span aria-hidden="true">{Math.round(cover.zoom * 100)}%</span>
      </label>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="button button-primary" onClick={() => void save()} disabled={!editable}>{busy ? '正在保存…' : '保存封面'}</button>
      </div>
    </div>
  </Modal>;
}
