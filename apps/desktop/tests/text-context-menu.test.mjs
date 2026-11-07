import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window();
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'document' ? window.document : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: { contents: "export { TextContextMenu } from './components/TextContextMenu'; export { tryAcquireContextMenu, releaseContextMenu, isContextMenuTracking } from './features/use-context-menu';", resolveDir: resolve('apps/desktop/src') },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent',
  plugins: [{ name: 'toast', setup(build) {
    build.onResolve({ filter: /ToastProvider$/ }, () => ({ path: 'toast', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const useToast = () => globalThis.textMenuToast;' }));
  } }],
});
const toasts = [];
globalThis.textMenuToast = input => toasts.push(input);
const menus = [];
let create = async options => {
  let finish;
  const menu = { options, popups: [], closed: 0, popup(at) { this.popups.push(at); return new Promise(resolve => { finish = resolve; }); }, async close() { this.closed++; finish?.(); }, dismiss() { finish?.(); } };
  menus.push(menu); return menu;
};
const fakeRequire = name => name === '@tauri-apps/api/core' ? { isTauri: () => true } : name === '@tauri-apps/api/dpi' ? { LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } } } : name === '@tauri-apps/api/menu' ? { Menu: { new: options => create(options) } } : require(name);
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(fakeRequire, module, module.exports);
const { TextContextMenu, tryAcquireContextMenu, releaseContextMenu, isContextMenuTracking } = module.exports;
const flush = () => act(async () => { await Promise.resolve(); });
const dispatch = async target => { await act(async () => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 25, clientY: 80 }))); };

async function scenario(run) {
  const container = document.createElement('div'); document.body.append(container);
  const input = document.createElement('input'); input.value = '构图与光影'; document.body.append(input);
  const root = createRoot(container);
  try { await act(async () => root.render(h(TextContextMenu))); await run(input); }
  finally {
    for (const menu of menus) menu.dismiss();
    await flush();
    await act(async () => root.unmount());
    await flush(); input.remove(); container.remove(); menus.length = 0; toasts.length = 0;
  }
}

test('编辑菜单与业务菜单互斥，打开不改变文字选区，原生菜单仅含编辑操作', async () => {
  await scenario(async input => {
    const business = Symbol('photo-menu');
    assert.equal(tryAcquireContextMenu(business), true);
    await dispatch(input); assert.equal(menus.length, 0);
    releaseContextMenu(Symbol('other')); assert.equal(isContextMenuTracking(), true);
    releaseContextMenu(business);
    input.focus(); input.setSelectionRange(1, 4);
    await dispatch(input);
    assert.equal(document.activeElement, input);
    assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 4]);
    assert.deepEqual(menus[0].options.items.map(item => item.item), ['Undo', 'Redo', 'Separator', 'Cut', 'Copy', 'Paste', 'Separator', 'SelectAll']);
    assert.equal(isContextMenuTracking(), true);
    assert.equal(tryAcquireContextMenu(business), false);
    await dispatch(input); assert.equal(menus[0].popups.length, 1);
    menus[0].dismiss(); await flush(); assert.equal(isContextMenuTracking(), false);
    await dispatch(input); assert.equal(menus.length, 1, '同种编辑菜单复用原生对象');
    menus[0].dismiss(); await flush();
    input.readOnly = true; await dispatch(input);
    assert.deepEqual(menus[1].options.items.map(item => item.item), ['Copy', 'SelectAll']);
  });
});

test('等待原生菜单时切换焦点不重新抢焦点，创建失败提示并释放互斥', async () => {
  const originalCreate = create;
  try {
    await scenario(async input => {
      let resolveMenu;
      create = options => new Promise(resolve => { resolveMenu = async () => resolve(await originalCreate(options)); });
      await dispatch(input);
      const other = document.createElement('textarea'); document.body.append(other); other.focus();
      await resolveMenu(); await flush();
      assert.equal(menus[0].popups.length, 0);
      assert.equal(document.activeElement, other); assert.equal(isContextMenuTracking(), false);
      other.remove();
      input.readOnly = true;
      create = async () => { throw new Error('系统菜单不可用'); };
      await dispatch(input);
      assert.equal(isContextMenuTracking(), false);
      assert.match(toasts.at(-1).title, /无法打开编辑菜单.*系统菜单不可用/);
      assert.equal(toasts.at(-1).status, 'error');
    });
  } finally { create = originalCreate; }
});
