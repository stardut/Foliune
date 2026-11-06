import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Grid2X2, Image, ImagePlus, LayoutTemplate, MoreHorizontal, Play, Radio, Trash2, Undo2 } from 'lucide-react';
import { useDismiss } from '../components/beui/hooks/use-dismiss';
import { AlbumSortButton, photoSortLabels } from './AlbumSortButton';
import type { PhotoSort, WorkView } from './library-photo-order';

export type AlbumPhotoLayout = 'exhibition' | 'grid' | 'single';
const layouts = [
  { id: 'exhibition', label: '展览', Icon: LayoutTemplate },
  { id: 'grid', label: '总览', Icon: Grid2X2 },
  { id: 'single', label: '单张', Icon: Image },
] as const;

export function AlbumDetailHeader({ name, homeTitle, discarded, activeLabel, canImport, canPlay, canSort, airDrop, layout, sort, onBack, onImport, onPlay, onStatus, onLayout, onSort, workView, onWorkView, onMenuOpenChange, onSortOpenChange, onFocusWall }: {
  name: string; homeTitle: string; discarded: boolean; activeLabel: string;
  canImport: boolean; canPlay: boolean; canSort: boolean; layout: AlbumPhotoLayout;
  airDrop?: { label: string; disabled: boolean; run: () => void };
  sort: PhotoSort; onSort: (sort: PhotoSort) => void;
  onBack: () => void; onImport: () => void; onPlay: () => void;
  onStatus: (discarded: boolean) => void; onLayout: (layout: AlbumPhotoLayout) => void;
  workView?: WorkView; onWorkView?: (view: WorkView) => void;
  onMenuOpenChange?: (open: boolean) => void;
  onSortOpenChange: (open: boolean) => void;
  onFocusWall?: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    onMenuOpenChange?.(open);
    return () => onMenuOpenChange?.(false);
  }, [open, onMenuOpenChange]);
  const panelId = useId();
  const scopeRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, scopeRef, { escape: false });
  function perform(action: () => void) {
    setOpen(false);
    triggerRef.current?.focus();
    action();
  }
  function onKeyDown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    if (!open && event.target === triggerRef.current && event.key === 'Tab' && !event.shiftKey
      && !event.altKey && !event.ctrlKey && !event.metaKey && onFocusWall?.()) event.preventDefault();
  }
  return <header className="album-detail-header">
    <button type="button" className="icon-button" aria-label={`返回${homeTitle}`} title={`返回${homeTitle}`} onClick={onBack}><ArrowLeft size={18} /></button>
    <div className="album-detail-title"><h1 title={name}>{name}</h1>{discarded && <><span className="album-discarded-label">已废弃</span><button type="button" className="text-button album-return" onClick={() => onStatus(false)}>返回{activeLabel}</button></>}</div>
    <AlbumSortButton label="照片排序" labels={photoSortLabels} value={sort} disabled={!canSort} onChange={onSort} onOpenChange={onSortOpenChange} />
    <div className="album-view-options" role="group" aria-label="显示方式">
      {layouts.map(({ id, label, Icon }) => <button key={id} type="button" className={`icon-button ${layout === id ? 'is-active' : ''}`} aria-pressed={layout === id} aria-label={label} title={label} onClick={() => onLayout(id)}><Icon size={17} aria-hidden="true" /></button>)}
    </div>
    <div className="album-more" ref={scopeRef} onKeyDown={onKeyDown} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
      <button type="button" className={`icon-button ${open ? 'is-active' : ''}`} ref={triggerRef} aria-label="相簿更多操作" title="更多" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={20} /></button>
      {open && <div id={panelId} className="album-more-panel" role="group" aria-label="相簿操作">
        <button type="button" disabled={!canImport} onClick={() => perform(onImport)}><ImagePlus size={15} /><span>导入照片</span></button>
        <button type="button" disabled={!canPlay} onClick={() => perform(onPlay)}><Play size={15} /><span>欣赏</span></button>
        {airDrop && <button type="button" disabled={airDrop.disabled} onClick={() => perform(airDrop.run)}><Radio size={15} aria-hidden="true" /><span>{airDrop.label}</span></button>}
        <button type="button" onClick={() => perform(() => onStatus(!discarded))}>{discarded ? <Undo2 size={15} /> : <Trash2 size={15} />}<span>{discarded ? `返回${activeLabel}` : '查看已废弃'}</span></button>
        {workView && <div className="album-group-options" role="group" aria-label="分组方式"><span>分组方式</span><div>{([{ id: 'none', label: '不分组' }, { id: 'location', label: '地点' }, { id: 'project', label: '项目' }] as const).map((option) => <button type="button" key={option.id} aria-pressed={workView === option.id} onClick={() => perform(() => onWorkView?.(option.id))}>{option.label}</button>)}</div></div>}
      </div>}
    </div>
  </header>;
}
