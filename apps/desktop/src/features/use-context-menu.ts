import { useEffect, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { Menu } from '@tauri-apps/api/menu';

export interface ContextMenuAction {
  id: string;
  text: string;
  disabled?: boolean;
  allowed: () => boolean;
  run: () => void;
}

// MenuChannels is shared by the native host and keyed by item ID. Keep IDs
// bounded, and never replace their handlers while another popup is tracking.
let popupOwner: symbol | null = null;
export function isContextMenuTracking() { return popupOwner !== null; }
const popupListeners = new Set<() => void>();
export function subscribeContextMenu(listener: () => void) {
  popupListeners.add(listener);
  return () => { popupListeners.delete(listener); };
}
function setPopupOwner(owner: symbol | null) {
  popupOwner = owner;
  popupListeners.forEach((listener) => listener());
}

export function useContextMenu(scope: 'photo' | 'album' | 'book', context: string, onError: (message: string) => void) {
  const label = { photo: '照片', album: '相簿', book: '画册' }[scope];
  const owner = useRef(Symbol(`${scope}-menu`));
  const generation = useRef(0);
  const mounted = useRef(true);
  const menu = useRef<Menu | null>(null);
  const current = useRef({ context, onError });
  if (current.current.context !== context) generation.current += 1;
  current.current = { context, onError };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      const previous = menu.current;
      menu.current = null;
      if (previous) void previous.close().catch((cause: unknown) => current.current.onError(message(cause)));
    };
  }, []);

  return async (actions: ContextMenuAction[], at: { x: number; y: number }, trigger: HTMLElement) => {
    if (popupOwner !== null || !mounted.current) return;
    setPopupOwner(owner.current);
    const request = ++generation.current;
    const requestedContext = context;
    const valid = () => mounted.current && request === generation.current && requestedContext === current.current.context;
    let acted = false;
    try {
      if (!isTauri()) throw new Error(`请在桌面应用中使用${label}操作菜单`);
      const previous = menu.current;
      menu.current = null;
      if (previous) {
        try { await previous.close(); }
        catch (cause) { if (mounted.current) menu.current = previous; throw cause; }
      }
      if (!valid()) return;
      const next = await Menu.new({
        id: `foliune-${scope}-menu`,
        items: actions.map((action) => ({
          id: `foliune-${scope}-${action.id}`,
          text: action.text,
          enabled: !action.disabled,
          action: () => {
            if (!valid() || acted || action.disabled || !action.allowed()) return;
            acted = true;
            action.run();
          },
        })),
      });
      if (!valid()) { await next.close(); return; }
      menu.current = next;
      trigger.focus({ preventScroll: true });
      await next.popup(new LogicalPosition(at.x, at.y));
      // Keep the root (which owns its raw children) until the next open or
      // unmount. The public API does not promise a separate dismissal event.
    } catch (cause) {
      if (valid()) current.current.onError(`无法打开${label}操作菜单：${message(cause)}`);
    } finally {
      if (popupOwner === owner.current) setPopupOwner(null);
      if (!acted && valid() && trigger.isConnected) trigger.focus({ preventScroll: true });
    }
  };
}

function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
