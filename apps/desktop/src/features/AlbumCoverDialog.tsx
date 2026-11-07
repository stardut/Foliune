import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { PhotoImage } from '../components/PhotoImage';
import { Modal } from '../components/ui';
import type { AlbumCover, Photo } from '../lib/types';
import { albumCoverRevision, albumCoverStageStyle, albumCoverStyle, resetAlbumCover, shiftAlbumCover, zoomAlbumCover } from './album-cover';

type PinchEvent = Event & { scale: number };

export function AlbumCoverDialog({ photo, albumName, photoCount, initialCover, busy, onClose, onSave }: {
  photo: Photo;
  albumName: string;
  photoCount: number;
  initialCover?: AlbumCover | null;
  busy: boolean;
  onClose: () => void;
  onSave: (cover: AlbumCover) => Promise<void>;
}) {
  const [cover, setCover] = useState(() => initialCover?.photoId === photo.id
    ? initialCover : resetAlbumCover(photo.id));
  const revision = albumCoverRevision(photo);
  const [readyRevision, setReadyRevision] = useState<string>();
  const onImageReady = useCallback((ready: boolean) => setReadyRevision(ready ? revision : undefined), [revision]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const coverRef = useRef(cover);
  coverRef.current = cover;
  const instructionsId = useId();
  const previewId = useId();
  const blocked = busy || saving;
  const ready = readyRevision === revision;
  const editable = ready && !blocked;
  // WebKit emits native gesture events for trackpads; Chromium uses Ctrl+wheel.
  // Native non-passive listeners are required to stop page zoom in both engines.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let pinchZoom: number | null = null;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (!editable || pinchZoom !== null) return;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? frame.clientHeight : 1);
      setCover((previous) => zoomAlbumCover(previous, photo, previous.zoom * Math.exp(-delta * .005)));
    };
    const start = (event: Event) => {
      event.preventDefault();
      if (editable) pinchZoom = coverRef.current.zoom;
    };
    const change = (event: Event) => {
      event.preventDefault();
      if (!editable || pinchZoom === null) return;
      const scale = (event as PinchEvent).scale;
      if (Number.isFinite(scale) && scale > 0) {
        const zoom = pinchZoom * scale;
        setCover((previous) => zoomAlbumCover(previous, photo, zoom));
      }
    };
    const end = (event: Event) => { event.preventDefault(); pinchZoom = null; };
    frame.addEventListener('wheel', wheel, { passive: false });
    frame.addEventListener('gesturestart', start, { passive: false });
    frame.addEventListener('gesturechange', change, { passive: false });
    frame.addEventListener('gestureend', end, { passive: false });
    return () => {
      frame.removeEventListener('wheel', wheel);
      frame.removeEventListener('gesturestart', start);
      frame.removeEventListener('gesturechange', change);
      frame.removeEventListener('gestureend', end);
    };
  }, [editable, photo]);
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
    setSaving(true);
    try { await onSave(cover); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  }
  return <Modal title="设置相簿封面" onClose={onClose} closeDisabled={blocked}>
    <div className="album-cover-editor">
      <p id={instructionsId} className="sr-only">拖动照片或使用方向键调整取景，Shift 加速。使用缩放滑块或触控板捏合调整大小。</p>
      <div className="album-cover-editor-layout">
        <div className="album-cover-editor-main">
          <div className="album-cover-editor-stage">
            <div ref={frameRef} className="album-cover album-cover-editor-frame" role="group" aria-label="封面取景" aria-describedby={instructionsId}
              style={albumCoverStageStyle(cover, photo)} tabIndex={editable ? 0 : undefined}
              data-editable={editable || undefined} data-dragging={dragging || undefined}
              onDragStart={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                if (!editable || event.button !== 0 || pointer.current) return;
                event.currentTarget.focus();
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
              <PhotoImage key={revision} photo={photo} original onReadyChange={onImageReady} />
              <div className="album-cover-crop-outline" aria-hidden="true">
                {dragging && <div className="album-cover-thirds" />}
              </div>
            </div>
          </div>
          <div className="album-cover-editor-tools">
            <label className="album-cover-zoom">
              缩放
              <input type="range" min={1} max={3} step={.01} value={cover.zoom} disabled={!editable}
                aria-valuetext={`${Math.round(cover.zoom * 100)}%`}
                onChange={(event) => { const zoom = Number(event.currentTarget.value); setCover((previous) => zoomAlbumCover(previous, photo, zoom)); }} />
              <span aria-hidden="true">{Math.round(cover.zoom * 100)}%</span>
            </label>
            <button type="button" className="text-button" disabled={!editable} onClick={() => setCover(resetAlbumCover(photo.id))}>重置</button>
            <button type="button" className="text-button album-cover-preview-toggle" disabled={!ready} aria-expanded={previewOpen} aria-controls={previewId}
              onClick={() => setPreviewOpen((previous) => !previous)}>预览</button>
          </div>
        </div>
        <aside id={previewId} className="album-cover-card-preview" data-expanded={previewOpen || undefined} aria-label="首页卡片预览">
          <div className="album-open">
            <div className="album-cover" style={albumCoverStyle(cover)}>
              {ready && <div className="image-asset"><img src={frameRef.current?.querySelector('img')?.getAttribute('src') ?? undefined} width={photo.width} height={photo.height} alt={photo.title || photo.originalName} /></div>}
            </div>
            <div className="album-caption"><div className="album-heading"><h2>{albumName}</h2><div className="album-caption-meta"><span className="album-count">{photoCount}<span>张</span></span></div></div></div>
          </div>
        </aside>
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <span className="sr-only" role="status">{saving ? '正在保存封面' : ''}</span>
      <div className="form-actions">
        <button type="button" className="button" onClick={onClose} disabled={blocked}>取消</button>
        <button type="button" className="button button-primary album-cover-save" onClick={() => void save()} disabled={!editable} aria-busy={saving}>
          {saving && <LoaderCircle size={14} className="spin" aria-hidden="true" />}
          {saving ? '正在保存…' : '保存封面'}
        </button>
      </div>
    </div>
  </Modal>;
}
