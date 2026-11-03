import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BookPlus, Check, Grid2X2, LayoutTemplate, MoreHorizontal, X } from 'lucide-react';
import type { Photo } from '../lib/types';
import { EmptyState, IconButton } from '../components/ui';
import { PhotoImage } from '../components/PhotoImage';
import { exhibitionLayout, type ExhibitionTile } from './exhibition-layout';

export function PhotoCanvas({ photos, selected, onSelect, onPreview, onMenu, layout, emptyAction, onRelink, busy }: {
  photos: Photo[]; selected: string[]; onSelect: (id: string) => void; onPreview: (photo: Photo) => void;
  layout: 'exhibition' | 'grid'; emptyAction?: ReactNode;
  onRelink: (photo: Photo) => Promise<void>; busy: boolean;
  onMenu: (photo: Photo, at: { x: number; y: number }, trigger: HTMLElement) => void;
}) {
  const reduce = useReducedMotion();
  const selecting = selected.length > 0;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 1120, height: 880 });
  // Selection and hover do not rerun the geometric search. The signature also
  // remains stable when the parent creates a fresh paginated array on render.
  const dimensions = JSON.stringify(photos.map(({ width, height }) => [width, height]));
  const blocks = useMemo(() => layout === 'exhibition'
    ? exhibitionLayout((JSON.parse(dimensions) as number[][]).map(([width, height]) => ({ width, height })), bounds.width, bounds.height)
    : [], [dimensions, bounds.width, bounds.height, layout]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setBounds({ width: canvas.clientWidth, height: window.innerHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [photos.length > 0]);
  if (!photos.length) return <EmptyState title="暂无照片" action={emptyAction} />;
  function item(photo: Photo, position: number, tile?: ExhibitionTile) {
    return <motion.article key={photo.id} data-photo-id={photo.id} initial={false} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.18 }} style={tile ? { left: tile.x, top: tile.y, width: tile.width, height: tile.height, '--photo-height': `${tile.height}px` } as CSSProperties : undefined} className={`photo-item ${selected.includes(photo.id) ? 'photo-selected' : ''}`}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); const trigger = event.currentTarget.querySelector<HTMLButtonElement>('.photo-interaction-target'); if (trigger) onMenu(photo, { x: event.clientX, y: event.clientY }, trigger); }}
      onKeyDown={(event) => {
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault(); event.stopPropagation();
        const trigger = event.target as HTMLElement;
        const rect = trigger.getBoundingClientRect();
        onMenu(photo, { x: rect.left + Math.min(rect.width, 24), y: rect.top + Math.min(rect.height, 32) }, trigger);
      }}>
        <div className="photo-image">
          <PhotoImage photo={photo} lazy={position > 5} onRelink={onRelink} busy={busy} />
          <button type="button" className="photo-interaction-target"
            aria-label={`${selecting ? selected.includes(photo.id) ? '取消选择' : '选择' : '预览'} ${photo.title || photo.originalName}`}
            aria-pressed={selecting ? selected.includes(photo.id) : undefined}
            onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); if (selecting) onSelect(photo.id); else onPreview(photo); }} />
          {selecting && <span className="photo-check" aria-hidden="true"><Check size={13} /></span>}
        </div>
      </motion.article>;
  }
  return <div ref={canvasRef} className={`photo-canvas ${layout} ${bounds.width < 760 ? 'canvas-compact' : ''}`}>
    {layout === 'grid' ? photos.map((photo, position) => item(photo, position)) : blocks.map((block) =>
      <div className="exhibition-group" key={photos[block.start].id} style={{ height: block.height }}>{block.tiles.map((tile) => item(photos[tile.index], tile.index, tile))}</div>)}
  </div>;
}

export function SelectionBar({ count, busy, onClear, onBook, onMore, onSocial, onCollage }: { count: number; busy: boolean; onClear: () => void; onBook: () => void; onSocial?: () => void; onCollage?: () => void; onMore: (at: { x: number; y: number }, trigger: HTMLElement) => void }) {
  const reduce = useReducedMotion();
  if (count === 0) return null;
  return <motion.div className="selection-bar" initial={false} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.15 }} role="toolbar" aria-label="照片操作"><span aria-live="polite">已选 {count} 张</span><button type="button" className="text-button selection-book" onClick={onBook} disabled={busy}><BookPlus size={15} />加入画册</button>{onCollage && <button type="button" className="text-button" onClick={onCollage} disabled={busy}><Grid2X2 size={15} />拼图</button>}{onSocial && <button type="button" className="text-button selection-social" onClick={onSocial} disabled={busy}><LayoutTemplate size={15} />模拟排版</button>}<button type="button" className="icon-button" aria-label={`所选 ${count} 张照片的更多操作`} title="更多操作" aria-haspopup="menu" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMore({ x: rect.left, y: rect.top }, event.currentTarget); }}><MoreHorizontal size={18} /></button><IconButton label="取消选择" onClick={onClear}><X size={16} /></IconButton></motion.div>;
}
