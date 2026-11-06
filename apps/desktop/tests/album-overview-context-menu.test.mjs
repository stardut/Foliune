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
const photo = id => ({ id, library: 'collection', title: id, originalName: `${id}.jpg`, originalPath: `/original/${id}.jpg`, thumbnailPath: `/thumb/${id}.jpg`, originalUrl: `/original/${id}.jpg`, thumbnailUrl: `/thumb/${id}.jpg`, originalAvailable: true, thumbnailAvailable: true, width: 100, height: 150, tags: [], regions: [], annotation: '', source: '', capturedAt: null, location: '', project: '', importedAt: '' });
const groups = ['first', 'second', 'empty'].map(id => ({ id, library: 'collection', name: id, description: '', capacity: null, createdAt: '' }));
const albums = groups.map((group, index) => ({ group, photos: index < 2 ? [photo(group.id)] : [] }));

async function scenario(busy, run, initial = {}) {
  const calls = { menu: [], open: [], retry: [] };
  const container = document.createElement('main'); document.body.append(container);
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

function mockCoverRead(t) {
  const observers = new Map();
  const requests = [];
  const decoded = new Map();
  const blobs = new Map();
  const released = [];
  const deferred = () => {
    let resolve, reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
  };
  globalThis.isTauri = true;
  window.__TAURI_INTERNALS__ = { invoke(command, args) {
    assert.equal(command, 'read_album_cover');
    const pending = deferred();
    requests.push({ args, ...pending });
    return pending.promise;
  } };
  globalThis.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; }
    observe(target) { this.target = target; observers.set(target, this); }
    disconnect() { observers.delete(this.target); }
  };
  t.after(() => { delete globalThis.isTauri; delete globalThis.IntersectionObserver; delete window.__TAURI_INTERNALS__; });
  t.mock.method(URL, 'createObjectURL', (blob) => {
    const url = `blob:cover-${blobs.size}`;
    blobs.set(url, blob);
    return url;
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => released.push(url));
  t.mock.method(window.HTMLImageElement.prototype, 'decode', function () {
    assert.equal(this.hidden, true, '解码实际展示节点期间保留缩略图');
    const pending = deferred();
    decoded.set(this.getAttribute('src'), pending);
    return pending.promise;
  });
  const visibility = (image) => {
    const target = image.parentElement;
    const observer = observers.get(target);
    assert.equal(observer.options.root, target.closest('main'));
    return (...states) => act(async () => observer.callback(states.map(isIntersecting => ({ target, isIntersecting }))));
  };
  const near = (image, isIntersecting = true) => visibility(image)(isIntersecting);
  return { near, visibility, requests, decoded, blobs, released };
}

test('高清封面仅在接近视口时读取，限制并发并丢弃离屏请求', async (t) => {
  const { near, visibility, requests, decoded, released } = mockCoverRead(t);
  const cards = ['first', 'second', 'third', 'fourth'].map(id => ({ group: { ...groups[0], id }, photos: [photo(id)] }));
  await scenario(false, async ({ container }) => {
    const images = [...container.querySelectorAll('.album-cover-hd')];
    assert.equal(requests.length, 0);
    await visibility(images[0])(true, false);
    assert.equal(requests.length, 0, '同一批视口通知采用最后状态');
    for (const image of images) {
      assert.equal(image.hidden, true);
      assert.match(image.previousElementSibling.querySelector('img').getAttribute('src'), /^\/thumb\//);
      await near(image);
    }
    assert.deepEqual(requests.map(({ args }) => args.groupId), ['first', 'second']);
    await near(images[2], false);
    await act(async () => requests[0].resolve(new ArrayBuffer(3)));
    assert.equal(images[0].hidden, true);
    assert.equal(requests.length, 2, '原生读取和实际展示节点解码占用同一个并发名额');
    await act(async () => decoded.get('blob:cover-0').resolve());
    assert.equal(images[0].hidden, false);
    assert.equal(images[0].previousElementSibling, null);
    assert.deepEqual(requests.map(({ args }) => args.groupId), ['first', 'second', 'fourth']);

    await act(async () => requests[1].resolve(new ArrayBuffer(3)));
    await near(images[1], false);
    await act(async () => decoded.get('blob:cover-1').resolve());
    assert.equal(images[1].hidden, true);
    assert.equal(images[1].getAttribute('src'), null);
    assert.equal(images[1].previousElementSibling.querySelector('img').alt, 'second');
    assert.deepEqual(released, ['blob:cover-1']);
    await act(async () => requests[2].resolve(new ArrayBuffer(3)));
    await act(async () => decoded.get('blob:cover-2').reject(new Error('无法解码 JPEG')));
    assert.equal(images[3].previousElementSibling.querySelector('img').alt, 'fourth');
  }, { albums: cards });
  assert.deepEqual(released, ['blob:cover-1', 'blob:cover-2', 'blob:cover-0']);
});

test('离线缩略图与高清缓存均可展示，修订与废弃封面淘汰旧请求', async (t) => {
  const { near, visibility, requests, decoded, blobs, released } = mockCoverRead(t);
  const cover = { photoId: 'selected', offsetX: .25, offsetY: .75, zoom: 2.3 };
  const first = photo('default');
  const selected = { ...photo(cover.photoId), originalAvailable: false, availability: 'offline' };
  const group = { ...groups[0], cover };
  await scenario(false, async ({ container, render }) => {
    const highImage = () => container.querySelector('.album-cover-hd');
    const thumb = () => container.querySelector('.album-cover .image-asset > img');
    assert.equal(thumb().getAttribute('src'), selected.thumbnailUrl);
    await near(highImage());
    assert.deepEqual(requests[0].args, { groupId: group.id, photoId: selected.id, expectedOriginalPath: selected.originalPath,
      expectedThumbnailPath: selected.thumbnailPath, expectedCover: cover });
    await act(async () => requests[0].resolve([255, 216, 255]));
    await act(async () => decoded.get('blob:cover-0').resolve());
    assert.deepEqual([...new Uint8Array(await blobs.get('blob:cover-0').arrayBuffer())], [255, 216, 255]);
    assert.equal(highImage().hidden, false);

    const online = { ...selected, originalAvailable: true, availability: 'available' };
    await render({ albums: [{ group, photos: [first, online] }] });
    assert.deepEqual(released, ['blob:cover-0']);
    assert.equal(thumb().alt, selected.id);
    await near(highImage());
    assert.equal(requests.length, 2, '可用状态变化重新读取同一照片');
    const staleVisibility = visibility(highImage());
    const replaced = { ...online, thumbnailPath: '/replacement.jpg', thumbnailUrl: '/replacement.jpg' };
    await render({ albums: [{ group, photos: [first, replaced] }] });
    assert.equal(thumb().getAttribute('src'), replaced.thumbnailUrl);
    await act(async () => requests[1].resolve(new ArrayBuffer(3)));
    assert.equal(blobs.size, 1, '旧修订结果在创建 Blob 前即已丢弃');
    await staleVisibility(true);
    assert.equal(requests.length, 2, '卸载后交付的视口事件不能发起请求');
    await near(highImage());
    assert.equal(requests[2].args.expectedThumbnailPath, replaced.thumbnailPath);

    await render({ albums: [{ group, photos: [first] }] });
    assert.equal(thumb().alt, first.id);
    assert.equal(container.querySelector('.album-cover').getAttribute('style'), null);
    await act(async () => requests[2].resolve(new ArrayBuffer(3)));
    await near(highImage());
    assert.deepEqual(requests[3].args, { groupId: group.id, photoId: first.id, expectedOriginalPath: first.originalPath,
      expectedThumbnailPath: first.thumbnailPath, expectedCover: null });
    await act(async () => requests[3].reject('原件无法读取'));
    await render({ albums: [{ group, photos: [{ ...first, originalAvailable: false, thumbnailAvailable: false }] }] });
    assert.equal(thumb(), null);
    assert.match(container.querySelector('.missing-photo').textContent, /原图文件缺失/);
  }, { albums: [{ group, photos: [first, selected] }] });
});
