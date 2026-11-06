import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDownAZ, ArrowDownWideNarrow, ArrowDownZA, ArrowUpWideNarrow, Check, ListOrdered, type LucideIcon } from 'lucide-react';
import { useDismiss } from '../components/beui/hooks/use-dismiss';
import type { AlbumSort, PhotoSort } from './library-photo-order';

export const albumSortLabels = {
  'time-asc': '创建时间 · 由旧到新',
  'time-desc': '创建时间 · 由新到旧',
  'name-asc': '相簿名 · 升序',
  'name-desc': '相簿名 · 降序',
} satisfies Record<AlbumSort, string>;

export const photoSortLabels = {
  membership: '加入顺序',
  'time-asc': '拍摄时间 · 由旧到新',
  'time-desc': '拍摄时间 · 由新到旧',
  'name-asc': '文件名 · 升序',
  'name-desc': '文件名 · 降序',
} satisfies Record<PhotoSort, string>;

const icons: Record<PhotoSort, LucideIcon> = {
  membership: ListOrdered,
  'time-asc': ArrowUpWideNarrow,
  'time-desc': ArrowDownWideNarrow,
  'name-asc': ArrowDownAZ,
  'name-desc': ArrowDownZA,
};

export function AlbumSortButton<Sort extends PhotoSort>({ label, value, labels, onChange, disabled, onOpenChange }: {
  label: string; value: Sort; labels: Record<Sort, string>; onChange: (value: Sort) => void;
  disabled: boolean; onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const scope = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, scope, { escape: false });
  useLayoutEffect(() => {
    if (disabled) close();
    else if (open) panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, [open, disabled, close]);
  useLayoutEffect(() => {
    onOpenChange(open && !disabled);
    return () => onOpenChange(false);
  }, [open, disabled, onOpenChange]);

  function closeAndFocus() {
    close();
    trigger.current?.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
      return;
    }
    const vertical = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    if (!open) {
      if (vertical && !disabled) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (!vertical && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const items = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  }

  const Icon: LucideIcon = icons[value];
  const description = `${label} · ${labels[value]}`;
  const options = Object.keys(labels) as Sort[];
  return <div className="album-sort" ref={scope} onKeyDown={onKeyDown} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close(); }}>
    <button type="button" className={`icon-button ${open ? 'is-active' : ''}`} ref={trigger} disabled={disabled} tabIndex={open ? -1 : undefined}
      title={description} aria-label={description} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? panelId : undefined}
      onClick={() => { if (open) closeAndFocus(); else setOpen(true); }}><Icon size={17} aria-hidden="true" /></button>
    {open && <div id={panelId} ref={panel} className="album-sort-panel" role="menu" aria-label={label}>
      {options.map((option) => {
        const OptionIcon: LucideIcon = icons[option];
        const checked = value === option;
        return <button type="button" key={option} role="menuitemradio" aria-checked={checked} tabIndex={-1} onClick={() => { closeAndFocus(); onChange(option); }}>
          <OptionIcon size={15} aria-hidden="true" /><span>{labels[option]}</span>{checked && <Check className="album-sort-check" size={14} aria-hidden="true" />}
        </button>;
      })}
    </div>}
  </div>;
}
