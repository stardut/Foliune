import './fixtures/chinese-interface.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
async function load(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  return module.exports;
}
const { detectMusicBeats } = await load('../src/lib/music-beats.ts');
const { nextMusicAccent } = await load('../src/features/usePlayerClock.ts');
const { BUILTIN_MUSIC } = await load('../src/lib/player-music.ts');

test('原创音轨的时长、PCM格式及乐句网格准确，不引入编码延迟', () => {
  for (const track of BUILTIN_MUSIC) {
    const wav = readFileSync(new URL(`../public${track.url}`, import.meta.url));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt16LE(20), 1);
    assert.equal(wav.readUInt16LE(22), 2);
    assert.equal(wav.readUInt32LE(24), 22050);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal((wav.length - 44) / (22050 * 4), track.grid.duration);
    assert.equal(track.grid.beats.length, 32);
    assert.equal(track.grid.downbeats.length, 8);
    assert.equal(track.grid.downbeats[1], 4 * 60 / track.bpm);
  }
});

test('音乐切图选择接近停留时间的实际乐句，循环边缘保持同一音频时间轴', () => {
  const slow = BUILTIN_MUSIC[0].grid, quick = BUILTIN_MUSIC[1].grid;
  assert(Math.abs(nextMusicAccent(slow, 0, 6) - 6.6666667) < .0001);
  assert(Math.abs(nextMusicAccent(quick, 0, 6) - 6.6666667) < .0001);
  const target = nextMusicAccent(slow, 25, 6);
  assert(Math.abs(target - (slow.duration + slow.downbeats[1])) < .0001);
  const later = nextMusicAccent(slow, slow.duration * 20 + 25, 6);
  assert(Math.abs(later - target - slow.duration * 20) < .0001);
  assert.equal(nextMusicAccent({ duration: 10, downbeats: [] }, 0, 6), null);
});

test('本地分析从真实瞬态定位节拍，安静/无节拍素材明确保持固定间隔', () => {
  const rate = 11025, samples = new Float32Array(rate * 24);
  for (let beat = 0; beat < 48; beat++) {
    const start = Math.round(beat * .5 * rate);
    for (let j = 0; j < rate * .12; j++) {
      samples[start + j] += Math.sin(j / rate * 2 * Math.PI * 75) * Math.exp(-j / rate * 35) * (beat % 4 === 0 ? .9 : .5);
    }
  }
  const detected = detectMusicBeats(samples, rate);
  assert.equal(detected.status, 'ready');
  assert(detected.grid.beats.length > 40);
  for (const beat of detected.grid.beats) assert(Math.abs(beat * 2 - Math.round(beat * 2)) < .1);
  assert.deepEqual(detectMusicBeats(new Float32Array(rate * 24), rate), { status: 'fixed', reason: 'weak-pulse' });
  const pad = Float32Array.from({ length: rate * 24 }, (_, i) => Math.sin(i / rate * Math.PI * 220) * .2);
  assert.equal(detectMusicBeats(pad, rate).status, 'fixed');
});

const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = require('react');
const { createRoot } = require('react-dom/client');
const { usePlayerClock } = await load('../src/features/usePlayerClock.ts');

test('音频时钟在暂停、换图加载、音乐循环及WebView延迟后不追赶或积累漂移', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const container = document.createElement('div');
  const root = createRoot(container);
  const events = [];
  const audio = { currentTime: 0, paused: false, seeking: false, readyState: 4 };
  let options = { audioRef: { current: audio }, musicId: 'a', grid: BUILTIN_MUSIC[0].grid, playing: true, ready: true, frameKey: '1', seconds: 6, onAdvance: value => events.push(value) };
  function Clock(props) { usePlayerClock(props); return null; }
  const render = async patch => { options = { ...options, ...patch }; await act(async () => root.render(createElement(Clock, options))); };
  const tick = async (position, milliseconds = 20) => { audio.currentTime = position; await act(async () => t.mock.timers.tick(milliseconds)); };
  try {
    await render({});
    await tick(3); assert.equal(events.length, 0);
    await render({ ready: false });
    await tick(3.1);
    await render({ ready: true });
    await tick(6.65); assert.equal(events.length, 0);
    await tick(6.68); assert.deepEqual(events, [true]);
    await tick(12); assert.equal(events.length, 1, '同一照片只请求一次切换');
    await render({ frameKey: '2', ready: false });
    await tick(20, 20000); assert.equal(events.length, 1, '等待原图期间不跳图');
    await render({ ready: true });
    await tick(26.65); assert.equal(events.length, 1);
    await tick(.015); assert.equal(events.length, 2, '在音频循环首重拍切换');
    await render({ frameKey: '3' });
    audio.paused = true;
    await tick(2, 30000); assert.equal(events.length, 2);
    audio.paused = false;
    await tick(2); // Resume establishes a full new dwell on the music grid.
    await tick(6.68); assert.equal(events.length, 3);
    await render({ frameKey: '4' });
    await tick(15); assert.equal(events.length, 3, '错过重拍后不交付迟到的同步切图');
    await tick(16.68); assert.equal(events.length, 4);
    await render({ frameKey: '5', musicId: 'other' });
    await render({ playing: false });
    await tick(26, 60000); assert.equal(events.length, 4);
    await render({ musicId: null, grid: null, playing: true });
    await tick(26, 3000); assert.equal(events.length, 4);
    await render({ ready: false });
    await tick(26, 20);
    await render({ ready: true });
    await tick(26, 2979); assert.equal(events.length, 4);
    await tick(26, 1); assert.deepEqual(events, [true, true, true, true, false]);
  } finally { await act(async () => root.unmount()); }
});

const { readAppreciationPreferences, saveAppreciationPreferences, defaultAppreciationPreferences } = await load('../src/lib/appreciation-preferences.ts');

test('欣赏偏好在前端存储往返，过期/非法值恢复明确默认且本地音乐不写入持久偏好', () => {
  window.localStorage.clear();
  assert.deepEqual(readAppreciationPreferences(), defaultAppreciationPreferences);
  const preference = { seconds: 15, volume: .8, random: true, loop: false, musicId: 'off' };
  saveAppreciationPreferences(preference);
  assert.deepEqual(readAppreciationPreferences(), preference);
  window.localStorage.setItem('foliune.appreciation', JSON.stringify({ seconds: 0, volume: 2, random: 'yes', loop: null, musicId: 'local-file-id' }));
  assert.deepEqual(readAppreciationPreferences(), defaultAppreciationPreferences);
  window.localStorage.setItem('foliune.appreciation', 'corrupt');
  assert.deepEqual(readAppreciationPreferences(), defaultAppreciationPreferences);
  window.localStorage.clear();
});

const settingsBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/features/use-appreciation-settings.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
  plugins: [{ name: 'appreciation-music-boundary', setup(build) {
    build.onResolve({ filter: /\/music-api$/ }, ({ path }) => ({ path, namespace: 'appreciation-music' }));
    build.onLoad({ filter: /.*/, namespace: 'appreciation-music' }, () => ({ contents: 'export const pickMusic = () => globalThis.pickPlayerMusic(); export const releaseMusic = (id) => globalThis.releasePlayerMusic(id);' }));
    build.onResolve({ filter: /\/music-beats$/ }, ({ path }) => ({ path, namespace: 'appreciation-beats' }));
    build.onLoad({ filter: /.*/, namespace: 'appreciation-beats' }, () => ({ contents: 'export const analyzeMusicBeats = (url, signal) => globalThis.analyzePlayerMusic(url, signal);' }));
  } }],
});
const settingsModule = { exports: {} };
new Function('require', 'module', 'exports', settingsBundle.outputFiles[0].text)(require, settingsModule, settingsModule.exports);
const { useAppreciationSettings } = settingsModule.exports;

test('本地音乐跨设置页访问留在 App 会话，换源清分析/释放；保存失败保持原曲与可见偏好', async (t) => {
  window.localStorage.clear();
  const container = document.createElement('div'), root = createRoot(container);
  const releases = [], feedback = [], snapshots = [];
  let settings, chosen = { id: 'local-one', name: 'One', url: '/one.wav' };
  globalThis.pickPlayerMusic = async () => chosen;
  globalThis.releasePlayerMusic = async id => releases.push(id);
  globalThis.analyzePlayerMusic = async () => ({ status: 'ready', grid: BUILTIN_MUSIC[0].grid });
  function Host({ settingsVisible = true }) {
    settings = useAppreciationSettings(message => feedback.push(message));
    snapshots.push({ music: settings.music?.id, analysis: settings.analysis });
    return settingsVisible ? createElement('p', null, settings.music?.name) : null;
  }
  try {
    await act(async () => root.render(createElement(Host)));
    await act(async () => settings.chooseMusic());
    assert.equal(settings.music.id, 'local-one');
    assert.equal(settings.analysis.status, 'ready');
    await act(async () => root.render(createElement(Host, { settingsVisible: false })));
    await act(async () => root.render(createElement(Host)));
    assert.equal(settings.music.id, 'local-one');
    assert.deepEqual(releases, []);
    const saved = window.localStorage.getItem('foliune.appreciation');
    const storage = window.localStorage;
    Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => saved, setItem() { throw new Error('storage full'); } } });
    await act(async () => { settings.change({ seconds: 30 }); settings.changeMusic('off'); });
    assert.equal(settings.preferences.seconds, 6);
    assert.equal(settings.music.id, 'local-one');
    assert.deepEqual(releases, []);
    assert.equal(feedback.length, 2);
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
    chosen = { id: 'local-two', name: 'Two', url: '/two.wav' };
    globalThis.analyzePlayerMusic = () => new Promise(() => {});
    await act(async () => settings.chooseMusic());
    assert.equal(settings.music.id, 'local-two');
    assert.equal(settings.analysis, null);
    assert(snapshots.filter(item => item.music === 'local-two').every(item => item.analysis === null));
    assert.deepEqual(releases, ['local-one']);
    await act(async () => settings.change({ seconds: 15, volume: .6, random: true, loop: false }));
    await act(async () => settings.changeMusic('off'));
    assert.equal(settings.music, null);
    assert.equal(settings.analysis, null);
    assert.deepEqual(releases, ['local-one', 'local-two']);
    assert.deepEqual(readAppreciationPreferences(), { seconds: 15, volume: .6, random: true, loop: false, musicId: 'off' });
    assert.doesNotMatch(window.localStorage.getItem('foliune.appreciation'), /local-one|local-two|wav/);
  } finally {
    await act(async () => root.unmount());
    window.localStorage.clear();
  }
});

test('本地文件选择迟到于 App 卸载时只清理新缓存，清理异常有反馈', async () => {
  const container = document.createElement('div'), root = createRoot(container);
  let settings, resolve;
  const releases = [], feedback = [];
  globalThis.pickPlayerMusic = () => new Promise(done => { resolve = done; });
  globalThis.releasePlayerMusic = async id => { releases.push(id); throw new Error('cannot release'); };
  function Host() { settings = useAppreciationSettings(message => feedback.push(message)); return null; }
  await act(async () => root.render(createElement(Host)));
  let pending;
  await act(async () => { pending = settings.chooseMusic(); });
  await act(async () => root.unmount());
  await act(async () => { resolve({ id: 'late', name: 'Late', url: '/late.wav' }); await pending; });
  assert.deepEqual(releases, ['late']);
  assert.match(feedback[0], /清理欣赏配乐失败.*cannot release/);
});
