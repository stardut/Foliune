import { t } from '../lib/i18n.ts';
import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { Menu, type PredefinedMenuItemOptions } from '@tauri-apps/api/menu';
import { installContextMenuPolicy, type TextMenuKind } from '../lib/context-menu-policy';
import { tryAcquireContextMenu, releaseContextMenu } from '../features/use-context-menu';
import { useToast } from './ToastProvider';

const editItems: PredefinedMenuItemOptions[] = [
  { item: 'Undo', text: t('撤销', 'Undo') }, { item: 'Redo', text: t('重做', 'Redo') }, { item: 'Separator' },
  { item: 'Cut', text: t('剪切', 'Cut') }, { item: 'Copy', text: t('复制', 'Copy') }, { item: 'Paste', text: t('粘贴', 'Paste') },
  { item: 'Separator' }, { item: 'SelectAll', text: t('全选', 'Select All') },
];
const copyItems: PredefinedMenuItemOptions[] = [{ item: 'Copy', text: t('复制', 'Copy') }, { item: 'SelectAll', text: t('全选', 'Select All') }];

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
          if (!disposed) toast({ status: 'error', title: t(`无法打开编辑菜单：${cause instanceof Error ? cause.message : String(cause)}`, `Could not open the edit menu: ${cause instanceof Error ? cause.message : String(cause)}`) });
        } finally { releaseContextMenu(owner); }
      })();
    });
    return () => {
      disposed = true;
      remove();
      for (const pending of menus.values()) void pending.then(menu => menu.close()).catch(cause => console.error(t('无法释放编辑菜单', 'Could not release the edit menu'), cause));
    };
  }, [toast]);
  return null;
}
