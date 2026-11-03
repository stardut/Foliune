import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Plus, X } from 'lucide-react';
import { PhotoImage } from '../../components/PhotoImage';
import { IconButton } from '../../components/ui';
import type { Photo } from '../../lib/types';
import { movePhoto } from './collage-layout';

export function CollageSequence({ ids, photos, activeId, disabled, onActive, onChange, onPick }: {
  ids: string[]; photos: Photo[]; activeId: string | null; disabled: boolean;
  onActive: (id: string) => void; onChange: (ids: string[]) => void; onPick: () => void;
}) {
  const [swap, setSwap] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const sequence = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: string; x: number; y: number; moved: boolean; target: number } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => { if (swap && !ids.includes(swap)) setSwap(null); }, [ids, swap]);
  function choose(id: string) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (swap && swap !== id) {
      const next = [...ids], a = ids.indexOf(swap), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) { [next[a], next[b]] = [next[b], next[a]]; onChange(next); } setSwap(null);
    }
    onActive(id);
  }
  return <section className="collage-sequence" aria-label="拼图选片" onKeyDown={(event) => { if (event.key === 'Escape' && swap) { event.preventDefault(); event.stopPropagation(); setSwap(null); } }}>
    <div className="collage-sequence-heading"><span>{swap ? '选择另一张交换' : `${ids.length} 张照片`}</span><div>
      <button type="button" className="text-button" disabled={disabled || ids.length < 2 || !activeId} aria-pressed={!!swap} onClick={() => setSwap(swap ? null : activeId)}><ArrowLeftRight size={14} />{swap ? '取消交换' : '交换'}</button>
      <button type="button" className="text-button" disabled={disabled} onClick={onPick}><Plus size={15} />选片</button></div></div>
    <div className={`collage-sequence-scroll ${dragging ? 'is-sorting' : ''}`} ref={sequence} role="list" onKeyDown={(event) => { if (event.key === 'Escape' && swap) { event.preventDefault(); event.stopPropagation(); setSwap(null); } }}>
      {ids.map((id, index) => {
        const photo = photos.find((candidate) => candidate.id === id); if (!photo) return null;
        return <div key={id} role="listitem" className={`collage-sequence-item ${activeId === id ? 'is-active' : ''} ${target === index && dragging !== id ? 'is-drop-target' : ''} ${dragging === id ? 'is-dragging' : ''}`}>
          <button type="button" className="collage-sequence-thumb" disabled={disabled} data-photo-id={id} aria-label={`第 ${index + 1} 张，${photo.title || photo.originalName}，Alt 加方向键排序`} aria-pressed={activeId === id} onClick={() => choose(id)}
            onPointerDown={(event) => { if (event.button !== 0 || disabled || swap) return; pointer.current = { id, x: event.clientX, y: event.clientY, moved: false, target: index }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={(event) => {
              const start = pointer.current; if (!start) return;
              if (!start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return;
              start.moved = true; setDragging(id);
              const scroller = sequence.current!;
              const bounds = scroller.getBoundingClientRect();
              if (event.clientX < bounds.left + 30) scroller.scrollLeft -= 16;
              if (event.clientX > bounds.right - 30) scroller.scrollLeft += 16;
              const cells = [...scroller.querySelectorAll<HTMLElement>('[data-photo-id]')];
              const distances = cells.map((cell) => { const rect = cell.getBoundingClientRect(); return Math.abs(event.clientX - (rect.left + rect.width / 2)); });
              start.target = distances.indexOf(Math.min(...distances)); setTarget(start.target);
            }}
            onPointerUp={(event) => {
              const start = pointer.current; pointer.current = null;
              if (start?.moved) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); onChange(movePhoto(ids, id, start.target)); onActive(id); }
              setDragging(null); setTarget(null); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }} onPointerCancel={() => { pointer.current = null; setDragging(null); setTarget(null); }}
            onKeyDown={(event) => {
              if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault(); onChange(movePhoto(ids, id, index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1))); onActive(id);
            }}><PhotoImage photo={photo} lazy /><span className="collage-sequence-number">{index + 1}</span></button>
          <div className="collage-sequence-remove"><IconButton label={`移除第 ${index + 1} 张照片`} disabled={disabled} onClick={() => onChange(ids.filter((candidate) => candidate !== id))}><X size={12} /></IconButton></div>
        </div>;
      })}
      {!ids.length && <button type="button" className="collage-empty-pick" onClick={onPick}><Plus size={20} />选择照片</button>}
    </div>
  </section>;
}
