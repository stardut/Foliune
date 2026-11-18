import { t } from '../lib/i18n';
import { ArrowDownAZ, ArrowDownWideNarrow, ArrowDownZA, ArrowUpWideNarrow, ListOrdered, type LucideIcon } from 'lucide-react';
import { DropdownMenu } from '../components/DropdownMenu';
import type { AlbumSort, PhotoSort } from './library-photo-order';

export const albumSortLabels = {
  'time-asc': t('创建时间 · 由旧到新', 'Created · Oldest First'),
  'time-desc': t('创建时间 · 由新到旧', 'Created · Newest First'),
  'name-asc': t('相簿名 · 升序', 'Album Name · Ascending'),
  'name-desc': t('相簿名 · 降序', 'Album Name · Descending'),
} satisfies Record<AlbumSort, string>;

export const photoSortLabels = {
  membership: t('加入顺序', 'Order Added'),
  'time-asc': t('拍摄时间 · 由旧到新', 'Date Taken · Oldest First'),
  'time-desc': t('拍摄时间 · 由新到旧', 'Date Taken · Newest First'),
  'name-asc': t('文件名 · 升序', 'File Name · Ascending'),
  'name-desc': t('文件名 · 降序', 'File Name · Descending'),
} satisfies Record<PhotoSort, string>;

export const albumSortIcons: Record<PhotoSort, LucideIcon> = {
  membership: ListOrdered,
  'time-asc': ArrowUpWideNarrow,
  'time-desc': ArrowDownWideNarrow,
  'name-asc': ArrowDownAZ,
  'name-desc': ArrowDownZA,
};

export function AlbumSortButton<Sort extends PhotoSort>({ label, value, labels, onChange, disabled, onBeforeOpen, onOpenChange }: {
  label: string; value: Sort; labels: Record<Sort, string>; onChange: (value: Sort) => void;
  disabled: boolean; onBeforeOpen: () => void; onOpenChange: (open: boolean) => void;
}) {
  const Icon: LucideIcon = albumSortIcons[value];
  const description = `${label} · ${labels[value]}`;
  const options = (Object.keys(labels) as Sort[]).map((id) => {
    const OptionIcon: LucideIcon = albumSortIcons[id];
    return { id, label: labels[id], icon: <OptionIcon size={15} aria-hidden="true" />, checked: value === id, run: () => onChange(id) };
  });
  return <DropdownMenu label={label} triggerLabel={description} icon={<Icon size={17} aria-hidden="true" />}
    groups={[{ items: options }]} disabled={disabled} onBeforeOpen={onBeforeOpen} onOpenChange={onOpenChange} />;
}
