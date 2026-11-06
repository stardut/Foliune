import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'document' ? window.document : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.IntersectionObserver = class { constructor(callback) { this.callback = callback; } observe(target) { this.callback([{ target, isIntersecting: true }]); } disconnect() {} };
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 240 });
const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  entryPoints: [resolve('apps/desktop/src/features/books/BookCover.tsx')], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent', loader: { '.css': 'empty' },
  plugins: [{ name: 'cover-browser-boundary', setup(build) {
    build.onResolve({ filter: /\/book-cover-design$/ }, ({ path }) => ({ path, namespace: 'cover-design' }));
    build.onLoad({ filter: /.*/, namespace: 'cover-design' }, () => ({ contents: `export const coverFontFamily = 'test'; export const validCoverSize = () => true;
      export const fitCoverTitle = (...args) => globalThis.coverMock.fit(...args);
      export const designCoverTitle = (...args) => globalThis.coverMock.design(...args);
      export const loadCoverSample = (...args) => globalThis.coverMock.sample(...args);` }));
    build.onResolve({ filter: /\/PhotoImage$/ }, ({ path }) => ({ path, namespace: 'cover-photo' }));
    build.onLoad({ filter: /.*/, namespace: 'cover-photo' }, () => ({ contents: 'export const PhotoImage = () => null;' }));
  } }],
});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const layout = { lines: [[{ text: '山间', italic: false }]], size: 30, width: 60, height: 34, lineHeight: 34 };
async function scenario(run) {
  const calls = { fonts: 0, fits: 0, samples: 0, designs: 0 };
  const fonts = deferred();
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load() { calls.fonts++; return fonts.promise; } } });
  const originalCreateElement = document.createElement;
  document.createElement = new Proxy(originalCreateElement, { apply(target, receiver, args) {
    const result = Reflect.apply(target, receiver, args);
    if (args[0] === 'canvas') result.getContext = () => ({ measureText: () => ({ width: 60 }) });
    return result;
  } });
  globalThis.coverMock = {
    fit() { calls.fits++; return layout; },
    sample: async () => { calls.samples++; return {}; },
    design() { calls.designs++; return { layout, placement: { x: .08, y: .07, color: '#fff' } }; },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const container = document.createElement('div'); document.body.append(container);
  let root;
  const photo = { thumbnailUrl: 'asset://cover.jpg', width: 960, height: 640, originalAvailable: true, thumbnailAvailable: true, regions: [] };
  const rerender = async (props = {}) => { await act(async () => root.render(h(module.exports.BookCover, { title: '山间', photo, hasPhotos: true, busy: false, ...props }))); };
  const mount = async (props = {}) => { root = createRoot(container); await rerender(props); };
  const unmount = async () => { if (root) { await act(async () => root.unmount()); root = undefined; } };
  const flush = async () => { await act(async () => { fonts.resolve([{}]); await new Promise(done => setTimeout(done, 70)); }); };
  try { await run({ calls, fonts, mount, unmount, flush, container, rerender, Cover: module.exports.BookCover, photo }); }
  finally { await unmount(); container.remove(); document.createElement = originalCreateElement; }
}
test('窄窗首次封面只在真实尺寸准备一次，不分析预设260px', async () => scenario(async ({ mount, flush, calls }) => {
  await mount(); await flush();
  assert.deepEqual(calls, { fonts: 3, fits: 0, samples: 1, designs: 1 });
}));
test('离开工作区后字体迟到不再测量标题或分析图片', async () => scenario(async ({ mount, unmount, flush, calls }) => {
  await mount(); await unmount(); await flush();
  assert.equal(calls.samples, 0); assert.equal(calls.designs, 0); assert.equal(calls.fits, 0);
}));
test('再次进入书架复用相同封面设计，改名后重新分析', async () => scenario(async ({ mount, unmount, flush, calls, container }) => {
  await mount(); await flush(); await unmount(); await mount(); await flush();
  assert.equal(calls.samples, 1); assert.equal(calls.designs, 1); assert.equal(calls.fonts, 3);
  assert.equal(container.querySelector('[role=status]'), null);
  await unmount(); await mount({ title: '新标题' }); await flush();
  assert.equal(calls.samples, 2); assert.equal(calls.designs, 2);
}));

test('视区外封面保持原名可见，进入邻近视区后才分析并清理Observer', async () => {
  const original = globalThis.IntersectionObserver;
  let observer; let disconnected = 0;
  globalThis.IntersectionObserver = class { constructor(callback) { observer = this; this.callback = callback; } observe(target) { this.target = target; } disconnect() { disconnected++; } };
  try {
    await scenario(async ({ mount, flush, calls, container }) => {
      await mount(); await flush();
      assert.deepEqual(calls, { fonts: 0, fits: 0, samples: 0, designs: 0 });
      assert.equal(container.querySelector('.book-cover-title').textContent, '山间');
      await act(async () => observer.callback([{ target: observer.target, isIntersecting: true }]));
      await flush(); assert.equal(calls.designs, 1); assert.ok(disconnected > 0);
    });
    assert.ok(disconnected >= 2);
  } finally { globalThis.IntersectionObserver = original; }
});

test('离开工作区取消待运行idle任务，即使迟到回调执行也不分析', async () => {
  const originalRequest = window.requestIdleCallback; const originalCancel = window.cancelIdleCallback;
  let callback; let cancelled = 0;
  window.requestIdleCallback = run => { callback = run; return 5; };
  window.cancelIdleCallback = id => { assert.equal(id, 5); cancelled++; };
  try {
    await scenario(async ({ mount, flush, unmount, calls }) => {
      await mount(); await flush(); assert.equal(calls.designs, 0); assert.equal(typeof callback, 'function');
      await unmount(); callback(); assert.equal(calls.designs, 0); assert.equal(cancelled, 1);
    });
  } finally { window.requestIdleCallback = originalRequest; window.cancelIdleCallback = originalCancel; }
});

test('字体失败与分析异常不写成功缓存，重新进入可恢复', async () => scenario(async ({ mount, flush, unmount, calls, container }) => {
  document.fonts.load = async () => { throw new Error('字体读取失败'); };
  await mount(); await flush(); assert.equal(calls.designs, 0);
  assert.equal(container.querySelector('[role=status]').textContent, '封面字体不可用');
  document.fonts.load = async () => [{}];
  const design = globalThis.coverMock.design;
  globalThis.coverMock.design = () => { throw new Error('分析异常'); };
  await unmount(); await mount(); await flush();
  assert.equal(container.querySelector('[role=status]').textContent, '封面分析不可用');
  globalThis.coverMock.design = design;
  await unmount(); await mount(); await flush(); assert.equal(calls.designs, 1);
  assert.equal(container.querySelector('[role=status]'), null);
}));

test('照片地址、原尺寸与区域变化失效旧缓存，返回原输入复用', async () => scenario(async ({ mount, flush, unmount, calls }) => {
  const photo = { thumbnailUrl: 'asset://cover.jpg', width: 960, height: 640, originalAvailable: true, thumbnailAvailable: true, regions: [] };
  await mount(); await flush();
  for (const change of [{ thumbnailUrl: 'asset://cover-new.jpg' }, { width: 640, height: 960 }, { regions: [{ x: .1, y: .1, width: .2, height: .3 }] }]) {
    await unmount(); await mount({ photo: { ...photo, ...change } }); await flush();
  }
  assert.equal(calls.designs, 4);
  await unmount(); await mount(); await flush(); assert.equal(calls.designs, 4);
}));

test('已挂载封面命中缓存后，其他128份设计触发淘汰也保留当前排版', async () => scenario(async ({ mount, unmount, flush, rerender, Cover, photo, calls, container }) => {
  await mount(); await flush(); await unmount(); await mount(); await flush();
  assert.equal(calls.designs, 1);
  const layoutBefore = container.querySelector('.book-cover-title').outerHTML;
  const otherContainer = document.createElement('div'); document.body.append(otherContainer);
  const otherRoot = createRoot(otherContainer);
  try {
    await act(async () => otherRoot.render(h('div', null, Array.from({ length: 128 }, (_, index) => h(Cover, { key: index, title: `其他画册${index}`, photo, hasPhotos: true, busy: false })))));
    await flush(); assert.equal(calls.designs, 129);
    await rerender({ busy: true });
    assert.equal(!!container.querySelector('[role=status]'), false, 'busy重渲染保留已取得的排版，不退回永久等待');
    assert.equal(container.querySelector('.book-cover-title').outerHTML, layoutBefore);
    await unmount(); await mount(); await flush();
    assert.equal(calls.designs, 130, '原缓存确已淘汰，新实例重新分析');
  } finally { await act(async () => otherRoot.unmount()); otherContainer.remove(); }
}));
