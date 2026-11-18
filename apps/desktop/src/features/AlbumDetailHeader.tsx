import { t } from '../lib/i18n';
import { ArrowLeft, CheckCheck, Grid2X2, Image, ImagePlus, LayoutTemplate, MapPin, MoreHorizontal, Play, Radio, Trash2, Undo2, X } from 'lucide-react';
import { DropdownMenu } from '../components/DropdownMenu';
import { albumSortIcons, photoSortLabels } from './AlbumSortButton';
import type { PhotoSort, WorkView } from './library-photo-order';

export type AlbumPhotoLayout = 'exhibition' | 'grid' | 'single';
const layouts = [
  { id: 'exhibition', label: t('展览', 'Exhibition'), Icon: LayoutTemplate },
  { id: 'grid', label: t('总览', 'Grid'), Icon: Grid2X2 },
  { id: 'single', label: t('单张', 'Single Photo'), Icon: Image },
] as const;
const photoSortOptions = Object.keys(photoSortLabels) as PhotoSort[];
const workViewOptions = [{ id: 'none', label: t('不分组', 'No Grouping') }, { id: 'location', label: t('地点', 'Location') }, { id: 'project', label: t('项目', 'Project') }] as const;

export function AlbumDetailHeader({ name, homeTitle, discarded, activeLabel, canImport, canPlay, canSort, selection, airDrop, shootingRegion, layout, sort, onBack, onImport, onPlay, onStatus, onLayout, onSort, workView, onWorkView, onBeforeMenuOpen, onMenuOpenChange, onFocusWall }: {
  name: string; homeTitle: string; discarded: boolean; activeLabel: string;
  canImport: boolean; canPlay: boolean; canSort: boolean; layout: AlbumPhotoLayout;
  selection?: { allSelected: boolean; disabled: boolean; run: () => void };
  airDrop?: { label: string; disabled: boolean; run: () => void };
  shootingRegion?: { label: string; disabled: boolean; run: () => void };
  sort: PhotoSort; onSort: (sort: PhotoSort) => void;
  onBack: () => void; onImport: () => void; onPlay: () => void;
  onStatus: (discarded: boolean) => void; onLayout: (layout: AlbumPhotoLayout) => void;
  workView?: WorkView; onWorkView?: (view: WorkView) => void;
  onMenuOpenChange?: (open: boolean) => void;
  onBeforeMenuOpen: () => void;
  onFocusWall?: () => boolean;
}) {
  return <header className="album-detail-header">
    <button type="button" className="icon-button" aria-label={t(`返回${homeTitle}`, `Back to ${homeTitle}`)} title={t(`返回${homeTitle}`, `Back to ${homeTitle}`)} onClick={onBack}><ArrowLeft size={18} /></button>
    <div className="album-detail-title"><h1 title={name}>{name}</h1>{discarded && <><span className="album-discarded-label">{t('已废弃', 'Rejected')}</span><button type="button" className="text-button album-return" onClick={() => onStatus(false)}>{t(`返回${activeLabel}`, `Back to ${activeLabel}`)}</button></>}</div>
    <div className="album-view-options" role="group" aria-label={t('显示方式', 'View Mode')}>
      {layouts.map(({ id, label, Icon }) => <button key={id} type="button" className={`icon-button ${layout === id ? 'is-active' : ''}`} aria-pressed={layout === id} aria-label={label} title={label} onClick={() => onLayout(id)}><Icon size={17} aria-hidden="true" /></button>)}
    </div>
    <DropdownMenu label={t('相簿操作', 'Album Actions')} triggerLabel={t('相簿更多操作', 'More Album Actions')} title={t('更多', 'More')} icon={<MoreHorizontal size={20} aria-hidden="true" />}
      onBeforeOpen={onBeforeMenuOpen} onOpenChange={onMenuOpenChange} onTabForward={onFocusWall} groups={[
        { items: [
          { id: 'import', label: t('导入照片', 'Import Photos'), icon: <ImagePlus size={15} aria-hidden="true" />, disabled: !canImport, run: onImport },
          ...(selection ? [{ id: 'select-all', label: selection.allSelected ? t('取消全选', 'Deselect All') : t('全选', 'Select All'), icon: selection.allSelected ? <X size={15} aria-hidden="true" /> : <CheckCheck size={15} aria-hidden="true" />, disabled: selection.disabled, run: selection.run }] : []),
          { id: 'play', label: t('欣赏', 'Slideshow'), icon: <Play size={15} aria-hidden="true" />, disabled: !canPlay, run: onPlay },
          ...(shootingRegion ? [{ id: 'shooting-region', ...shootingRegion, icon: <MapPin size={15} aria-hidden="true" /> }] : []),
          ...(airDrop ? [{ id: 'air-drop', label: airDrop.label, icon: <Radio size={15} aria-hidden="true" />, disabled: airDrop.disabled, run: airDrop.run }] : []),
          { id: 'status', label: discarded ? t(`返回${activeLabel}`, `Back to ${activeLabel}`) : t('查看已废弃', 'View Rejected'), icon: discarded ? <Undo2 size={15} aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />, run: () => onStatus(!discarded) },
        ] },
        { label: t('照片排序', 'Sort Photos'), items: photoSortOptions.map((id) => {
          const Icon = albumSortIcons[id];
          return { id, label: photoSortLabels[id], icon: <Icon size={15} aria-hidden="true" />, checked: sort === id, disabled: !canSort, run: () => onSort(id) };
        }) },
        ...(workView ? [{ label: t('分组方式', 'Group By'), compact: true, items: workViewOptions.map(({ id, label }) => ({
          id, label, checked: workView === id, run: () => onWorkView?.(id),
        })) }] : []),
      ]} />
  </header>;
}
