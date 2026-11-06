import { useCallback, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type FocusEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { currentModalHost, subscribeModalStack } from '../lib/modal-stack';
import { useDismiss } from './beui/hooks/use-dismiss';

export function useDropdown(disabled: boolean, onOpenChange?: (open: boolean) => void) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [expanded, setOpen] = useState(false);
  const open = expanded && !disabled;
  const close = useCallback(() => setOpen(false), []);
  const insidePanel = useCallback((target: Element) => !!panel.current?.contains(target), []);

  useDismiss(open, close, trigger, { escape: false, ignore: insidePanel });
  useLayoutEffect(() => { if (disabled) close(); }, [close, disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    onOpenChange?.(true);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);

  function closeAndFocus() {
    trigger.current?.focus({ preventScroll: true });
    close();
  }
  function onBlur(event: FocusEvent) {
    const target = event.relatedTarget;
    if (target instanceof Element && !trigger.current?.contains(target) && !insidePanel(target)) close();
  }

  return { id, trigger, panel, open, setOpen, close, closeAndFocus, onBlur };
}

export function revealDropdownRow(panel: HTMLDivElement, row: HTMLElement) {
  const bounds = panel.getBoundingClientRect();
  const item = row.getBoundingClientRect();
  const top = bounds.top + panel.clientTop;
  const bottom = top + panel.clientHeight;
  if (item.top < top) panel.scrollTop += item.top - top;
  else if (item.bottom > bottom) panel.scrollTop += item.bottom - bottom;
}

const edge = 8;
const gap = 5;
const maxWidth = 440;
const maxHeight = 380;

function placePanel(anchor: HTMLButtonElement, panel: HTMLDivElement, dialog: HTMLDialogElement | null, align: 'start' | 'end') {
  const trigger = anchor.getBoundingClientRect();
  const bounds = dialog?.getBoundingClientRect();
  const originX = (bounds?.left ?? 0) + (dialog?.clientLeft ?? 0);
  const originY = (bounds?.top ?? 0) + (dialog?.clientTop ?? 0);
  const left = Math.max(0, originX) + edge;
  const top = Math.max(0, originY) + edge;
  const right = Math.min(window.innerWidth, dialog ? originX + dialog.clientWidth : window.innerWidth) - edge;
  const bottom = Math.min(window.innerHeight, dialog ? originY + dialog.clientHeight : window.innerHeight) - edge;
  const widthLimit = Math.min(maxWidth, right - left);
  panel.style.maxWidth = `${widthLimit}px`;
  panel.style.minWidth = `${Math.min(widthLimit, Math.max(trigger.width, align === 'end' ? 208 : 132))}px`;
  const height = Math.min(maxHeight, panel.scrollHeight + panel.offsetHeight - panel.clientHeight);
  const below = bottom - trigger.bottom - gap;
  const above = trigger.top - top - gap;
  const openBelow = below >= height || below >= above;
  panel.style.maxHeight = `${Math.min(maxHeight, openBelow ? below : above)}px`;
  const x = align === 'end' ? trigger.right - panel.offsetWidth : trigger.left;
  const y = openBelow ? trigger.bottom + gap : trigger.top - gap - panel.offsetHeight;
  panel.style.left = `${Math.max(left, Math.min(x, right - panel.offsetWidth)) - originX + (dialog?.scrollLeft ?? 0)}px`;
  panel.style.top = `${Math.max(top, y) - originY + (dialog?.scrollTop ?? 0)}px`;
}

export function DropdownLayer({ trigger, panel, id, role, label, align = 'start', close, children }: {
  trigger: RefObject<HTMLButtonElement | null>;
  panel: RefObject<HTMLDivElement | null>;
  id: string;
  role: 'listbox' | 'menu';
  label: string;
  align?: 'start' | 'end';
  close: () => void;
  children: ReactNode;
}) {
  const activeHost = useSyncExternalStore(subscribeModalStack, currentModalHost);
  const dialog = trigger.current?.closest('dialog') ?? null;
  const host = dialog ?? document.body;

  useLayoutEffect(() => {
    if (host !== activeHost) { close(); return; }
    const anchor = trigger.current!;
    const overlay = panel.current!;
    const place = () => placePanel(anchor, overlay, dialog, align);
    const onScroll = (event: Event) => {
      if (event.target !== document && !(event.target instanceof Element && event.target.contains(anchor))) return;
      if (overlay.contains(document.activeElement)) anchor.focus({ preventScroll: true });
      close();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [activeHost, align, close, dialog, host, panel, trigger]);

  if (host !== activeHost) return null;
  // A dialog's top layer makes body siblings inert. Keep its popup in its
  // own visible scrollport. The workspace popup can escape all scrollports.
  return createPortal(<div id={id} ref={panel} className="dropdown-panel" data-in-dialog={dialog ? '' : undefined}
    role={role} aria-label={label} tabIndex={role === 'menu' ? -1 : undefined}>{children}</div>, host);
}

export function stepDropdownIndex(items: readonly { disabled?: boolean }[], index: number, direction: 1 | -1) {
  for (let next = index + direction; next >= 0 && next < items.length; next += direction) {
    if (!items[next].disabled) return next;
  }
  return -1;
}
