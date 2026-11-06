import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'document' ? window.document : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// happy-dom does not load image pixels; keep the real PhotoImage in its pending state.
Object.defineProperty(window.HTMLImageElement.prototype, 'complete', { configurable: true, get: () => false });
const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  entryPoints: [resolve('apps/desktop/src/features/AlbumOverview.tsx')],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { AlbumOverview } = module.exports;
const photo = id => ({ id, library: 'collection', title: id, originalName: `${id}.jpg`, originalPath: '/test.jpg', thumbnailPath: '/test.jpg', originalUrl: '/test.jpg', thumbnailUrl: '/test.jpg', originalAvailable: true, thumbnailAvailable: true, width: 100, height: 150, tags: [], regions: [], annotation: '', source: '', capturedAt: null, location: '', project: '', importedAt: '' });
const groups = ['first', 'second', 'empty'].map(id => ({ id, library: 'collection', name: id, description: '', capacity: null, createdAt: '' }));
const albums = groups.map((group, index) => ({ group, photos: index < 2 ? [photo(group.id)] : [] }));

async function scenario(busy, run, initial = {}) {
  const calls = { menu: [], open: [], retry: [] };
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const dispatch = async (target, type, options = {}) => {
    assert(target, `${type} target exists`);
    const event = type === 'keydown' ? new KeyboardEvent(type, { bubbles: true, cancelable: true, ...options }) : new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 81, clientY: 99, ...options });
    await act(async () => target.dispatchEvent(event));
    return event;
  };
  const render = (state = initial) => act(async () => root.render(h(AlbumOverview, { albums, busy,
    onOpen: id => calls.open.push(id), onMenu: (...args) => calls.menu.push(args), onRetry: job => calls.retry.push(job.id), ...state })));
  try {
    await render();
    await run({ calls, container, dispatch, render });
  } finally { await act(async () => root.unmount()); container.remove(); }
}

test('普通相簿封面、标题及空封面右键管理目标正确，且不打开内容', async () => {
  await scenario(false, async ({ calls, container, dispatch }) => {
    const cards = [...container.querySelectorAll('button.album-open')];
    for (const [target, card, group] of [[cards[1].querySelector('img'), cards[1], groups[1]], [cards[0].querySelector('h2'), cards[0], groups[0]], [cards[2].querySelector('.album-empty'), cards[2], groups[2]]]) {
      assert.equal((await dispatch(target, 'contextmenu')).defaultPrevented, true);
      assert.deepEqual(calls.menu.at(-1), [group, { x: 81, y: 99 }, card]);
    }
    assert.deepEqual(calls.open, []);
    await act(async () => cards[1].click());
    assert.deepEqual(calls.open, ['second']);
  });
});

test('相簿键盘菜单沿用焦点卡片位置与目标，普通按键不触发菜单', async () => {
  await scenario(false, async ({ calls, container, dispatch }) => {
    const cards = [...container.querySelectorAll('button.album-open')];
    const regular = cards[1];
    regular.getBoundingClientRect = () => ({ left: 50, top: 60 });
    for (const options of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) {
      assert.equal((await dispatch(regular, 'keydown', options)).defaultPrevented, true);
      assert.deepEqual(calls.menu.at(-1), [groups[1], { x: 74, y: 92 }, regular]);
    }
    assert.equal(calls.menu.length, 2);
    assert.equal((await dispatch(regular, 'keydown', { key: 'F10' })).defaultPrevented, false);
    assert.equal((await dispatch(regular, 'keydown', { key: 'Enter' })).defaultPrevented, false);
    assert.deepEqual(calls.open, []);
  });
});

test('忙碌状态下真实相簿卡片保持禁用，封面阻止默认图片菜单', async () => {
  await scenario(true, async ({ calls, container, dispatch }) => {
    const cards = [...container.querySelectorAll('button.album-open')];
    assert(cards.every(card => card.disabled));
    for (const card of cards) await act(async () => card.click());
    assert.deepEqual(calls.open, []);
    for (const card of [cards[0], cards[1]]) assert.equal((await dispatch(card.querySelector('img'), 'contextmenu')).defaultPrevented, true);
    assert.equal(calls.menu.length, 2, '菜单动作禁用由 LibraryWorkspace 校验');
  });
});

test('新相簿占位原地成为可打开的卡片，失败只重试自己的任务', async () => {
  const pending = { id: 'job-new', folderName: '远山', albumId: 'new', createdAlbum: true, fileCount: 6, processed: 2, status: 'running' };
  const failed = { id: 'job-first', folderName: '源文件夹', albumId: 'first', createdAlbum: false, fileCount: 2, processed: 1, status: 'failed', error: '原件仍在写入' };
  const newAlbum = { group: { ...groups[0], id: 'new', name: pending.folderName }, photos: [photo('cover')] };
  await scenario(false, async ({ calls, container, render }) => {
    const placeholder = container.querySelector('article');
    assert.match(placeholder.textContent, /远山.*同步中.*2 \/ 6 张/);
    assert.equal(placeholder.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '2');
    assert.equal(placeholder.querySelector('button.album-open'), null);
    await render({ albums: [newAlbum], jobs: [] });
    assert.equal(container.querySelector('article'), placeholder);
    assert.equal(container.querySelectorAll('article').length, 1);
    await act(async () => placeholder.querySelector('button.album-open').click());
    assert.deepEqual(calls.open, ['new']);

    await render({ jobs: [failed, pending] });
    const first = container.querySelector('article');
    assert.ok(first.querySelector('img'), '已存在的封面不被同步状态替换');
    await act(async () => first.querySelector('button[aria-haspopup="dialog"]').click());
    assert.match(first.querySelector('dialog[open]').textContent, /原件仍在写入/);
    await act(async () => first.querySelector('dialog button[aria-label="关闭"]').click());
    await act(async () => first.querySelector('button[aria-label="重试同步 first"]').click());
    assert.deepEqual(calls.retry, ['job-first']);
    await act(async () => first.querySelector('button.album-open').click());
    assert.deepEqual(calls.open, ['new', 'first']);
    assert.equal(container.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '2');
  }, { albums: [], jobs: [pending] });
});
