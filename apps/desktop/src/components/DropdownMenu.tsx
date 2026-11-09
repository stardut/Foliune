import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { DropdownLayer, revealDropdownRow, stepDropdownIndex, useDropdown } from './dropdown-layer';

interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  checked?: boolean;
  run: () => void;
}

interface MenuGroup {
  label?: string;
  compact?: boolean;
  items: MenuItem[];
}

export function DropdownMenu({ label, triggerLabel, triggerText, title, icon, groups, disabled = false, onBeforeOpen, onOpenChange, onTabForward }: {
  label: string;
  triggerLabel?: string;
  triggerText?: string;
  title?: string;
  icon: ReactNode;
  groups: MenuGroup[];
  disabled?: boolean;
  onBeforeOpen?: () => void;
  onOpenChange?: (open: boolean) => void;
  onTabForward?: () => boolean;
}) {
  const { id, trigger, panel, open, setOpen, close, closeAndFocus, onBlur } = useDropdown(disabled, onOpenChange);
  const initial = useRef(0);
  const items = groups.flatMap((group) => group.items);

  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const row = panel.current.querySelectorAll<HTMLButtonElement>('.dropdown-row')[initial.current];
    (row ?? panel.current).focus({ preventScroll: true });
    if (row) revealDropdownRow(panel.current, row);
  }, [open, panel]);

  function show(direction: 1 | -1 = 1) {
    onBeforeOpen?.();
    const checked = groups.length === 1 ? items.findIndex((item) => item.checked && !item.disabled) : -1;
    initial.current = checked >= 0 ? checked : stepDropdownIndex(items, direction === 1 ? -1 : items.length, direction);
    trigger.current?.focus({ preventScroll: true });
    setOpen(true);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Tab') {
      if (open) closeAndFocus();
      if (!event.shiftKey && onTabForward?.()) event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
      return;
    }
    const arrow = event.key === 'ArrowUp' || event.key === 'ArrowDown';
    if (!open) {
      if (arrow) { event.preventDefault(); show(event.key === 'ArrowUp' ? -1 : 1); }
      return;
    }
    if (!panel.current || (!arrow && event.key !== 'Home' && event.key !== 'End')) return;
    event.preventDefault();
    const rows = Array.from(panel.current.querySelectorAll<HTMLButtonElement>('.dropdown-row'));
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === 'Home' || event.key === 'ArrowDown' ? 1 : -1;
    const start = event.key === 'Home' || event.key === 'End' || index === -1 ? (direction === 1 ? -1 : items.length) : index;
    const next = stepDropdownIndex(items, start, direction);
    const row = rows[next >= 0 ? next : stepDropdownIndex(items, direction === 1 ? -1 : items.length, direction)];
    if (row) {
      row.focus({ preventScroll: true });
      revealDropdownRow(panel.current, row);
    }
  }

  return <div onKeyDown={onKeyDown} onBlur={onBlur}>
    <button type="button" className={`${triggerText ? 'button' : 'icon-button'}${open ? ' is-active' : ''}`} ref={trigger} disabled={disabled}
      aria-label={triggerLabel ?? label} title={title ?? triggerLabel ?? label} aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => { if (open) closeAndFocus(); else show(); }}>
      {icon}{triggerText && <>{triggerText}<ChevronDown size={13} aria-hidden="true" /></>}
    </button>
    {open && <DropdownLayer id={id} trigger={trigger} panel={panel} role="menu" label={label} align="end" close={close}>
      {groups.map((group) => <div key={group.label ?? id} role="group" aria-label={group.label}
        className={`dropdown-group${group.compact ? ' dropdown-group-compact' : ''}`}>
        {group.label && <span className="dropdown-group-title" aria-hidden="true">{group.label}</span>}
        {group.items.map((item) => <button key={item.id} type="button" className="dropdown-row" tabIndex={-1}
          role={item.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={item.checked} disabled={item.disabled}
          onClick={() => { closeAndFocus(); item.run(); }}>
          {item.icon}<span className="dropdown-row-label">{item.label}</span>
          {item.checked && <Check className="dropdown-row-check" size={group.compact ? 12 : 14} aria-hidden="true" />}
        </button>)}
      </div>)}
    </DropdownLayer>}
  </div>;
}
