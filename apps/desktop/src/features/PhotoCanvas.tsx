import { memo, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { motion, useReducedMotion } from 'motion/react';
import { BookPlus, Check, Grid2X2, LayoutTemplate, MoreHorizontal, X } from 'lucide-react';
import type { Photo } from '../lib/types';
import { EmptyState, IconButton } from '../components/ui';
import { PhotoImage } from '../components/PhotoImage';
import type { ExhibitionTile } from './exhibition-layout';
import { visibleWallRange } from './photo-wall-layout';
import { photoWallViewport, usePhotoWall, useWallWindow } from './use-photo-wall';

interface PhotoActions {
  onSelect: (id: string) => void;
  onPreview: (photo: Photo, trigger: HTMLButtonElement) => void;
  onRelink: (photo: Photo) => Promise<void>;
  busy: boolean;
  onMenu: (photo: Photo, at: { x: number; y: number }, trigger: HTMLElement) => void;
}

export interface PhotoCanvasHandle {
  viewportPhoto: (preferredId?: string) => { id: string; index: number } | null;
  focusViewportPhoto: (preferredId?: string) => boolean;
}

export interface WallPhotoRestore {
  id: string;
  scrollTop?: number;
  focus?: true | HTMLElement;
}

function wallPhotoControl(canvas: HTMLDivElement | null, index: number, backwards: boolean) {
  const controls = canvas?.querySelector(`[data-photo-index="${index}"]`)?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
  return controls?.[backwards ? controls.length - 1 : 0];
}

function needsWallScroll(viewport: { top: number; bottom: number }, top: number, height: number) {
  const visible = Math.min(top + height, viewport.bottom) - Math.max(top, viewport.top);
  return visible < Math.min(viewport.bottom - viewport.top, height) - 1;
}

function revealWallTile(main: HTMLElement, viewport: { top: number; bottom: number }, top: number, height: number) {
  if (needsWallScroll(viewport, top, height)) {
    main.scrollTop = Math.max(0, main.scrollTop + top + height / 2 - (viewport.top + viewport.bottom) / 2);
  }
}

function focusWallPhoto(canvas: HTMLDivElement | null, index: number, backwards: boolean) {
  const control = wallPhotoControl(canvas, index, backwards);
  const main = canvas?.closest('main');
  if (!control || !canvas || !main) return false;
  const viewport = photoWallViewport(canvas, main);
  if (viewport.header) {
    const bounds = control.getBoundingClientRect();
    revealWallTile(main, viewport, bounds.top, bounds.height);
    control.focus({ preventScroll: true });
  } else control.focus();
  return true;
}

export function PhotoCanvas({ ref, photos, sections, selected, onSelect, onPreview, onMenu, layout, compactAlbumPair = false, emptyAction, onRelink, busy, onLayoutReady, restore, onRestored, onReveal }: PhotoActions & {
  ref?: Ref<PhotoCanvasHandle>;
  photos: Photo[]; sections?: [string, Photo[]][]; selected: string[];
  layout: 'exhibition' | 'grid'; compactAlbumPair?: boolean; emptyAction?: ReactNode; onLayoutReady?: () => void;
  restore?: WallPhotoRestore; onRestored?: (restore: WallPhotoRestore) => void;
  onReveal?: (elements: readonly Element[]) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [deferredFocus, setDeferredFocus] = useState<{ contentKey: string; index: number; from: HTMLElement } | null>(null);
  const orderedPhotos = useMemo(() => sections ? sections.flatMap(([, items]) => items) : photos, [photos, sections]);
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const contentKey = useMemo(() => JSON.stringify({
    compactAlbumPair,
    sections: (sections ?? [[undefined, photos]] as const).map(([heading, items]) => ({
      heading, photos: items.map(({ id, width, height }) => ({ id, width, height })),
    })),
  }), [photos, sections, compactAlbumPair]);
  const wall = usePhotoWall(canvasRef, contentKey, layout);
  useImperativeHandle(ref, () => {
    function viewportPhoto(preferredId?: string) {
      const canvas = canvasRef.current;
      const main = canvas?.closest('main');
      if (!canvas || !main || !orderedPhotos.length) return null;
      const geometry = wall.layout;
      if (!geometry) return null;
      const viewport = photoWallViewport(canvas, main);
      const bounds = canvas.getBoundingClientRect();
      const top = viewport.top - bounds.top;
      const height = viewport.bottom - viewport.top;
      const bottom = top + height;
      const [first, last] = visibleWallRange(geometry.units, top, height, 0);
      const x = viewport.left + viewport.width / 2 - bounds.left;
      const y = top + height / 3;
      const focused = canvas.contains(document.activeElement)
        ? document.activeElement?.closest<HTMLElement>('[data-photo-index]') : undefined;
      let focusedIndex: number | undefined;
      let index = 0;
      let best = Infinity;
      for (let i = first; i < last; i++) {
        const unit = geometry.units[i];
        for (const tile of unit.tiles) {
          const tileTop = unit.top + tile.y;
          if (tileTop >= bottom || tileTop + tile.height <= top) continue;
          if (orderedPhotos[tile.index].id === preferredId) return { id: preferredId, index: tile.index };
          if (focused?.dataset.photoIndex === String(tile.index)) focusedIndex = tile.index;
          const left = unit.left + tile.x;
          const distance = Math.hypot(Math.max(left - x, x - left - tile.width, 0),
            Math.max(tileTop - y, y - tileTop - tile.height, 0));
          if (distance < best) { best = distance; index = tile.index; }
        }
      }
      if (main.scrollTop > 0 && best === Infinity) return null;
      index = focusedIndex ?? (main.scrollTop <= 0 ? 0 : index);
      return { id: orderedPhotos[index].id, index };
    }
    return {
      viewportPhoto,
      focusViewportPhoto(preferredId) {
        const canvas = canvasRef.current;
        const main = canvas?.closest('main');
        if (!canvas || !main?.scrollTop) return false;
        const firstUnit = wall.layout?.units.find((unit) => unit.tiles.length);
        const firstTile = firstUnit?.tiles[0];
        if (!firstUnit || !firstTile) return false;
        const firstBottom = canvas.getBoundingClientRect().top + firstUnit.top + firstTile.y + firstTile.height;
        if (firstBottom > photoWallViewport(canvas, main).top) return false;
        const anchor = viewportPhoto(preferredId);
        if (!anchor) return false;
        flushSync(() => setFocusedIndex(anchor.index));
        return focusWallPhoto(canvas, anchor.index, false);
      },
    };
  }, [orderedPhotos, wall.layout]);
  const restoreIndex = useMemo(() => restore ? orderedPhotos.findIndex((photo) => photo.id === restore.id) : -1, [restore, orderedPhotos]);
  const requestedUnit = useMemo(() => restoreIndex >= 0
    ? wall.layout?.units.findIndex((unit) => unit.tiles.some((tile) => tile.index === restoreIndex)) ?? -1 : -1,
  [restoreIndex, wall.layout]);
  const restoreUnit = wall.pending ? -1 : requestedUnit;
  // Restore against the final height before measuring the virtual window.
  useLayoutEffect(() => { if (wall.layout && !wall.pending) onLayoutReady?.(); }, [wall.layout, wall.pending, onLayoutReady]);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const main = canvas?.closest('main');
    if (!restore || !canvas || !main || (wall.pending && !wall.error)) return;
    const unit = wall.layout?.units[restoreUnit];
    const tile = unit?.tiles.find((item) => item.index === restoreIndex);
    if (restore.scrollTop !== undefined) main.scrollTop = restore.scrollTop;
    else if (unit && tile) {
      const tileTop = canvas.getBoundingClientRect().top + unit.top + tile.y;
      revealWallTile(main, photoWallViewport(canvas, main), tileTop, tile.height);
    }
    if (restore.focus) {
      const control = restore.focus !== true && restore.focus.isConnected ? restore.focus
        : canvas.querySelector<HTMLButtonElement>(`[data-photo-index="${restoreIndex}"] .photo-interaction-target`);
      control?.focus({ preventScroll: true });
    }
    onRestored?.(restore);
  }, [restore, restoreIndex, restoreUnit, wall.layout, wall.pending, wall.error, onRestored]);
  const [start, end] = useWallWindow(canvasRef, wall.layout, restore);
  const queuedFocus = deferredFocus?.contentKey === contentKey && layout === 'exhibition' && !wall.error ? deferredFocus : null;
  const sourceIndex = queuedFocus ? queuedFocus.index - 1 : focusedIndex;
  const [focusedUnit, queuedUnit] = useMemo(() => [sourceIndex, queuedFocus?.index].map((index) => index == null ? -1
    : wall.layout?.units.findIndex((unit) => unit.tiles.some((tile) => tile.index === index)) ?? -1), [wall.layout, sourceIndex, queuedFocus]);
  const visibleUnits = useMemo(() => {
    if (!wall.layout) return [];
    const units = wall.layout.units;
    const indices = new Set(Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index));
    if (focusedUnit !== -1) indices.add(focusedUnit);
    if (queuedUnit !== -1) indices.add(queuedUnit);
    if (restoreUnit !== -1) indices.add(restoreUnit);
    return [...indices].sort((a, b) => a - b).map((index) => units[index]).filter(Boolean);
  }, [wall.layout, start, end, focusedUnit, queuedUnit, restoreUnit]);
  useLayoutEffect(() => {
    if (!onReveal) return;
    if (wall.error) { onReveal([]); return; }
    if (!wall.layout || !wall.current) return;
    const canvas = canvasRef.current;
    const main = canvas?.closest('main');
    if (!canvas || !main) return;
    const viewport = photoWallViewport(canvas, main);
    const canvasTop = canvas.getBoundingClientRect().top;
    if (restore && wall.pending) {
      // A tile already in view needs no final scroll correction.
      if (restore.scrollTop !== undefined) return;
      const unit = wall.layout.units[requestedUnit];
      const tile = unit?.tiles.find((item) => item.index === restoreIndex);
      if (!unit || !tile || needsWallScroll(viewport, canvasTop + unit.top + tile.y, tile.height)) return;
    }
    const top = viewport.top - canvasTop;
    const height = viewport.bottom - viewport.top;
    const [first, last] = visibleWallRange(wall.layout.units, top, height, 0);
    const elements: Element[] = [];
    // Wait for the virtual window to catch up with a restored scroll position.
    // Only the intersecting units animate, so the tall canvas stays inert.
    for (const unit of wall.layout.units.slice(first, last)) {
      if (unit.top + unit.height <= top || unit.top >= top + height) continue;
      const element = canvas.children[visibleUnits.indexOf(unit)];
      if (!element) return;
      elements.push(element);
    }
    if (elements.length) onReveal(elements);
  }, [onReveal, wall.layout, wall.current, wall.pending, wall.error, restore, restoreIndex, requestedUnit, visibleUnits]);
  useLayoutEffect(() => {
    if (!deferredFocus) return;
    // Resizing can move the same photo to a different block, replacing its DOM node.
    const sourceReplaced = queuedFocus && !queuedFocus.from.isConnected && document.activeElement === document.body;
    if (!queuedFocus || (document.activeElement !== queuedFocus.from && !sourceReplaced)) {
      setDeferredFocus(null);
    } else if (queuedUnit !== -1) {
      setDeferredFocus(null);
      focusWallPhoto(canvasRef.current, queuedFocus.index, false);
    } else if (sourceReplaced) {
      const replacement = wallPhotoControl(canvasRef.current, queuedFocus.index - 1, true);
      if (replacement) {
        setDeferredFocus({ ...queuedFocus, from: replacement });
        replacement.focus({ preventScroll: true });
      }
    }
  }, [deferredFocus, queuedFocus, queuedUnit, wall.layout]);
  if (!photos.length) return <EmptyState title="暂无照片" action={emptyAction} />;
  const lastIndex = wall.layout?.units.at(-1)?.tiles.at(-1)?.index ?? -1;
  const message = wall.error ? <p className="form-error photo-wall-message" role="alert">{wall.error}</p>
    : (!wall.layout || wall.partial) && <span className="photo-wall-message" role="status">正在准备照片…</span>;
  return <><div ref={canvasRef} className={`photo-canvas virtual-photo-wall ${layout}`} style={{ height: wall.layout?.height || 240 }} aria-busy={!wall.layout && !wall.error}
    data-layout-pending={wall.pending && !wall.error || undefined}
    onFocusCapture={(event) => {
      const article = (event.target as HTMLElement).closest<HTMLElement>('[data-photo-index]');
      if (article) setFocusedIndex(Number(article.dataset.photoIndex));
    }}
    onBlurCapture={(event) => {
      if (event.relatedTarget) setDeferredFocus(null);
      else {
        const source = event.target;
        // A blur during node removal may have no next focus target.
        queueMicrotask(() => {
          if (source.isConnected) setDeferredFocus((queued) => queued?.from === source ? null : queued);
        });
      }
      if (!event.currentTarget.contains(event.relatedTarget)) setFocusedIndex(null);
    }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
      setDeferredFocus(null);
      const target = event.target as HTMLElement;
      const article = target.closest<HTMLElement>('[data-photo-index]');
      if (!article) return;
      const controls = [...article.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (target !== controls[event.shiftKey ? 0 : controls.length - 1]) return;
      const next = Number(article.dataset.photoIndex) + (event.shiftKey ? -1 : 1);
      if (next < 0 || next >= orderedPhotos.length) return;
      if (next > lastIndex) {
        if (!wall.partial || wall.error) return;
        event.preventDefault();
        setDeferredFocus({ contentKey, index: next, from: target });
        return;
      }
      event.preventDefault();
      // Mount the neighbouring unit before native focus scrolls it into view.
      flushSync(() => setFocusedIndex(next));
      focusWallPhoto(canvasRef.current, next, event.shiftKey);
    }}>
    {!wall.layout && message}
    {visibleUnits.map((unit) => unit.heading !== undefined
      ? <div className="section-heading photo-wall-heading" key={`heading-${unit.heading}`} style={{ top: unit.top }}><h2 title={unit.heading}>{unit.heading}</h2></div>
      : <div className="exhibition-group photo-wall-unit" key={`photos-${orderedPhotos[unit.tiles[0].index].id}`} style={{ top: unit.top, left: unit.left, width: `calc(100% - ${unit.left * 2}px)`, height: unit.height }}>
        {unit.tiles.map((tile) => <PhotoTile key={orderedPhotos[tile.index].id} photo={orderedPhotos[tile.index]} tile={tile}
          selected={selectedIds.has(orderedPhotos[tile.index].id)} selecting={selected.length > 0}
          onSelect={onSelect} onPreview={onPreview} onMenu={onMenu} onRelink={onRelink} busy={busy} />)}
      </div>)}
  </div>{wall.layout && message}</>;
}

const PhotoTile = memo(function PhotoTile({ photo, tile, selected, selecting, onSelect, onPreview, onMenu, onRelink, busy }: PhotoActions & {
  photo: Photo; tile: ExhibitionTile; selected: boolean; selecting: boolean;
}) {
  return <article data-photo-id={photo.id} data-photo-index={tile.index}
    style={{ left: tile.x, top: tile.y, width: tile.width, height: tile.height, '--photo-height': `${tile.height}px` } as CSSProperties}
    className={`photo-item ${selected ? 'photo-selected' : ''}`}
    onContextMenu={(event) => {
      event.preventDefault(); event.stopPropagation();
      const trigger = event.currentTarget.querySelector<HTMLButtonElement>('.photo-interaction-target');
      if (trigger) onMenu(photo, { x: event.clientX, y: event.clientY }, trigger);
    }}
    onKeyDown={(event) => {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
      event.preventDefault(); event.stopPropagation();
      const trigger = event.target as HTMLElement;
      const rect = trigger.getBoundingClientRect();
      onMenu(photo, { x: rect.left + Math.min(rect.width, 24), y: rect.top + Math.min(rect.height, 32) }, trigger);
    }}>
    <div className="photo-image">
      <PhotoImage photo={photo} softReveal onRelink={onRelink} busy={busy} />
      <button type="button" className="photo-interaction-target"
        aria-label={`${selecting ? selected ? '取消选择' : '选择' : '预览'} ${photo.title || photo.originalName}`}
        aria-pressed={selecting ? selected : undefined}
        onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); if (selecting) onSelect(photo.id); else onPreview(photo, event.currentTarget); }} />
      {selecting && <span className="photo-check" aria-hidden="true"><Check size={13} /></span>}
    </div>
  </article>;
});

export function SelectionBar({ count, busy, onClear, onBook, onMore, onSocial, onCollage }: { count: number; busy: boolean; onClear: () => void; onBook: () => void; onSocial?: () => void; onCollage?: () => void; onMore: (at: { x: number; y: number }, trigger: HTMLElement) => void }) {
  const reduce = useReducedMotion();
  if (count === 0) return null;
  return <motion.div className="selection-bar" initial={false} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.15 }} role="toolbar" aria-label="照片操作"><span aria-live="polite">已选 {count} 张</span><button type="button" className="text-button selection-book" onClick={onBook} disabled={busy}><BookPlus size={15} />加入画册</button>{onCollage && <button type="button" className="text-button" onClick={onCollage} disabled={busy}><Grid2X2 size={15} />拼图</button>}{onSocial && <button type="button" className="text-button selection-social" onClick={onSocial} disabled={busy}><LayoutTemplate size={15} />模拟排版</button>}<button type="button" className="icon-button" aria-label={`所选 ${count} 张照片的更多操作`} title="更多操作" aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMore({ x: rect.left, y: rect.top }, event.currentTarget); }}><MoreHorizontal size={18} /></button><IconButton label="取消全选" onClick={onClear}><X size={16} /></IconButton></motion.div>;
}
