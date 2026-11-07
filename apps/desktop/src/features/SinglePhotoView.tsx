import type { ContextMenuPosition } from './use-context-menu';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import { Check, ImageOff } from 'lucide-react';
import type { Photo } from '../lib/types';
import { photoUnavailableLabel } from '../lib/photo-availability';
import { PhotoReviewImage, useReviewPresentation } from './PhotoReviewImage';
import { isPhotoMenuTracking } from './use-photo-menu';

type PhotoMenu = (photo: Photo, at: ContextMenuPosition, trigger: HTMLElement) => void;
export type SinglePhotoCursor = { id: string; index: number };
const FILMSTRIP_OVERSCAN = 4;

export function SinglePhotoView({ photos, selected, initialCursor, rememberCursor, onMenu, onRelink, busy, onLayoutReady, restorePhotoId, onPhotoRestored, onReveal }: {
  photos: Photo[]; selected: string[]; onMenu: PhotoMenu; onRelink: (photo: Photo) => Promise<void>;
  initialCursor: SinglePhotoCursor | null; rememberCursor: (cursor: SinglePhotoCursor) => void;
  busy: boolean; onLayoutReady: () => void;
  restorePhotoId?: string; onPhotoRestored: () => void;
  onReveal?: (elements: readonly Element[]) => void;
}) {
  const [request, setRequest] = useState(() => ({ ...(initialCursor ?? { id: photos[0].id, index: 0 }), direction: 0 }));
  const photoIndices = useMemo(() => new Map(photos.map((photo, index) => [photo.id, index])), [photos]);
  const indexOf = (position: SinglePhotoCursor) => photoIndices.get(position.id) ?? Math.min(position.index, photos.length - 1);
  const requestedIndex = indexOf(request);
  const requestedId = photos[requestedIndex].id;
  const reduced = !!useReducedMotion();
  const { state: images, controller } = useReviewPresentation(photos, requestedId, request.direction, reduced, photoIndices);
  const currentId = images.current?.photo.id;
  const currentIndex = currentId === undefined ? undefined : photoIndices.get(currentId);
  const current = currentIndex === undefined ? undefined : photos[currentIndex];
  const tabStopIndex = currentIndex ?? requestedIndex;
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const view = useRef<HTMLElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const activeThumbnail = useRef<HTMLButtonElement>(null);
  const restoringPhoto = useRef<{ id: string; focusOrigin: Element | null } | null>(null);
  const pitchProbe = useRef<HTMLSpanElement>(null);
  const pitch = useRef(0);
  const [thumbnailWindow, setThumbnailWindow] = useState({ start: 0, end: 0 });
  const [focusedThumbnailId, setFocusedThumbnailId] = useState<string | null>(null);
  const focusedIndex = focusedThumbnailId === null ? undefined : photoIndices.get(focusedThumbnailId);
  const visibleIndices = useMemo(() => {
    const { start, end } = thumbnailWindow;
    const indices = new Set([tabStopIndex]);
    if (focusedIndex !== undefined) indices.add(focusedIndex);
    for (let i = start; i < Math.min(end, photos.length); i++) indices.add(i);
    return [...indices].sort((a, b) => a - b);
  }, [tabStopIndex, focusedIndex, thumbnailWindow, photos.length]);
  const updateThumbnailWindow = useCallback(() => {
    const track = strip.current;
    if (!track || !pitch.current) return;
    const left = Math.max(0, track.scrollLeft);
    const start = Math.max(0, Math.floor(left / pitch.current) - FILMSTRIP_OVERSCAN);
    const end = Math.min(photos.length, Math.ceil((left + track.clientWidth) / pitch.current) + FILMSTRIP_OVERSCAN);
    setThumbnailWindow((current) => current.start === start && current.end === end ? current : { start, end });
  }, [photos.length]);
  const centerThumbnail = useCallback(() => {
    const track = strip.current;
    const item = activeThumbnail.current;
    if (!track || !item) return;
    const { clientLeft, clientWidth, scrollLeft, scrollWidth } = track;
    const viewportCenter = track.getBoundingClientRect().left + clientLeft + clientWidth / 2;
    const itemRect = item.getBoundingClientRect();
    const itemCenter = itemRect.left + itemRect.width / 2;
    const centeredScrollLeft = scrollLeft + itemCenter - viewportCenter;
    track.scrollLeft = Math.max(0, Math.min(centeredScrollLeft, scrollWidth - clientWidth));
    updateThumbnailWindow();
  }, [updateThumbnailWindow]);

  useLayoutEffect(() => {
    if (request.id !== requestedId || request.index !== requestedIndex) setRequest({ ...request, id: requestedId, index: requestedIndex });
  }, [request, requestedId, requestedIndex]);
  useLayoutEffect(() => {
    if (currentId !== undefined && currentIndex !== undefined) rememberCursor({ id: currentId, index: currentIndex });
    if (strip.current?.contains(document.activeElement)) activeThumbnail.current?.focus({ preventScroll: true });
    centerThumbnail();
  }, [currentId, currentIndex, tabStopIndex, rememberCursor, centerThumbnail]);
  useLayoutEffect(() => {
    if (restorePhotoId === undefined) { restoringPhoto.current = null; return; }
    const index = photoIndices.get(restorePhotoId);
    if (index !== undefined && restoringPhoto.current?.id !== restorePhotoId) {
      restoringPhoto.current = { id: restorePhotoId, focusOrigin: document.activeElement };
      if (requestedId !== restorePhotoId) { setRequest({ id: restorePhotoId, index, direction: 0 }); return; }
    }
    if (index === undefined || requestedId !== restorePhotoId) onPhotoRestored();
    else if (currentId === restorePhotoId) {
      if (document.activeElement === restoringPhoto.current?.focusOrigin || document.activeElement === document.body) {
        activeThumbnail.current?.focus({ preventScroll: true });
      }
      onPhotoRestored();
    }
  }, [restorePhotoId, requestedId, currentId, photoIndices, onPhotoRestored]);
  useLayoutEffect(() => {
    const track = strip.current;
    const probe = pitchProbe.current;
    if (!track || !probe) return;
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => { frame = null; updateThumbnailWindow(); });
    };
    let width = 0;
    const measure = () => {
      // The CSS pitch can be fractional and also changes with viewport height.
      const nextPitch = probe.getBoundingClientRect().width;
      if (pitch.current === nextPitch && width === track.clientWidth) return;
      pitch.current = nextPitch;
      width = track.clientWidth;
      centerThumbnail();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    observer.observe(probe);
    track.addEventListener('scroll', schedule, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      track.removeEventListener('scroll', schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [centerThumbnail, updateThumbnailWindow]);
  useLayoutEffect(onLayoutReady, [onLayoutReady]);
  useLayoutEffect(() => {
    if (current && view.current) onReveal?.([view.current]);
  }, [current, onReveal]);

  useEffect(() => {
    const album = strip.current?.closest('.library-workspace');
    function navigate(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (isPhotoMenuTracking() || document.querySelector('dialog[open]') || album?.querySelector('.album-detail-header [aria-expanded="true"]')) return;
      const target = event.target;
      if (target instanceof Element && target !== document.body && target !== document.documentElement
        && (!album?.contains(target) || target.closest('input, textarea, select, [contenteditable], .album-sort'))) return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      setRequest((previous) => {
        const nextIndex = indexOf(previous) + direction;
        const next = photos[nextIndex];
        return next ? { id: next.id, index: nextIndex, direction } : previous;
      });
    }
    window.addEventListener('keydown', navigate);
    return () => window.removeEventListener('keydown', navigate);
  }, [photos, photoIndices]);

  return <section ref={view} className="album-single-view" aria-label="单张浏览">
    <div className="album-single-stage" aria-busy={images.waiting} onContextMenu={(event) => {
      event.preventDefault(); event.stopPropagation();
      if (!images.outgoing && current && activeThumbnail.current) onMenu(current, { x: event.clientX, y: event.clientY, source: 'mouse' }, activeThumbnail.current);
    }}>
      <PhotoReviewImage state={images} controller={controller} onRelink={onRelink} busy={busy} allowZoom={false} />
    </div>
    <div className="album-filmstrip" ref={strip} role="group" aria-label="照片缩略图" aria-keyshortcuts="ArrowLeft ArrowRight"
      onFocus={(event) => {
        const target = thumbnailTarget(event.target);
        if (target) setFocusedThumbnailId(photos[Number(target.dataset.photoIndex)].id);
      }}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setFocusedThumbnailId(null);
      }}
      onClick={(event) => {
        const target = thumbnailTarget(event.target);
        if (!target) return;
        const photoIndex = Number(target.dataset.photoIndex);
        target.focus({ preventScroll: true });
        if (photoIndex === tabStopIndex) centerThumbnail();
        setRequest((previous) => {
          const direction = Math.sign(photoIndex - indexOf(previous));
          return direction ? { id: photos[photoIndex].id, index: photoIndex, direction } : previous;
        });
      }}
      onContextMenu={(event) => {
        const target = thumbnailTarget(event.target);
        if (!target) return;
        event.preventDefault(); event.stopPropagation();
        target.focus({ preventScroll: true });
        onMenu(photos[Number(target.dataset.photoIndex)], { x: event.clientX, y: event.clientY, source: 'mouse' }, target);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        const target = thumbnailTarget(event.target);
        if (!target) return;
        event.preventDefault(); event.stopPropagation();
        const rect = target.getBoundingClientRect();
        onMenu(photos[Number(target.dataset.photoIndex)], { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, source: 'position' }, target);
      }}>
      <div className="album-filmstrip-track" style={{ '--filmstrip-count': photos.length } as CSSProperties}>
        <span className="album-filmstrip-pitch" ref={pitchProbe} aria-hidden="true" />
        {visibleIndices.map((photoIndex) => {
          const photo = photos[photoIndex];
          return <Thumbnail key={photo.id} photo={photo} index={photoIndex}
            selected={selectedIds.has(photo.id)} current={photoIndex === currentIndex} activeRef={photoIndex === tabStopIndex ? activeThumbnail : undefined} />;
        })}
      </div>
    </div>
    {current && <span className="sr-only" role="status">第 {tabStopIndex + 1} / {photos.length} 张：{current.title || current.originalName}</span>}
  </section>;
}

function thumbnailTarget(target: EventTarget) {
  return target instanceof Element ? target.closest<HTMLButtonElement>('.album-filmstrip-thumb') : null;
}

const Thumbnail = memo(function Thumbnail({ photo, index, selected, current, activeRef }: {
  photo: Photo; index: number; selected: boolean; current: boolean; activeRef?: RefObject<HTMLButtonElement | null>;
}) {
  const [failedUrl, setFailedUrl] = useState('');
  const name = photo.title || photo.originalName;
  const unavailable = photo.availability && (!photo.originalAvailable || !photo.thumbnailAvailable);
  return <button type="button" className="album-filmstrip-thumb" ref={activeRef} data-photo-index={index} style={{ '--filmstrip-index': index } as CSSProperties}
    aria-current={current || undefined} aria-label={`第 ${index + 1} 张：${name}${selected ? '，已选择' : ''}${unavailable ? `，${photoUnavailableLabel(photo)}` : ''}`} title={name} tabIndex={activeRef ? 0 : -1}>
    {!unavailable && photo.thumbnailAvailable && photo.thumbnailUrl !== failedUrl
      ? <img src={photo.thumbnailUrl} alt="" draggable={false} loading="lazy" decoding="async" onError={() => setFailedUrl(photo.thumbnailUrl)} />
      : <ImageOff size={18} strokeWidth={1.2} aria-hidden="true" />}
    {selected && <span className="photo-check album-filmstrip-check" aria-hidden="true"><Check size={12} /></span>}
  </button>;
});
