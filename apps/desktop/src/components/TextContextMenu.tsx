import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { Menu, type PredefinedMenuItemOptions } from '@tauri-apps/api/menu';
import { installContextMenuPolicy, type TextMenuKind } from '../lib/context-menu-policy';
import { tryAcquireContextMenu, releaseContextMenu } from '../features/use-context-menu';
import { useToast } from './ToastProvider';

const editItems: PredefinedMenuItemOptions[] = [
  { item: 'Undo', text: '撤销' }, { item: 'Redo', text: '重做' }, { item: 'Separator' },
  { item: 'Cut', text: '剪切' }, { item: 'Copy', text: '复制' }, { item: 'Paste', text: '粘贴' },
  { item: 'Separator' }, { item: 'SelectAll', text: '全选' },
];
const copyItems: PredefinedMenuItemOptions[] = [{ item: 'Copy', text: '复制' }, { item: 'SelectAll', text: '全选' }];

export function TextContextMenu() {
  const toast = useToast();
  useEffect(() => {
    const menus = new Map<TextMenuKind, Promise<Menu>>();
    const owner = Symbol('text-menu');
    let disposed = false;
    const remove = installContextMenuPolicy(document, (kind, at, target) => {
      if (!isTauri() || !tryAcquireContextMenu(owner)) return;
      // Focusing an already focused editor preserves its selection. Native
      // predefined items act on the WebView responder, keeping undo and input events.
      target.focus({ preventScroll: true });
      void (async () => {
        try {
          let pending = menus.get(kind);
          if (!pending) {
            pending = Menu.new({ items: kind === 'edit' ? editItems : copyItems });
            menus.set(kind, pending);
            pending.catch(() => { if (menus.get(kind) === pending) menus.delete(kind); });
          }
          const menu = await pending;
          if (!disposed && target.isConnected && document.activeElement === target) await menu.popup(new LogicalPosition(at.x, at.y));
        } catch (cause) {
          if (!disposed) toast({ status: 'error', title: `无法打开编辑菜单：${cause instanceof Error ? cause.message : String(cause)}` });
        } finally { releaseContextMenu(owner); }
      })();
    });
    return () => {
      disposed = true;
      remove();
      for (const pending of menus.values()) void pending.then(menu => menu.close()).catch(cause => console.error('无法释放编辑菜单', cause));
    };
  }, [toast]);
  return null;
}
