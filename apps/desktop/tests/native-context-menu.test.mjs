import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window();
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'document' ? window.document : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  entryPoints: [resolve('apps/desktop/src/features/use-context-menu.ts')],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false, logLevel: 'silent',
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
let current;
const fakeRequire = name => name === '@tauri-apps/api/core' ? {
  isTauri: () => true,
  invoke: (command, args) => { const pending = deferred(); current.native.push({ command, args, ...pending }); return pending.promise; },
} : name === '@tauri-apps/api/dpi' ? {
  LogicalPosition: class { constructor(x, y) { this.x = x; this.y = y; } },
} : name === '@tauri-apps/api/menu' ? { Menu: {
  new: async options => {
    const menu = { rid: current.menus.length + 10, options, popups: [], closed: 0,
      popup(at) { const pending = deferred(); this.popups.push({ at, ...pending }); return pending.promise; },
      async close() { this.closed++; },
    };
    current.menus.push(menu);
    if (current.creation) await current.creation.promise;
    return menu;
  },
} } : require(name);
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(fakeRequire, module, module.exports);
const { useContextMenu, isContextMenuTracking } = module.exports;
const flush = () => act(async () => { await Promise.resolve(); });
const actions = [{ id: 'info', text: '相簿信息', allowed: () => true, run() {} }];

async function scenario(run) {
  current = { native: [], menus: [], errors: [] };
  const state = current;
  const container = document.createElement('div'); document.body.append(container);
  const target = document.createElement('button'); container.append(target);
  const other = document.createElement('button'); container.append(other);
  const root = createRoot(container.appendChild(document.createElement('div')));
  let first, second;
  function Probe({ context }) {
    first = useContextMenu('album', context, error => state.errors.push(error));
    second = useContextMenu('photo', context, error => state.errors.push(error));
    return null;
  }
  const render = context => act(async () => root.render(h(Probe, { context })));
  const open = async (at, which = 'first') => {
    let pending;
    await act(async () => { pending = (which === 'first' ? first : second)(actions, at, which === 'first' ? target : other); });
    return { pending };
  };
  try { await render('album-a'); await run({ state, target, other, open, render }); }
  finally {
    state.creation?.resolve();
    for (const call of state.native) call.resolve();
    for (const menu of state.menus) for (const popup of menu.popups) popup.resolve();
    await flush(); await act(async () => root.unmount()); container.remove();
    assert.equal(isContextMenuTracking(), false);
  }
}

test('鼠标菜单传递既有Menu资源并覆盖整个原生tracking期互斥，取消回焦原目标', async () => {
  await scenario(async ({ state, target, other, open }) => {
    const first = await open({ x: 120, y: 84, source: 'mouse' });
    assert.deepEqual(state.native.map(({ command, args }) => ({ command, args })), [
      { command: 'popup_context_menu', args: { rid: 10, x: 120, y: 84 } },
    ]);
    assert.equal(state.menus[0].popups.length, 0);
    assert.equal(isContextMenuTracking(), true);
    await open({ x: 450, y: 200, source: 'mouse' }, 'second');
    assert.equal(state.menus.length, 1);
    other.focus();
    await act(async () => state.native[0].resolve()); await first.pending;
    assert.equal(document.activeElement, target);
    assert.equal(isContextMenuTracking(), false);
    assert.deepEqual(state.errors, []);
  });
});

test('键盘与更多按钮的position入口继续使用原生定位菜单', async () => {
  await scenario(async ({ state, open }) => {
    const request = await open({ x: 32, y: 48, source: 'position' });
    assert.equal(state.native.length, 0);
    assert.deepEqual({ ...state.menus[0].popups[0].at }, { x: 32, y: 48 });
    await act(async () => state.menus[0].popups[0].resolve()); await request.pending;
  });
});

test('原始鼠标事件关联失败明确反馈并释放互斥，不退回定位API伪装成功', async () => {
  await scenario(async ({ state, open }) => {
    const request = await open({ x: 8, y: 12, source: 'mouse' });
    assert.equal(state.native.length, 1);
    await act(async () => state.native[0].reject(new Error('菜单请求已失效，请重新右键'))); await request.pending;
    assert.match(state.errors[0], /无法打开相簿操作菜单.*菜单请求已失效/);
    assert.equal(state.menus[0].popups.length, 0);
    assert.equal(isContextMenuTracking(), false);
  });
});

test('创建菜单期间上下文失效不会调用bridge或展示旧目标菜单', async () => {
  await scenario(async ({ state, open, render }) => {
    state.creation = deferred();
    const request = await open({ x: 50, y: 60, source: 'mouse' });
    await render('album-b');
    await act(async () => state.creation.resolve()); await request.pending;
    assert.equal(state.native.length, 0);
    assert.equal(state.menus[0].popups.length, 0);
    assert.equal(state.menus[0].closed, 1);
  });
});
