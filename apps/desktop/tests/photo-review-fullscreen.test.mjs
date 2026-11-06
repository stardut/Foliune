import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'Element', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = key === 'window' ? window : window[key];
  Object.defineProperty(globalThis, key, { configurable: true, value: key.endsWith('AnimationFrame') ? value.bind(window) : value });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, StrictMode, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: {
    contents: "export { PhotoReview } from './PhotoReview'; export { PhotoReviewImage as ActualReviewImage } from './PhotoReviewImage.tsx';",
    resolveDir: fileURLToPath(new URL('../src/features/', import.meta.url)),
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, loader: { '.css': 'empty' },
  plugins: [{ name: 'review-boundaries', setup(build) {
    build.onResolve({ filter: /^(?:@tauri-apps\/api\/(?:core|window|webview)|\.\.?\/.*(?:\/api|PhotoReviewImage))$/ }, ({ path }) => ({ path, namespace: 'review-boundary' }));
    build.onLoad({ filter: /.*/, namespace: 'review-boundary' }, ({ path }) => ({
      contents: {
        '@tauri-apps/api/core': 'export const isTauri = () => true;',
        '@tauri-apps/api/window': 'export const getCurrentWindow = () => globalThis.reviewWindow;',
        '@tauri-apps/api/webview': 'export const getCurrentWebview = () => globalThis.reviewWebview;',
      }[path] ?? (path.endsWith('/api')
        ? 'export const readPhotoMetadata = () => { throw new Error("Unexpected photo metadata request"); };'
        : `export const PhotoReviewImage = ({ state }) => state.current.photo.id;
          export function useReviewPresentation(photos, id) {
            return { state: { current: { photo: photos.find(photo => photo.id === id) }, waiting: false }, controller: {} };
          }`),
    }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { PhotoReview, ActualReviewImage } = module.exports;

const photos = ['first', 'middle', 'last'].map(id => ({ id, title: id, originalPath: `/test/${id}.jpg`, originalAvailable: true }));

async function scenario(t, entry, run, { mac = false } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  t.mock.getter(window.navigator, 'userAgent', () => mac ? 'Macintosh' : 'Windows');
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  const resizeListeners = new Set();
  const fullscreenListeners = new Set();
  const requests = [], closed = [], focusEvents = [];
  let nativeFullscreen = false, nativeFocused = true;
  globalThis.reviewWindow = {
    async onResized(listener) { resizeListeners.add(listener); return () => resizeListeners.delete(listener); },
    async listen(event, listener) {
      assert.equal(event, 'review-fullscreen-changed');
      fullscreenListeners.add(listener);
      return () => fullscreenListeners.delete(listener);
    },
    async isFullscreen() { return nativeFullscreen; },
    async isFocused() { return nativeFocused; },
    async setFullscreen(target) { requests.push(target); },
  };
  globalThis.reviewWebview = { async setFocus() { focusEvents.push('webview'); } };
  const dialog = () => container.querySelector('dialog');
  const stage = () => dialog().querySelector('.photo-review-stage');
  const key = async (value, options) => {
    const event = new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
    await act(async () => stage().dispatchEvent(event));
    return event;
  };
  const tick = ms => act(async () => t.mock.timers.tick(ms));
  function nativeResize(fullscreen, focused = true) {
    nativeFullscreen = fullscreen;
    nativeFocused = focused;
    for (const listener of resizeListeners) listener();
    return tick(120);
  }
  function nativeDidChange(fullscreen) {
    return act(async () => {
      nativeFullscreen = fullscreen;
      for (const listener of fullscreenListeners) listener({ payload: fullscreen });
    });
  }
  try {
    await act(async () => root.render(h(StrictMode, null, h(PhotoReview, {
      photos, initialPhotoId: 'middle', context: '相簿', busy: false, onRelink() {}, fullscreen: entry,
      onClose: id => { focusEvents.push('close'); closed.push([id, dialog().open]); },
    }))));
    await run({ dialog, stage, key, tick, nativeResize, nativeDidChange, requests, closed, focusEvents });
  } finally {
    await act(async () => root.unmount());
    assert.equal(resizeListeners.size, 0);
    assert.equal(fullscreenListeners.size, 0);
    container.remove();
    delete globalThis.reviewWindow;
    delete globalThis.reviewWebview;
  }
}

test('直接全屏只显示目标照片，方向键、指针和 Tab 不显示控件', async (t) => {
  await scenario(t, 'direct', async ({ dialog, stage, key, tick, nativeResize, requests, closed, focusEvents }) => {
    assert.deepEqual(requests, [true]);
    assert.equal(dialog().dataset.fullscreen, 'true');
    assert.equal(stage().textContent, 'middle');
    assert.equal(dialog().querySelector('h2').id, dialog().getAttribute('aria-labelledby'));
    const assertNoChrome = () => assert.equal(dialog().querySelector('header, footer, button, [role=status], [role=alert]'), null);
    assertNoChrome();
    await nativeResize(true);
    await tick(2200);
    await key('ArrowRight');
    assert.equal(stage().textContent, 'last');
    await act(async () => stage().dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true })));
    assert.equal((await key('Tab')).defaultPrevented, true);
    assert.equal((await key('Tab', { shiftKey: true })).defaultPrevented, true);
    assert.equal(document.activeElement, stage());
    assertNoChrome();
    await key('Escape');
    assert.deepEqual(requests, [true, false]);
    assert.deepEqual(closed, []);
    await nativeResize(false);
    assert.deepEqual(closed, [['last', false]]);
    assert.deepEqual(focusEvents, ['webview', 'close']);
  });
});

test('从大图用 F 切换全屏，退回后仍停在当前照片并显示窗口控件', async (t) => {
  await scenario(t, 'available', async ({ dialog, stage, key, nativeResize, requests, closed, focusEvents }) => {
    await key('f', { metaKey: true });
    assert.deepEqual(requests, []);
    await key('f');
    await nativeResize(true);
    await key('ArrowLeft');
    assert.equal(stage().textContent, 'first');
    assert.equal(dialog().querySelector('[aria-label="退出全屏"]'), null);
    await key('f');
    assert.deepEqual(requests, [true, false]);
    await nativeResize(false);
    assert.equal(dialog().dataset.fullscreen, undefined);
    assert.equal(stage().textContent, 'first');
    assert.ok(dialog().querySelector('[aria-label="全屏查看"]'));
    assert.ok(dialog().querySelector('[aria-label="照片信息"]'));
    assert.deepEqual(closed, []);
    assert.deepEqual(focusEvents, ['webview']);
    assert.equal(document.activeElement, stage());
    await key('Escape', { repeat: true });
    assert.deepEqual(closed, []);
    await key('Escape');
    assert.deepEqual(closed, [['first', false]]);
  });
});

test('全屏无加载和缺失提示，退回窗口后原件恢复入口仍可用', async () => {
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  const state = { current: { key: 1, kind: 'error', photo: photos[1] }, incoming: null, outgoing: null, waiting: true, direction: 0 };
  const render = (fullscreen) => act(async () => root.render(h(ActualReviewImage, { state, fullscreen, allowZoom: false, busy: false, controller: {}, onRelink() {} })));
  try {
    await render(true);
    assert.equal(container.querySelector('.missing-photo, .photo-review-loading, button'), null);
    await render(false);
    assert.ok(container.querySelector('.missing-photo button'));
    assert.ok(container.querySelector('.photo-review-loading'));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test('系统退出后台直接全屏时返回图库，不抢焦点或重复调用窗口命令', async (t) => {
  await scenario(t, 'direct', async ({ nativeResize, requests, closed, focusEvents }) => {
    await nativeResize(true);
    await nativeResize(false, false);
    assert.deepEqual(closed, [['middle', false]]);
    assert.deepEqual(requests, [true]);
    assert.deepEqual(focusEvents, ['close']);
  });
});

test('系统未进入全屏时解除过渡并保留可操作的大图', async (t) => {
  await scenario(t, 'direct', async ({ dialog, key, tick, nativeResize, requests, closed }) => {
    const read = globalThis.reviewWindow.isFullscreen;
    let finishFirstCheck;
    globalThis.reviewWindow.isFullscreen = () => {
      globalThis.reviewWindow.isFullscreen = read;
      return new Promise(resolve => { finishFirstCheck = resolve; });
    };
    await tick(1540);
    // A late resize can supersede the deadline's pending read.
    await nativeResize(false);
    assert.equal(dialog().querySelector('[role=alert]').textContent, '无法进入全屏。');
    assert.equal(dialog().dataset.fullscreen, undefined);
    await act(async () => finishFirstCheck(false));
    await key('f');
    await nativeResize(true);
    assert.equal(dialog().querySelector('[role=alert]'), null);
    await nativeResize(false);
    assert.equal(dialog().open, true);
    assert.deepEqual(closed, []);
    assert.deepEqual(requests, [true, true]);
  });
});

test('macOS 等 AppKit 完成退全屏才恢复键盘焦点', async (t) => {
  await scenario(t, 'available', async ({ dialog, stage, key, nativeResize, nativeDidChange, requests, focusEvents, closed }) => {
    await key('f');
    await nativeDidChange(true);
    await key('ArrowRight');
    await key('Escape');
    assert.deepEqual(requests, [true, false]);
    await nativeResize(false);
    assert.equal(dialog().dataset.fullscreen, 'true');
    assert.deepEqual(focusEvents, []);
    await nativeDidChange(false);
    assert.equal(dialog().dataset.fullscreen, undefined);
    assert.equal(stage().textContent, 'last');
    assert.equal(document.activeElement, stage());
    assert.deepEqual(focusEvents, ['webview']);
    await key('Escape');
    assert.deepEqual(closed, [['last', false]]);
  }, { mac: true });
});
