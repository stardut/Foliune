import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
Object.defineProperty(window, 'innerHeight', { value: 880 });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = key === 'window' ? window : typeof window[key] === 'function' && /^[a-z]/.test(key) ? window[key].bind(window) : window[key];
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window.HTMLImageElement.prototype, 'complete', { configurable: true, get: () => false });
const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: {
    contents: "export { PhotoCanvas } from './PhotoCanvas'; export { photoWallLayoutBatches } from './photo-wall-layout';",
    resolveDir: fileURLToPath(new URL('../src/features/', import.meta.url)),
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent',
  define: { 'import.meta.url': JSON.stringify('https://foliune.test/photo-wall') },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { PhotoCanvas, photoWallLayoutBatches } = module.exports;

const photos = (prefix, count = 3) => Array.from({ length: count }, (_, index) => ({
  id: `${prefix}-${index}`, title: `${prefix}-${index}`, originalName: `${index}.jpg`,
  width: 400, height: 300, originalUrl: '/test.jpg', thumbnailUrl: '/test.jpg',
  originalAvailable: true, thumbnailAvailable: true,
}));
const unit = (index, top, height = 300) => ({ top, height, left: 0, tiles: [{ index, x: 0, y: 0, width: 400, height }] });
const first = { units: [unit(0, 0), unit(1, 304)], height: 604, complete: false };
const final = { units: [unit(2, 2200)], height: 2500, complete: true };

async function scenario(run, { sticky = false } = {}) {
  const main = document.createElement('main');
  const outside = main.appendChild(document.createElement('button'));
  const container = main.appendChild(document.createElement('div'));
  document.body.append(main);
  const root = createRoot(container);
  let width = 896;
  let ready = 0;
  const workers = [];
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width });
  globalThis.Worker = class {
    constructor() { workers.push(this); }
    postMessage(input) { this.input = input; }
    terminate() { this.stopped = true; }
    emit(data) { return act(async () => this.onmessage({ data })); }
  };
  const onLayoutReady = () => { ready++; };
  const render = (items, layout = 'exhibition', props = {}) => act(async () => root.render([
    sticky && h('header', { className: 'album-detail-header', key: 'header' }),
    h(PhotoCanvas, {
      photos: items, layout, selected: [], busy: false, onSelect() {}, onMenu() {}, onPreview() {}, async onRelink() {}, onLayoutReady,
      key: 'wall', ...props,
    }),
  ]));
  const worker = async index => {
    const limit = Date.now() + 2000;
    while (!workers[index] && Date.now() < limit) await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
    assert.ok(workers[index], `Worker ${index} started`);
    return workers[index];
  };
  const tab = async (target, shiftKey = false) => {
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, shiftKey });
    await act(async () => target.dispatchEvent(event));
    return event.defaultPrevented;
  };
  const resize = nextWidth => act(async () => { width = nextWidth; window.dispatchEvent(new Event('resize')); });
  const canvas = () => container.querySelector('.virtual-photo-wall');
  const button = index => container.querySelector(`[data-photo-index="${index}"] .photo-interaction-target`);
  const scrollWall = (top, offset = 0) => act(async () => {
    main.scrollTop = top;
    canvas().getBoundingClientRect = () => new window.DOMRect(0, offset - main.scrollTop, width, 0);
    main.dispatchEvent(new Event('scroll'));
    await new Promise(resolve => window.requestAnimationFrame(resolve));
  });
  try { await run({ render, worker, tab, resize, canvas, button, outside, container, main, scrollWall, ready: () => ready }); }
  finally { await act(async () => root.unmount()); main.remove(); }
}

test('按照片 ID 恢复虚拟尾段，离屏旧游标让位于当前视口', async () => {
  await scenario(async ({ render, worker, button, main, scrollWall }) => {
    const album = photos('restore', 4);
    const ref = { current: null };
    const restored = [];
    const onRestored = (position) => restored.push(position);
    const request = { id: album[3].id, focus: true };
    Object.defineProperty(main, 'clientHeight', { value: 400 });
    await render(album, 'exhibition', { ref, restore: request, onRestored });
    const current = await worker(0);
    await scrollWall(0);
    await current.emit(first);
    assert.equal(button(3), null);
    assert.deepEqual(restored, []);
    await current.emit({ units: [unit(2, 2200), unit(3, 4800)], height: 5100, complete: true });
    assert.equal(main.scrollTop, 4750);
    assert.equal(document.activeElement, button(3));
    assert.deepEqual(restored, [request]);
    assert.deepEqual(ref.current.viewportPhoto(album[0].id), { id: album[3].id, index: 3 });
    await scrollWall(2170);
    assert.deepEqual(ref.current.viewportPhoto(album[3].id), { id: album[2].id, index: 2 });

    const entry = button(2);
    await scrollWall(0);
    const unchanged = { id: album[2].id, scrollTop: 2170, focus: entry };
    await render(album, 'exhibition', { ref, restore: unchanged, onRestored });
    assert.equal(main.scrollTop, 2170);
    assert.equal(document.activeElement, button(2));
    assert.deepEqual(restored, [request, unchanged]);
  });
});

test('照片墙以吸顶控制行下沿定位，Tab 焦点和墙面锚点避开遮挡', async () => {
  await scenario(async ({ render, worker, button, main, container, scrollWall, tab }) => {
    const album = photos('sticky', 4);
    const ref = { current: null };
    Object.defineProperty(main, 'clientHeight', { value: 400 });
    await render(album, 'exhibition', { ref, restore: { id: album[3].id, focus: true } });
    const header = container.querySelector('.album-detail-header');
    header.getBoundingClientRect = () => new window.DOMRect(0, 0, 896, 50);
    const current = await worker(0);
    await scrollWall(0, 54);
    await current.emit(first);
    assert.equal(header.hasAttribute('data-photo-underlay'), false);
    assert.equal(ref.current.focusViewportPhoto(album[1].id), false, '首屏保留原生 Tab 顺序');
    await current.emit({ units: [unit(2, 2200), unit(3, 4800)], height: 5100, complete: true });
    assert.equal(main.scrollTop, 4779, '照片在控制行以下的空间居中');
    assert.equal(document.activeElement, button(3));

    await scrollWall(307, 54);
    assert.equal(header.hasAttribute('data-photo-underlay'), true);
    assert.deepEqual(ref.current.viewportPhoto(album[0].id), { id: album[1].id, index: 1 });
    button(0).getBoundingClientRect = () => new window.DOMRect(0, 54 - main.scrollTop, 400, 300);
    button(1).getBoundingClientRect = () => new window.DOMRect(0, 358 - main.scrollTop, 400, 300);
    await act(async () => assert.equal(ref.current.focusViewportPhoto(album[0].id), true));
    assert.equal(document.activeElement, button(1));
    assert.equal(main.scrollTop, 307);
    assert.equal(await tab(button(1), true), true);
    assert.equal(document.activeElement, button(0));
    assert.equal(main.scrollTop, 0);

  }, { sticky: true });
});

test('展览首段可用后只交接可见单位，深处锚点等待最终布局', async () => {
  for (const target of [0, 1, 3]) {
    await scenario(async ({ render, worker, main, scrollWall }) => {
      const album = photos(`reveal-${target}`, 4);
      const revealed = [];
      const onReveal = (elements) => revealed.push(elements.flatMap((element) =>
        [...element.querySelectorAll('[data-photo-index]')].map((item) => Number(item.dataset.photoIndex))));
      Object.defineProperty(main, 'clientHeight', { value: 650 });
      await render(album, 'exhibition', { restore: { id: album[target].id }, onReveal });
      const current = await worker(0);
      await scrollWall(0);
      assert.deepEqual(revealed, []);
      await current.emit(first);
      assert.deepEqual(revealed, target < 2 ? [[0, 1]] : []);
      if (target < 2) await render(album);
      await current.emit({ units: [unit(2, 2200), unit(3, 4800)], height: 5100, complete: true });
      assert.deepEqual(revealed.at(-1), target < 2 ? [0, 1] : [3]);
    });
  }
});

test('展览首段计算失败时结束当前过渡请求', async () => {
  await scenario(async ({ render, worker, container }) => {
    const revealed = [];
    await render(photos('reveal-error'), 'exhibition', { onReveal: (elements) => revealed.push(elements) });
    const current = await worker(0);
    assert.deepEqual(revealed, []);
    await current.emit({ error: '无法准备照片布局' });
    assert.deepEqual(revealed, [[]]);
    assert.equal(container.querySelector('[role="alert"]').textContent, '无法准备照片布局');
  });
});

test('首段可浏览，Tab 等待未挂载的邻照，滚动恢复等到最终高度', async () => {
  await scenario(async ({ render, worker, tab, canvas, button, ready }) => {
    await render(photos('keyboard'));
    const current = await worker(0);
    assert.equal(canvas().getAttribute('aria-busy'), 'true');
    await current.emit(first);
    assert.equal(canvas().getAttribute('aria-busy'), 'false');
    assert.equal(canvas().dataset.layoutPending, 'true');
    assert.equal(canvas().style.height, '604px');
    assert.equal(ready(), 0);
    await act(async () => button(1).focus());
    assert.equal(await tab(button(1)), true);
    assert.equal(document.activeElement, button(1));
    assert.equal(button(2), null);
    await current.emit(final);
    assert.equal(document.activeElement, button(2));
    assert.equal(canvas().dataset.layoutPending, undefined);
    assert.equal(canvas().style.height, '2500px');
    assert.equal(ready(), 1);
    assert.equal(await tab(button(2), true), true);
    assert.equal(document.activeElement, button(1));
  });
});

test('等待邻照时移走焦点，后台完成后不再移动焦点', async () => {
  await scenario(async ({ render, worker, tab, button, outside }) => {
    await render(photos('cancel-focus'));
    const current = await worker(0);
    await current.emit(first);
    await act(async () => button(1).focus());
    assert.equal(await tab(button(1)), true);
    await act(async () => outside.focus());
    await current.emit(final);
    assert.equal(document.activeElement, outside);
    assert.equal(button(2), null);
  });
});

test('展览缩放将第32张移入另一块时，等待中的 Tab 仍跨到第33张', async () => {
  const shapes = [[6000, 4000], [4000, 6000], [4000, 4000]];
  const mixed = photos('resize-focus', 162).map((photo, index) => {
    const [width, height] = shapes[(index * 2) % shapes.length];
    return { ...photo, width: width + index * 5, height: height + index * 31 };
  });
  await scenario(async ({ render, worker, resize, tab, button, scrollWall }) => {
    await render(mixed);
    const narrow = await worker(0);
    const narrowPrefix = photoWallLayoutBatches(narrow.input).next().value;
    await narrow.emit(narrowPrefix);
    await scrollWall(narrowPrefix.height - 880);
    const original = button(31);
    assert.ok(original);
    await act(async () => original.focus());
    assert.equal(await tab(original), true);
    assert.equal(document.activeElement, original);

    await resize(1296);
    const wide = await worker(1);
    const remaining = photoWallLayoutBatches(wide.input);
    const widePrefix = remaining.next().value;
    assert.equal(narrowPrefix.units.at(-1).tiles[0].index, 26);
    assert.equal(widePrefix.units.at(-1).tiles[0].index, 27);
    await wide.emit(widePrefix);
    assert.equal(original.isConnected, false);
    assert.equal(document.activeElement, button(31));
    assert.equal(button(32), null);
    for (const batch of remaining) await wide.emit(batch);
    assert.equal(document.activeElement, button(32));
  });
});

test('快速切模式、切相簿和改宽度时忽略旧 Worker，并保留正在浏览的范围', async () => {
  await scenario(async ({ render, worker, resize, canvas, button, ready, container }) => {
    const album = photos('old-album');
    await render(album);
    const old = await worker(0);
    await old.emit(first);
    await render(album, 'grid');
    assert.equal(old.stopped, true);
    await old.emit({ error: '旧布局错误' });
    assert.equal(container.querySelector('[role="alert"]'), null);
    assert.equal(canvas().classList.contains('grid'), true);
    assert.equal(ready(), 1);

    await render(photos('new-album'));
    const previousSize = await worker(1);
    await old.emit(final);
    assert.equal(button(0), null);
    await previousSize.emit(first);
    assert.equal(button(0).closest('article').dataset.photoId, 'new-album-0');
    await resize(792);
    const newSize = await worker(2);
    assert.equal(newSize.input.width, 792);
    assert.equal(previousSize.stopped, true);
    await previousSize.emit(final);
    assert.equal(canvas().style.height, '604px');
    assert.equal(ready(), 1);
    await newSize.emit({ units: [unit(0, 0, 240)], height: 240, complete: false });
    assert.equal(canvas().style.height, '604px');
    await newSize.emit({ units: [unit(1, 244), unit(2, 548)], height: 848, complete: true });
    assert.equal(canvas().style.height, '848px');
    assert.equal(ready(), 2);
  });
});
