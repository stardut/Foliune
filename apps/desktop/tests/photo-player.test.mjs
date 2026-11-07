import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'HTMLInputElement', 'HTMLSelectElement', 'Element', 'Node', 'Event', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const motionPreference = new window.EventTarget();
motionPreference.matches = false;
window.matchMedia = () => motionPreference;

const pending = new WeakMap();
window.HTMLImageElement.prototype.decode = function () {
  if (!pending.has(this)) {
    let resolve, reject;
    const promise = new Promise((done, failed) => { resolve = done; reject = failed; });
    pending.set(this, { promise, resolve, reject });
  }
  return pending.get(this).promise;
};
Object.defineProperty(window.HTMLImageElement.prototype, 'naturalWidth', { get: () => 1600 });

const { createElement: h, act, StrictMode, useState } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/features/PhotoPlayer.tsx', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, loader: { '.css': 'empty' },
  plugins: [{ name: 'music-boundary', setup(build) {
    build.onResolve({ filter: /\/music-api$/ }, ({ path }) => ({ path, namespace: 'music-boundary' }));
    build.onLoad({ filter: /.*/, namespace: 'music-boundary' }, () => ({ contents: 'export const pickMusic = async () => null; export const releaseMusic = async () => {};' }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { PhotoPlayer } = module.exports;

const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
const photos = ids.map(id => ({
  id, title: id, originalName: `${id}.jpg`, originalPath: `/${id}.jpg`, originalUrl: `/${id}.jpg`,
  originalAvailable: true, thumbnailUrl: `/${id}-thumb.jpg`, thumbnailAvailable: true, width: 1600, height: 900,
}));
const complete = (image, ready = true) => act(async () => {
  assert(pending.has(image), 'actual DOM image began decoding');
  if (ready) pending.get(image).resolve();
  else pending.get(image).reject(new Error('invalid original'));
});

async function scenario(t, run) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  function Host() {
    const [open, setOpen] = useState(true);
    const [snapshot, setSnapshot] = useState(photos);
    return open && h(PhotoPlayer, {
      photos: snapshot, photoIds: ids, onClose: () => setOpen(false), onFeedback() {},
      onRelink: async (photo) => setSnapshot(previous => previous.map(item => item.id === photo.id
        ? { ...item, originalUrl: '/replacement.jpg', originalPath: '/replacement.jpg' } : item)),
    });
  }
  const stage = () => container.querySelector('.player-stage');
  const current = () => stage()?.querySelector('[data-role=current] img');
  const image = id => stage()?.querySelector(`img[src="/${id}.jpg"]`);
  const counter = () => container.querySelector('.player-counter').textContent;
  const title = () => container.querySelector('.player-top > span').textContent;
  const button = label => container.querySelector(`button[aria-label="${label}"]`);
  const click = label => act(async () => { assert(button(label), label); button(label).click(); });
  const tick = ms => act(async () => t.mock.timers.tick(ms));
  const reduce = () => act(async () => {
    motionPreference.matches = true;
    motionPreference.dispatchEvent(new Event('change'));
  });
  try {
    await act(async () => root.render(h(StrictMode, null, h(Host))));
    await run({ container, stage, current, image, counter, title, button, click, tick, reduce });
  } finally {
    await act(async () => root.unmount());
    motionPreference.matches = false;
    container.remove();
  }
}

test('首张由缩略图承托，等待期间保留在场照片，预读原图原节点进入舞台并重新计时', async (t) => {
  await scenario(t, async ({ stage, current, image, counter, title, tick }) => {
    const first = image('a'), next = image('b');
    assert.equal(current().getAttribute('src'), '/a-thumb.jpg');
    assert(image('f'), '循环开启时预读上一张末尾照片');
    assert(next.closest('[aria-hidden=true]'));
    assert(stage().querySelector('.player-entry-veil[aria-hidden=true]'));
    await tick(280);
    assert.equal(stage().querySelector('.player-entry-veil'), null);
    await tick(8720);
    assert.equal(counter(), '01 / 6');
    assert.equal(image('a'), first);
    await complete(first);
    assert.equal(current(), first);
    assert.equal(stage().querySelector('[data-role=outgoing]'), null);
    await tick(6000);
    await tick(799);
    assert.equal(stage().querySelector('.player-waiting'), null);
    await tick(1);
    assert(stage().querySelector('.player-waiting .sr-only'));
    await tick(12000);
    assert.equal(current(), first);
    assert.equal(title(), 'a');
    assert.equal(counter(), '01 / 6');
    assert.doesNotMatch(stage().textContent, /读取/);
    await complete(next);
    assert.equal(current(), next);
    assert.equal(stage().querySelector('.player-waiting'), null);
    assert.equal(title(), 'b');
    assert.equal(counter(), '02 / 6');
    assert.equal(stage().querySelector('[data-role=outgoing] img'), first);
    await tick(320);
    assert.equal(stage().querySelector('[data-role=outgoing]'), null);
    const third = image('c');
    await complete(third);
    await tick(5679);
    assert.equal(current(), next);
    await tick(1);
    assert.equal(current(), third);
  });
});

test('播放设置的下拉留在当前弹窗，方向键和 Escape 优先交给选项', async (t) => {
  await scenario(t, async ({ container, counter, click }) => {
    await click('播放与音乐设置');
    const settings = container.querySelector('.player-settings');
    const select = settings.querySelector('[role="combobox"]');
    const press = (key) => act(async () => select.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    await act(async () => select.click());
    const popup = document.getElementById(select.getAttribute('aria-controls'));
    assert.equal(popup.parentElement, container.querySelector('dialog'));
    assert.equal(popup.querySelector('[aria-selected=true]').textContent, '6 秒');
    await press('ArrowRight');
    assert.equal(counter(), '01 / 6');
    await press('ArrowDown');
    assert.equal(document.getElementById(select.getAttribute('aria-activedescendant')).textContent, '10 秒');
    await press('Escape');
    assert.equal(popup.isConnected, false);
    assert.equal(settings.isConnected, true);
    assert.equal(document.activeElement, select);
    assert.equal(select.textContent, '6 秒');
    await press('Escape');
    assert.equal(settings.isConnected, false);
    assert.equal(container.querySelector('dialog').open, true);
  });
});

test('乱序后按实际队列预读，连续键入跳过待解码帧，系统减少动效时直接交接', async (t) => {
  await scenario(t, async ({ stage, current, image, counter, title, button, click, reduce }) => {
    const first = image('a'), removed = image('b');
    await complete(first);
    await click('暂停');
    await click('关闭循环');
    assert.equal(image('f'), null);
    t.mock.method(Math, 'random', () => 0);
    await click('随机播放'); // a, c, d, e, f, b
    assert.equal(image('b'), null);
    const skipped = image('c');
    assert(skipped);
    await act(async () => {
      for (let i = 0; i < 3; i++) stage().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    assert.equal(current(), first);
    assert.equal(stage().querySelectorAll('img').length, 4);
    assert.equal(skipped.isConnected, false);
    await complete(skipped);
    await complete(removed, false);
    assert.equal(current(), first);
    await complete(image('e'));
    assert.equal(title(), 'e');
    assert.equal(counter(), '04 / 6');
    assert.equal(current().closest('[data-effect]').dataset.effect, 'dissolve');
    await reduce();
    assert.equal(stage().querySelector('[data-role=outgoing]'), null);
    await complete(image('f'));
    await click('下一张');
    assert.equal(title(), 'f');
    assert.equal(stage().querySelector('[data-role=outgoing]'), null);
    await complete(image('b'));
    await click('下一张');
    assert.equal(title(), 'b');
    assert.equal(button('下一张').disabled, true);
  });
});

test('预读失败只在目标进入时暂停并可重新定位，返回后迟到的解码不会恢复播放器', async (t) => {
  await scenario(t, async ({ container, stage, current, image, title, button, click }) => {
    await complete(image('a'));
    await complete(image('b'), false);
    assert(button('暂停'));
    assert.equal(title(), 'a');
    await click('下一张');
    assert(button('播放'));
    assert.match(stage().textContent, /图片无法读取/);
    await act(async () => stage().querySelector('button').click());
    const replacement = image('replacement');
    await complete(replacement);
    assert.equal(current(), replacement);
    assert.equal(title(), 'b');
    const next = image('c');
    const close = [...container.querySelectorAll('button')].find(element => element.textContent === '返回');
    await act(async () => close.click());
    await complete(next);
    assert.equal(container.querySelector('dialog'), null);
  });
});

test('播放器点击空白与 Escape/cancel 均不退出，设置可收起且返回仍可用', async (t) => {
  await scenario(t, async ({ container, stage, click }) => {
    const dialog = container.querySelector('dialog');
    const implicitClose = async () => {
      const cancel = new Event('cancel', { cancelable: true });
      await act(async () => {
        dialog.click();
        stage().click();
        stage().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        dialog.dispatchEvent(cancel);
      });
      assert.equal(cancel.defaultPrevented, true);
      assert.equal(dialog.open, true);
      assert.equal(dialog.isConnected, true);
    };
    await implicitClose();
    await click('播放与音乐设置');
    assert(container.querySelector('.player-settings'));
    await implicitClose();
    assert.equal(container.querySelector('.player-settings'), null);
    await act(async () => container.querySelector('.player-top .text-button').click());
    assert.equal(container.querySelector('dialog'), null);
  });
});
