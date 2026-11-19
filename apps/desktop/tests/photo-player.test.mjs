import './fixtures/chinese-interface.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
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
const playerStyle = document.head.appendChild(document.createElement('style'));
playerStyle.textContent = await readFile(new URL('../src/features/player.css', import.meta.url), 'utf8');

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
  } }, { name: 'native-window-boundary', setup(build) {
    build.onResolve({ filter: /^@tauri-apps\/api\/(window|webview)$/ }, ({ path }) => ({ path, namespace: 'native-window-boundary' }));
    build.onLoad({ filter: /.*/, namespace: 'native-window-boundary' }, ({ path }) => ({
      contents: path.endsWith('/window') ? 'export const getCurrentWindow = () => globalThis.playerWindow;'
        : 'export const getCurrentWebview = () => ({ setFocus: async () => {} });',
    }));
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

async function scenario(t, run, { host, preferences = {}, music = null, sample = photos, mac = false, stageSize = { width: 1000, height: 700 }, screenSize = { width: 1600, height: 900 } } = {}) {
  if (host) globalThis.playerWindow = host;
  t.mock.getter(window.navigator, 'userAgent', () => mac ? 'Macintosh' : 'Windows');
  Object.defineProperty(window.screen, 'width', { configurable: true, value: screenSize.width });
  Object.defineProperty(window.screen, 'height', { configurable: true, value: screenSize.height });
  const size = { ...stageSize };
  t.mock.getter(HTMLElement.prototype, 'clientWidth', () => size.width);
  t.mock.getter(HTMLElement.prototype, 'clientHeight', () => size.height);
  // WebKit may stop delivering rendering callbacks during native Space changes.
  t.mock.method(window, 'requestAnimationFrame', () => 1);
  t.mock.method(window, 'cancelAnimationFrame', () => {});
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const feedback = [];
  function Host() {
    const [open, setOpen] = useState(true);
    const [snapshot, setSnapshot] = useState(sample);
    return h('div', null,
      h('main', { className: 'source-album' }, h('img', { src: '/live-album.jpg', alt: '来源相簿' })),
      open && h(PhotoPlayer, {
      photos: snapshot, photoIds: ids, preferences: { seconds: 6, volume: .35, random: false, loop: true, musicId: 'off', ...preferences },
      music, analysis: null, onClose: () => setOpen(false), onFeedback: message => feedback.push(message),
      onRelink: async (photo) => setSnapshot(previous => previous.map(item => item.id === photo.id
        ? { ...item, originalUrl: '/replacement.jpg', originalPath: '/replacement.jpg' } : item)),
    }));
  }
  const stage = () => container.querySelector('.player-stage');
  const current = () => stage()?.querySelector('[data-role=current] img');
  const image = id => stage()?.querySelector(`img[src="/${id}.jpg"]`);
  const key = value => act(async () => {
    assert(container.contains(document.activeElement), '真实键盘焦点留在当前欣赏');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  });
  const tick = ms => act(async () => t.mock.timers.tick(ms));
  const reduce = () => act(async () => {
    motionPreference.matches = true;
    motionPreference.dispatchEvent(new Event('change'));
  });
  try {
    await act(async () => root.render(h(StrictMode, null, h(Host))));
    await run({ container, stage, current, image, key, tick, reduce, feedback, size });
  } finally {
    await act(async () => root.unmount());
    motionPreference.matches = false;
    delete globalThis.isTauri;
    delete globalThis.playerWindow;
    container.remove();
    t.mock.timers.reset();
  }
}

test('首张缩略图承托，原图交接重新计时，纯照片舞台没有播放器控件与鼠标唤醒', async (t) => {
  await scenario(t, async ({ container, stage, current, image, tick, key }) => {
    const first = image('a'), next = image('b');
    assert.equal(current().getAttribute('src'), '/a-thumb.jpg');
    assert(image('f'), '循环开启时预读上一张末尾照片');
    assert(next.closest('[aria-hidden=true]'));
    assert.equal(stage().getAttribute('aria-hidden'), 'false', '浏览器窗口预览默认可见');
    await tick(9000);
    assert.equal(image('a'), first);
    await complete(first);
    assert.equal(current(), first);
    await tick(6000);
    await tick(800);
    assert(stage().querySelector('.player-waiting .sr-only'));
    await tick(12000);
    assert.equal(current(), first);
    await complete(next);
    assert.equal(current(), next);
    assert.equal(stage().querySelector('[data-role=outgoing] img'), first);
    await tick(320);
    assert.equal(stage().querySelector('[data-role=outgoing]'), null);
    const third = image('c');
    await complete(third);
    await tick(5679);
    assert.equal(current(), next);
    await tick(1);
    assert.equal(current(), third);
    await act(async () => stage().dispatchEvent(new Event('pointermove', { bubbles: true })));
    await key(' ');
    await tick(3000);
    assert.equal(container.querySelector('button, .player-top, .player-counter, .player-controls, .player-settings'), null);
    assert.equal(container.querySelector('.player-awake'), null);
    await key('ArrowRight');
    await complete(image('d'));
    assert.equal(current(), image('d'));
  });
});

test('设置中的乱序和循环用于新会话，连续方向键按实际队列，减少动效时直接交接', async (t) => {
  t.mock.method(Math, 'random', () => 0); // a, c, d, e, f, b
  await scenario(t, async ({ stage, current, image, key, reduce }) => {
    const first = image('a'), skipped = image('c');
    await complete(first);
    assert.equal(image('f'), null);
    assert.equal(image('b'), null);
    assert(skipped);
    await act(async () => {
      for (let i = 0; i < 3; i++) stage().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    assert.equal(current(), first);
    assert.equal(skipped.isConnected, false);
    await complete(skipped);
    assert.equal(current(), first);
    await complete(image('e'));
    assert.equal(current(), image('e'));
    assert.equal(current().closest('[data-effect]').dataset.effect, 'glide');
    await reduce();
    assert.equal(stage().querySelector('[data-role=outgoing]'), null);
    await complete(image('f'));
    await key('ArrowRight');
    assert.equal(current(), image('f'));
    await complete(image('b'));
    await key('ArrowRight');
    assert.equal(current(), image('b'));
    await key('ArrowRight');
    assert.equal(current(), image('b'));
  }, { preferences: { random: true, loop: false } });
});

test('原图失败保留重连，重连后自动恢复，Escape 返回后迟到解码不复活', async (t) => {
  await scenario(t, async ({ container, stage, current, image, key, tick }) => {
    await complete(image('a'));
    await complete(image('b'), false);
    assert.equal(current(), image('a'));
    await key('ArrowRight');
    assert.match(stage().textContent, /图片无法读取/);
    await act(async () => stage().querySelector('button').click());
    const replacement = image('replacement');
    await complete(replacement);
    assert.equal(current(), replacement);
    const next = image('c');
    await complete(next);
    await tick(6000);
    assert.equal(current(), next);
    const later = image('d');
    await key('Escape');
    await complete(later);
    assert.equal(container.querySelector('dialog'), null);
  });
});

test('点击舞台不退出，窗口模式与 cancel 均保留 Escape 结束出口', async (t) => {
  await scenario(t, async ({ container, stage, key }) => {
    const dialog = container.querySelector('dialog');
    await act(async () => { dialog.click(); stage().click(); });
    assert.equal(dialog.open, true);
    await key('Escape');
    assert.equal(container.querySelector('dialog'), null);
  });
  await scenario(t, async ({ container }) => {
    const cancel = new Event('cancel', { cancelable: true });
    await act(async () => container.querySelector('dialog').dispatchEvent(cancel));
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(container.querySelector('dialog'), null);
  });
});

test('原生入场透出真实来源相簿，最终整组准备好才把照片与深底一起显影', async (t) => {
  globalThis.isTauri = true;
  let full = false;
  const listeners = new Set();
  await scenario(t, async ({ container, stage, image, tick, size }) => {
    const source = container.querySelector('.source-album');
    const sourcePhoto = source.querySelector('img');
    const dialog = container.querySelector('dialog');
    const background = window.getComputedStyle(dialog).backgroundColor;
    assert(['transparent', 'rgba(0, 0, 0, 0)'].includes(background), 'dialog 自身不能先挡住来源相簿');
    const backdrop = [...playerStyle.sheet.cssRules].find(rule => rule.selectorText === '.photo-player::backdrop');
    assert.equal(backdrop.style.background, 'transparent', 'top layer 遮罩也须透出来源相簿');
    const surface = container.querySelector('.player-surface');
    assert(surface.contains(stage()), '照片与深底在同一交接层');
    assert.equal(window.getComputedStyle(surface).backgroundColor, '#0c0d0e');
    const motion = [...playerStyle.sheet.cssRules].find(rule => rule.conditionText === '(prefers-reduced-motion: no-preference)');
    const fade = [...motion.cssRules].find(rule => rule.selectorText === '.player-surface');
    assert.equal(fade.style.transition, 'opacity 140ms ease-in-out', '整层仅在未减少动态效果时过渡');
    assert.notEqual(window.getComputedStyle(source).visibility, 'hidden');
    assert.notEqual(window.getComputedStyle(source).display, 'none');
    sourcePhoto.src = '/live-album-updated.jpg';
    assert.equal(window.getComputedStyle(surface).opacity, '0');
    assert.equal(stage().getAttribute('aria-hidden'), 'true');
    assert.equal(stage().inert, true);
    const first = image('a');
    await complete(first);
    await tick(1000);
    assert.equal(window.getComputedStyle(surface).opacity, '0');
    size.width = 1600; size.height = 900;
    full = true;
    await act(async () => { for (const listener of listeners) listener({ payload: true }); });
    await complete(image('b'));
    assert.equal(window.getComputedStyle(surface).opacity, '0', '最终三联未齐不能先显深底');
    await complete(image('c'));
    assert.equal(window.getComputedStyle(surface).opacity, '1', '默认可见，无需 animationend 或 rAF');
    assert.equal(stage().inert, false);
    assert.equal(image('a'), first);
    assert.equal(container.querySelector('.source-album img'), sourcePhoto, '来源保持真实节点，不替换为截图');
    assert.match(sourcePhoto.src, /live-album-updated/);
    assert.equal(stage().querySelectorAll('[data-role=current] img').length, 3);
  }, { mac: true, screenSize: { width: 700, height: 900 }, stageSize: { width: 700, height: 900 }, sample: photos.map(photo => ({ ...photo, width: 600, height: 900 })), host: {
    async isFullscreen() { return full; },
    async setFullscreen() {},
    async listen(event, listener) { listeners.add(listener); return () => listeners.delete(listener); },
  } });
});

test('减少动态效果时透明交接，32ms后退出原生全屏并返回来源页', async (t) => {
  let full = false;
  const listeners = new Set(), requests = [];
  globalThis.isTauri = true;
  await scenario(t, async ({ container, image, key, tick, reduce }) => {
    await complete(image('a'));
    await reduce();
    const report = async (value) => {
      full = value;
      await act(async () => { for (const listener of listeners) listener(); });
      await tick(120);
    };
    assert.deepEqual(requests, [true]);
    await report(true);
    assert.equal(container.querySelector('dialog').dataset.fullscreen, 'true');
    await key('Escape');
    await tick(32);
    assert.deepEqual(requests, [true, false]);
    assert.equal(container.querySelector('dialog').open, true);
    await report(false);
    assert.equal(container.querySelector('dialog'), null);
  }, { host: {
    async isFullscreen() { return full; },
    async setFullscreen(value) { requests.push(value); },
    async onResized(handler) { listeners.add(handler); return () => listeners.delete(handler); },
  } });
});

test('原生进入全屏失败仍可 Escape 返回并显示失败信息', async (t) => {
  globalThis.isTauri = true;
  await scenario(t, async ({ container, stage, image, key, feedback }) => {
    await complete(image('a'));
    assert.equal(container.querySelector('dialog').dataset.fullscreen, undefined);
    assert.deepEqual(feedback, []);
    assert.match(container.querySelector('[role=alert]').textContent, /无法进入全屏.*Escape 返回/);
    await complete(image('a'));
    assert.notEqual(window.getComputedStyle(stage().parentElement).opacity, '0', '进入失败后仍可看照片');
    assert.equal(document.activeElement, stage());
    await key('Escape');
    assert.equal(container.querySelector('dialog'), null);
    assert.deepEqual(feedback, []);
  }, { host: {
    async isFullscreen() { return false; },
    async setFullscreen() { throw new Error('rejected'); },
    async onResized() { return () => {}; },
  } });
});

test('AppKit 完成前透出相簿，完成后按当前尺寸准备整组，切换期间计时与方向键不抢跑', async (t) => {
  globalThis.isTauri = true;
  let full = false;
  const listeners = new Set();
  await scenario(t, async ({ stage, current, image, key, tick, size, reduce }) => {
    const hidden = () => window.getComputedStyle(stage().parentElement).opacity === '0';
    assert(hidden(), 'entering 不得露出窗口比例缩略图');
    const first = image('a');
    await complete(first);
    await tick(2000);
    await key('ArrowRight');
    assert.equal(current(), first, '未显影时不切图');
    assert(hidden(), '即使原图解码完成也要等待原生完成事件');
    await reduce();
    assert(hidden(), '减少动态效果也必须遮蔽原生切换过程');
    // Do not deliver ResizeObserver: completion must measure the actual final stage itself.
    size.width = 1600;
    size.height = 900;
    full = true;
    await act(async () => { for (const listener of listeners) listener({ payload: true }); });
    assert(hidden(), '最终三联尚未全部准备好，不显示旧单幅');
    await complete(image('b'));
    assert(hidden());
    await complete(image('c'));
    assert.equal(hidden(), false);
    assert.equal(stage().querySelectorAll('[data-role=current] img').length, 3);
    assert.equal(image('a'), first, '原生切换中保留解码的真实图片节点');
    await tick(999);
    assert.equal(current(), first);
    await tick(1);
    await complete(image('d'));
    await complete(image('e'));
    await complete(image('f'));
    assert.equal(current(), image('d'));
  }, { mac: true, screenSize: { width: 700, height: 900 }, preferences: { seconds: 1 }, stageSize: { width: 700, height: 900 }, sample: photos.map(photo => ({ ...photo, width: 600, height: 900 })), host: {
    async isFullscreen() { return full; },
    async setFullscreen() {},
    async listen(event, listener) { assert.equal(event, 'review-fullscreen-changed'); listeners.add(listener); return () => listeners.delete(listener); },
  } });
});

test('Escape 把照片与深底一起淡回相簿，绘制帧不回调仍退出，失败恢复可重试', async (t) => {
  globalThis.isTauri = true;
  let full = false, rejectExit = true;
  const listeners = new Set(), requests = [];
  let actualStage;
  await scenario(t, async ({ container, stage, image, key, tick, size }) => {
    actualStage = stage;
    await complete(image('a'));
    full = true;
    await act(async () => { for (const listener of listeners) listener({ payload: true }); });
    assert.notEqual(window.getComputedStyle(stage().parentElement).opacity, '0');
    await key('Escape');
    assert.equal(window.getComputedStyle(stage().parentElement).opacity, '0', '处理 Escape 当次提交就遮蔽');
    assert.deepEqual(requests, [true]);
    assert.notEqual(window.getComputedStyle(stage()).visibility, 'hidden', '淡出期间照片仍在深底之上');
    assert.notEqual(window.getComputedStyle(stage()).opacity, '0', '不能先藏照片只剩深底');
    assert.equal(stage().inert, true, '淡出期间立即停止舞台交互');
    assert.equal(stage().getAttribute('aria-hidden'), 'true');
    await tick(159);
    assert.deepEqual(requests, [true], '140ms 淡出和短渲染交接结束前不缩窗');
    await tick(1);
    assert.deepEqual(requests, [true, false]);
    assert.match(container.querySelector('[role=alert]').textContent, /无法退出全屏/);
    assert.notEqual(window.getComputedStyle(stage().parentElement).opacity, '0', '退出失败恢复可见作品');
    rejectExit = false;
    await key('Escape');
    await key('Escape');
    await tick(160);
    assert.deepEqual(requests, [true, false, false], '快按 Escape 只发一次退出');
    size.width = 1000;
    size.height = 700;
    assert.equal(window.getComputedStyle(stage().parentElement).opacity, '0', 'host 缩窗时也没有窗口态欣赏');
    full = false;
    await act(async () => { for (const listener of listeners) listener({ payload: false }); });
    assert.equal(container.querySelector('dialog'), null);
  }, { mac: true, host: {
    async isFullscreen() { return full; },
    async setFullscreen(value) {
      requests.push(value);
      if (!value) {
        assert.equal(window.getComputedStyle(actualStage().parentElement).opacity, '0', '原生请求观察到的 DOM 已遮蔽');
        if (rejectExit) throw new Error('rejected exit');
      }
    },
    async listen(event, listener) { listeners.add(listener); return () => listeners.delete(listener); },
  } });
});

test('进入中连续 Escape 保持遮蔽并排队退出，不在进场完成时闪出照片', async (t) => {
  globalThis.isTauri = true;
  let full = false;
  const listeners = new Set(), requests = [];
  await scenario(t, async ({ container, stage, image, key, tick }) => {
    assert.equal(document.activeElement, container.querySelector('dialog'), '进入中 Escape 从可聚焦的 dialog 进入');
    await complete(image('a'));
    await key('Escape');
    await key('Escape');
    assert.equal(document.activeElement, container.querySelector('dialog'), '遮蔽舞台后仍能接收 Escape');
    await tick(32);
    assert.deepEqual(requests, [true]);
    full = true;
    await act(async () => { for (const listener of listeners) listener({ payload: true }); });
    assert.deepEqual(requests, [true, false]);
    assert.equal(window.getComputedStyle(stage().parentElement).opacity, '0');
    full = false;
    await act(async () => { for (const listener of listeners) listener({ payload: false }); });
    assert.equal(container.querySelector('dialog'), null);
  }, { mac: true, host: {
    async isFullscreen() { return full; },
    async setFullscreen(value) { requests.push(value); },
    async listen(event, listener) { listeners.add(listener); return () => listeners.delete(listener); },
  } });
});

test('进入阶段保留配乐原始激活；提前 Escape 后进入失败直接完成已请求的返回', async (t) => {
  globalThis.isTauri = true;
  let rejectEntry;
  const activations = [];
  t.mock.method(window.HTMLMediaElement.prototype, 'play', function () {
    activations.push(document.querySelector('.player-stage')?.getAttribute('aria-hidden'));
    return Promise.resolve();
  });
  await scenario(t, async ({ container, stage, image, key, tick }) => {
    assert(activations.length > 0, '未等原生完成事件就调用 play，保留用户激活时机');
    assert(activations.every(value => value === 'true'));
    await complete(image('a'));
    await key('Escape');
    await tick(32);
    await act(async () => rejectEntry(new Error('entry rejected')));
    assert.equal(container.querySelector('dialog'), null, '进入失败不丢弃已请求返回的意图');
  }, { mac: true, music: { id: 'builtin-mist-walk', name: '雾中慢行', url: '/music/mist-walk.wav' }, host: {
    async isFullscreen() { return false; },
    setFullscreen() { return new Promise((resolve, reject) => { rejectEntry = reject; }); },
    async listen() { return () => {}; },
  } });
});

test('音频错误有记录并在返回后反馈，不遮挡照片且固定时间继续自动播放', async (t) => {
  await scenario(t, async ({ container, image, current, key, tick, feedback }) => {
    const audio = container.querySelector('audio');
    assert.match(audio.src, /mist-walk/);
    await complete(image('a'));
    await complete(image('b'));
    await act(async () => audio.dispatchEvent(new Event('error')));
    assert.equal(audio.getAttribute('src'), null);
    assert.equal(container.querySelector('[role=alert]'), null);
    assert.deepEqual(feedback, []);
    await tick(6000);
    assert.equal(current(), image('b'));
    await key('Escape');
    assert.match(feedback[0], /配乐无法读取/);
  }, { music: { id: 'builtin-mist-walk', name: '雾中慢行', url: '/music/mist-walk.wav' } });
});

test('手动首组越界不停止自动播放，只有时钟走到末组才停止', async (t) => {
  await scenario(t, async ({ image, current, key, tick }) => {
    await complete(image('a'));
    await complete(image('b'));
    await key('ArrowLeft');
    await tick(6000);
    assert.equal(current(), image('b'));
    for (const id of ['c', 'd', 'e', 'f']) {
      await complete(image(id));
      await key('ArrowRight');
      assert.equal(current(), image(id));
    }
    await key('ArrowRight');
    await tick(6000);
    assert.equal(current(), image('f'));
    await key('ArrowLeft');
    await tick(6000);
    assert.equal(current(), image('f'), '手动回到上一组后恢复播放');
  }, { preferences: { loop: false } });
});

test('首组三张全部解码后直接请求全屏，快路径不显示加载浮层且复用真实节点', async (t) => {
  globalThis.isTauri = true;
  let full = false;
  const requests = [], listeners = new Set(), activations = [];
  t.mock.method(window.HTMLMediaElement.prototype, 'play', function () {
    activations.push({ volume: this.volume, muted: this.muted });
    return Promise.resolve();
  });
  await scenario(t, async ({ container, stage, image, tick }) => {
    const originals = ['a', 'b', 'c'].map(image);
    assert.equal(stage().querySelectorAll('img').length, 3, '预备期不加载前后组原图');
    assert.equal(image('d'), null);
    assert.deepEqual(requests, []);
    assert(activations.length > 0, '挂载时即调用 play，保留点击激活');
    assert(activations.every(({ volume, muted }) => volume === 0 && !muted), '预备期仅将音量置零，保留已授权的有声播放');
    const audio = container.querySelector('audio');
    audio.currentTime = 8;
    await complete(originals[0]);
    await complete(originals[1]);
    assert.deepEqual(requests, [], '首组缺一张也不请求全屏');
    await tick(199);
    assert.equal(container.querySelector('.player-preparation'), null);
    await complete(originals[2]);
    assert.deepEqual(requests, [true]);
    await tick(500);
    assert.equal(container.querySelector('.player-preparation'), null, '快速解码后原生切换再慢也不补出加载浮层');
    assert.equal(audio.volume, 0);
    full = true;
    await act(async () => { for (const listener of listeners) listener({ payload: true }); });
    assert.equal(window.getComputedStyle(stage().parentElement).opacity, '1');
    assert.equal(audio.volume, .35);
    assert.equal(audio.currentTime, 0, '第一组显影时从曲首开始放音');
    assert.equal(stage().querySelectorAll('[data-role=current] img').length, 3);
    for (let i = 0; i < originals.length; i++) assert.equal(image(ids[i]) === originals[i], true, '预备和舞台使用同一解码节点');
  }, { mac: true, stageSize: { width: 1600, height: 900 }, sample: photos.map(photo => ({ ...photo, width: 600, height: 900 })),
    music: { id: 'builtin-mist-walk', name: '雾中慢行', url: '/music/mist-walk.wav' }, host: {
      async isFullscreen() { return full; },
      async setFullscreen(value) { requests.push(value); },
      async listen(event, listener) { listeners.add(listener); return () => listeners.delete(listener); },
    } });
});

test('慢解码200ms后才在真实相簿上显示小加载浮层，就绪立即进场并在显影后卸载', async (t) => {
  globalThis.isTauri = true;
  let full = false;
  const requests = [], listeners = new Set();
  await scenario(t, async ({ container, stage, image, tick }) => {
    const source = container.querySelector('.source-album img');
    await tick(199);
    assert.equal(container.querySelector('.player-preparation'), null);
    await tick(1);
    assert.match(container.querySelector('.player-preparation [role=status]').textContent, /正在准备照片…/);
    assert.equal(window.getComputedStyle(stage().parentElement).opacity, '0');
    assert.equal(source.isConnected, true);
    assert.deepEqual(requests, []);
    await complete(image('a'));
    assert.deepEqual(requests, [true], '不人为延长浮层展示时间');
    assert(container.querySelector('.player-preparation'), '已显示浮层延续到作品显影');
    full = true;
    await act(async () => { for (const listener of listeners) listener({ payload: true }); });
    assert.equal(container.querySelector('.player-preparation'), null);
    assert.equal(window.getComputedStyle(stage().parentElement).opacity, '1');
  }, { mac: true, host: {
    async isFullscreen() { return full; },
    async setFullscreen(value) { requests.push(value); },
    async listen(event, listener) { listeners.add(listener); return () => listeners.delete(listener); },
  } });
});

test('准备阶段Escape或取消按钮即时返回，迟到解码绝不触发原生全屏', async (t) => {
  for (const cancelWithButton of [false, true]) {
    globalThis.isTauri = true;
    const requests = [];
    await scenario(t, async ({ container, image, tick, key }) => {
      const first = image('a');
      await tick(cancelWithButton ? 200 : 100);
      if (cancelWithButton) await act(async () => container.querySelector('.player-preparation-cancel').click());
      else await key('Escape');
      assert.equal(container.querySelector('dialog'), null);
      await complete(first);
      await tick(5000);
      assert.deepEqual(requests, []);
      assert.equal(container.querySelector('.source-album img').isConnected, true);
    }, { host: {
      async isFullscreen() { return false; },
      async setFullscreen(value) { requests.push(value); },
      async onResized() { return () => {}; },
    } });
  }
});

test('预备首组中一张失败立即可见反馈和重连，不把失败当成就绪也不等其他张', async (t) => {
  globalThis.isTauri = true;
  const requests = [];
  await scenario(t, async ({ container, image, key }) => {
    await complete(image('b'), false);
    assert.match(container.querySelector('.player-preparation [role=alert]').textContent, /图片无法读取/);
    assert.match(container.querySelector('.player-preparation button').textContent, /重新定位/);
    assert.deepEqual(requests, []);
    await key('Escape');
    assert.equal(container.querySelector('dialog'), null);
  }, { sample: photos.map(photo => ({ ...photo, width: 600, height: 900 })), host: {
    async isFullscreen() { return false; },
    async setFullscreen(value) { requests.push(value); },
    async onResized() { return () => {}; },
  } });
});
