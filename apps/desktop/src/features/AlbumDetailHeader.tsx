import { ArrowLeft, CheckCheck, Grid2X2, Image, ImagePlus, LayoutTemplate, MoreHorizontal, Play, Radio, Trash2, Undo2, X } from 'lucide-react';
import { DropdownMenu } from '../components/DropdownMenu';
import { albumSortIcons, photoSortLabels } from './AlbumSortButton';
import type { PhotoSort, WorkView } from './library-photo-order';

export type AlbumPhotoLayout = 'exhibition' | 'grid' | 'single';
const layouts = [
  { id: 'exhibition', label: '展览', Icon: LayoutTemplate },
  { id: 'grid', label: '总览', Icon: Grid2X2 },
  { id: 'single', label: '单张', Icon: Image },
] as const;
const photoSortOptions = Object.keys(photoSortLabels) as PhotoSort[];
const workViewOptions = [{ id: 'none', label: '不分组' }, { id: 'location', label: '地点' }, { id: 'project', label: '项目' }] as const;

export function AlbumDetailHeader({ name, homeTitle, discarded, activeLabel, canImport, canPlay, canSort, selection, airDrop, layout, sort, onBack, onImport, onPlay, onStatus, onLayout, onSort, workView, onWorkView, onBeforeMenuOpen, onMenuOpenChange, onFocusWall }: {
  name: string; homeTitle: string; discarded: boolean; activeLabel: string;
  canImport: boolean; canPlay: boolean; canSort: boolean; layout: AlbumPhotoLayout;
  selection?: { allSelected: boolean; disabled: boolean; run: () => void };
  airDrop?: { label: string; disabled: boolean; run: () => void };
  sort: PhotoSort; onSort: (sort: PhotoSort) => void;
  onBack: () => void; onImport: () => void; onPlay: () => void;
  onStatus: (discarded: boolean) => void; onLayout: (layout: AlbumPhotoLayout) => void;
  workView?: WorkView; onWorkView?: (view: WorkView) => void;
  onMenuOpenChange?: (open: boolean) => void;
  onBeforeMenuOpen: () => void;
  onFocusWall?: () => boolean;
}) {
  return <header className="album-detail-header">
    <button type="button" className="icon-button" aria-label={`返回${homeTitle}`} title={`返回${homeTitle}`} onClick={onBack}><ArrowLeft size={18} /></button>
    <div className="album-detail-title"><h1 title={name}>{name}</h1>{discarded && <><span className="album-discarded-label">已废弃</span><button type="button" className="text-button album-return" onClick={() => onStatus(false)}>返回{activeLabel}</button></>}</div>
    <div className="album-view-options" role="group" aria-label="显示方式">
      {layouts.map(({ id, label, Icon }) => <button key={id} type="button" className={`icon-button ${layout === id ? 'is-active' : ''}`} aria-pressed={layout === id} aria-label={label} title={label} onClick={() => onLayout(id)}><Icon size={17} aria-hidden="true" /></button>)}
    </div>
    <DropdownMenu label="相簿操作" triggerLabel="相簿更多操作" title="更多" icon={<MoreHorizontal size={20} aria-hidden="true" />}
      onBeforeOpen={onBeforeMenuOpen} onOpenChange={onMenuOpenChange} onTabForward={onFocusWall} groups={[
        { items: [
          { id: 'import', label: '导入照片', icon: <ImagePlus size={15} aria-hidden="true" />, disabled: !canImport, run: onImport },
          ...(selection ? [{ id: 'select-all', label: selection.allSelected ? '取消全选' : '全选', icon: selection.allSelected ? <X size={15} aria-hidden="true" /> : <CheckCheck size={15} aria-hidden="true" />, disabled: selection.disabled, run: selection.run }] : []),
          { id: 'play', label: '欣赏', icon: <Play size={15} aria-hidden="true" />, disabled: !canPlay, run: onPlay },
          ...(airDrop ? [{ id: 'air-drop', label: airDrop.label, icon: <Radio size={15} aria-hidden="true" />, disabled: airDrop.disabled, run: airDrop.run }] : []),
          { id: 'status', label: discarded ? `返回${activeLabel}` : '查看已废弃', icon: discarded ? <Undo2 size={15} aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />, run: () => onStatus(!discarded) },
        ] },
        { label: '照片排序', items: photoSortOptions.map((id) => {
          const Icon = albumSortIcons[id];
          return { id, label: photoSortLabels[id], icon: <Icon size={15} aria-hidden="true" />, checked: sort === id, disabled: !canSort, run: () => onSort(id) };
        }) },
        ...(workView ? [{ label: '分组方式', compact: true, items: workViewOptions.map(({ id, label }) => ({
          id, label, checked: workView === id, run: () => onWorkView?.(id),
        })) }] : []),
      ]} />
  </header>;
}
