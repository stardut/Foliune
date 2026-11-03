import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, Check, ImagePlus, Info, MoreHorizontal, Play, Trash2, Undo2 } from 'lucide-react';
import { useDismiss } from '../components/beui/hooks/use-dismiss';

type PhotoLayout = 'exhibition' | 'grid';
type WorkView = 'time' | 'location' | 'project';

export function AlbumDetailHeader({ name, homeTitle, discarded, activeLabel, hasGroup, canImport, canPlay, layout, onBack, onImport, onPlay, onStatus, onLayout, onInfo, workView, onWorkView }: {
  name: string; homeTitle: string; discarded: boolean; activeLabel: string;
  hasGroup: boolean; canImport: boolean; canPlay: boolean; layout: PhotoLayout;
  onBack: () => void; onImport: () => void; onPlay: () => void;
  onStatus: (discarded: boolean) => void; onLayout: (layout: PhotoLayout) => void; onInfo: () => void;
  workView?: WorkView; onWorkView?: (view: WorkView) => void;
}) {
  const [open, setOpen] = useState(false);
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
  }
  return <header className="album-detail-header">
    <button type="button" className="icon-button" aria-label={`返回${homeTitle}`} title={`返回${homeTitle}`} onClick={onBack}><ArrowLeft size={18} /></button>
    <div className="album-detail-title"><h1 title={name}>{name}</h1>{discarded && <><span className="album-discarded-label">已废弃</span><button type="button" className="text-button album-return" onClick={() => onStatus(false)}>返回{activeLabel}</button></>}</div>
    <div className="album-more" ref={scopeRef} onKeyDown={onKeyDown} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
      <button type="button" className={`icon-button ${open ? 'is-active' : ''}`} ref={triggerRef} aria-label="相簿更多操作" title="更多" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={20} /></button>
      {open && <div id={panelId} className="album-more-panel" role="group" aria-label="相簿操作">
        <button type="button" disabled={!canImport} title={!hasGroup ? '请进入相簿后导入' : undefined} onClick={() => perform(onImport)}><ImagePlus size={15} /><span>导入照片</span></button>
        <button type="button" disabled={!canPlay} onClick={() => perform(onPlay)}><Play size={15} /><span>欣赏</span></button>
        {hasGroup && <button type="button" onClick={() => perform(() => onStatus(!discarded))}>{discarded ? <Undo2 size={15} /> : <Trash2 size={15} />}<span>{discarded ? `返回${activeLabel}` : '查看已废弃'}</span></button>}
        <div className="album-display-options" role="group" aria-label="显示方式"><span>显示方式</span>{([{ id: 'exhibition', label: '展览' }, { id: 'grid', label: '总览' }] as const).map((option) => <button type="button" key={option.id} aria-pressed={layout === option.id} onClick={() => perform(() => onLayout(option.id))}><span>{option.label}</span>{layout === option.id && <Check size={14} />}</button>)}</div>
        {workView && <div className="album-group-options" role="group" aria-label="分组方式"><span>分组方式</span><div>{([{ id: 'time', label: '时间' }, { id: 'location', label: '地点' }, { id: 'project', label: '项目' }] as const).map((option) => <button type="button" key={option.id} aria-pressed={workView === option.id} onClick={() => perform(() => onWorkView?.(option.id))}>{option.label}</button>)}</div></div>}
        {!hasGroup && <button type="button" onClick={() => perform(onInfo)}><Info size={15} /><span>相簿信息</span></button>}
      </div>}
    </div>
  </header>;
}
