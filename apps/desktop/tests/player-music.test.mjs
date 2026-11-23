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
  const audio = Object.assign(new EventTarget(), { currentTime: 0, paused: false, seeking: false, readyState: 4 });
  let options = { audioRef: { current: audio }, musicId: 'a', grid: BUILTIN_MUSIC[0].grid, playing: true, ready: true, nextReady: true, frameKey: '1', seconds: 6, onAdvance: () => events.push('advance') };
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
    await tick(6.68); assert.deepEqual(events, ['advance']);
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
    await tick(26, 1); assert.deepEqual(events, Array(5).fill('advance'));
  } finally { await act(async () => root.unmount()); }
});

test('目标组迟到只顺延到下一重拍，不重置停留且不影响无配乐六秒切换', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const root = createRoot(document.createElement('div'));
  const audio = Object.assign(new EventTarget(), { currentTime: 0, paused: false, seeking: false, readyState: 4 });
  const events = [];
  let options = { audioRef: { current: audio }, musicId: 'beat', grid: BUILTIN_MUSIC[0].grid,
    playing: true, ready: true, nextReady: false, frameKey: 'first', seconds: 6, onAdvance: () => events.push(audio.currentTime) };
  function Clock(props) { usePlayerClock(props); return null; }
  const render = async patch => { options = { ...options, ...patch }; await act(async () => root.render(createElement(Clock, options))); };
  const sample = async (position, milliseconds = 20) => { audio.currentTime = position; await act(async () => t.mock.timers.tick(milliseconds)); };
  try {
    await render({});
    await sample(6.68);
    assert.deepEqual(events, [], '选定重拍已到，但下一组仍在解码，保留当前场景');
    await sample(7);
    await render({ nextReady: true });
    assert.deepEqual(events, [], '解码完成不在非重拍补切');
    await sample(9.99);
    assert.deepEqual(events, []);
    await sample(10.01);
    assert.deepEqual(events, [10.01], '到下一个小节重拍切换，不重新等完整六秒');
    await render({ frameKey: 'second', musicId: null, grid: null, nextReady: false });
    await sample(10.01, 5999);
    assert.equal(events.length, 1);
    await sample(10.01, 1);
    assert.equal(events.length, 2, '无配乐仍按六秒发起请求，随后沿用照片就绪交接');
  } finally { await act(async () => root.unmount()); }
});

test('一张照片的 60 秒停留跨过两首短曲后仍在下一首的重拍切换', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const root = createRoot(document.createElement('div'));
  const events = [];
  const audio = Object.assign(new EventTarget(), { currentTime: 0, paused: false, seeking: false, readyState: 4 });
  const grid = { duration: 24, downbeats: [0, 4, 8, 12, 16, 20] };
  const options = { audioRef: { current: audio }, playing: true, ready: true, nextReady: true, seconds: 60, onAdvance: () => events.push('advance') };
  function Clock(props) { usePlayerClock(props); return null; }
  const render = (musicId, frameKey) => act(async () => root.render(createElement(Clock, { ...options, musicId, grid: musicId ? grid : null, frameKey })));
  const sample = (time, elapsed = 20) => {
    audio.currentTime = time;
    return act(async () => t.mock.timers.tick(elapsed));
  };
  try {
    await render('one', 'first');
    await sample(24);
    audio.currentTime = 0;
    audio.paused = true;
    audio.readyState = 0;
    await render('two', 'first');
    await sample(0);
    audio.paused = false;
    audio.readyState = 4;
    await sample(0);
    await sample(24);
    audio.currentTime = 0;
    audio.paused = true;
    audio.readyState = 0;
    await render('three', 'first');
    await sample(0);
    audio.paused = false;
    audio.readyState = 4;
    await sample(0);
    await sample(8);
    assert.deepEqual(events, []);
    await sample(12);
    assert.deepEqual(events, ['advance']);

    await render('three', 'second');
    await sample(24);
    audio.currentTime = 0;
    await render(null, 'second');
    await sample(0, 47_999);
    assert.deepEqual(events, ['advance']);
    await sample(0, 1);
    assert.deepEqual(events, ['advance', 'advance'], '没有可用节拍时按剩余时间继续');
  } finally { await act(async () => root.unmount()); }
});

const { readAppreciationPreferences, saveAppreciationPreferences, defaultAppreciationPreferences } = await load('../src/lib/appreciation-preferences.ts');

test('欣赏偏好忽略旧停留秒数，持久化音源开关并迁移旧无配乐设置', () => {
  window.localStorage.clear();
  assert.deepEqual(readAppreciationPreferences(), defaultAppreciationPreferences);
  const preference = { random: true, loop: false, preferFill: true, groupPortraits: true, musicEnabled: false };
  saveAppreciationPreferences(preference);
  assert.deepEqual(readAppreciationPreferences(), preference);
  window.localStorage.setItem('foliune.appreciation', JSON.stringify({ seconds: 15, random: true, loop: false, musicId: 'off', volume: .8 }));
  assert.deepEqual(readAppreciationPreferences(), { ...preference, preferFill: false, groupPortraits: false });
  assert.equal('seconds' in readAppreciationPreferences(), false, '旧停留秒数不再参与播放偏好');
  saveAppreciationPreferences(readAppreciationPreferences());
  assert.doesNotMatch(window.localStorage.getItem('foliune.appreciation'), /seconds|volume|musicId/);
  window.localStorage.setItem('foliune.appreciation', JSON.stringify({ musicId: 'builtin-light-pulse', volume: .8, preferFill: 'true', groupPortraits: 'true' }));
  assert.deepEqual(readAppreciationPreferences(), defaultAppreciationPreferences);
  window.localStorage.setItem('foliune.appreciation', JSON.stringify({ musicId: 'off', musicEnabled: true }));
  assert.equal(readAppreciationPreferences().musicEnabled, true, '显式新字段优先于旧字段');
  saveAppreciationPreferences(readAppreciationPreferences());
  assert.doesNotMatch(window.localStorage.getItem('foliune.appreciation'), /volume|musicId/);
  window.localStorage.setItem('foliune.appreciation', 'corrupt');
  assert.deepEqual(readAppreciationPreferences(), defaultAppreciationPreferences);
  window.localStorage.clear();
});

const musicApiBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/music-api.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
  plugins: [{ name: 'music-import-boundary', setup(build) {
    build.onResolve({ filter: /^@tauri-apps\/(api\/core|plugin-dialog)$/ }, ({ path }) => ({ path, namespace: 'music-import' }));
    build.onResolve({ filter: /^\.\/api$/ }, ({ path }) => ({ path, namespace: 'music-import' }));
    build.onLoad({ filter: /.*/, namespace: 'music-import' }, () => ({ contents: 'export const open = (options) => globalThis.openMusicDialog(options); export const convertFileSrc = path => path; export const isDesktop = () => true; export const call = (command, args) => globalThis.callMusicApi(command, args);' }));
  } }],
});
const musicApiModule = { exports: {} };
new Function('require', 'module', 'exports', musicApiBundle.outputFiles[0].text)(require, musicApiModule, musicApiModule.exports);

test('本地音乐多选按序导入、同次去重并报告逐项失败，取消不调用导入', async () => {
  let options, resolveFirst;
  const calls = [], controller = new AbortController();
  globalThis.openMusicDialog = async value => { options = value; return ['/one.wav', '/bad.wav', '/one.wav', '/two.wav']; };
  globalThis.callMusicApi = async (command, { path }) => {
    calls.push(path);
    if (path === '/one.wav') await new Promise(resolve => { resolveFirst = resolve; });
    if (path === '/bad.wav') throw new Error('invalid audio');
    return { id: path, name: path.slice(1), path: `/cache${path}` };
  };
  const pending = musicApiModule.exports.pickMusic(controller.signal);
  await Promise.resolve();
  assert.equal(options.multiple, true);
  assert.deepEqual(calls, ['/one.wav']);
  resolveFirst();
  const result = await pending;
  assert.deepEqual(calls, ['/one.wav', '/bad.wav', '/two.wav']);
  assert.deepEqual(result.tracks.map(track => track.name), ['one.wav', 'two.wav']);
  assert.deepEqual(result.failures, [{ name: 'bad.wav', message: 'invalid audio' }]);
  globalThis.openMusicDialog = async () => null;
  assert.deepEqual(await musicApiModule.exports.pickMusic(controller.signal), { tracks: [], failures: [] });
  assert.equal(calls.length, 3);
  globalThis.openMusicDialog = async () => ['/late.wav', '/never.wav'];
  globalThis.callMusicApi = async (command, { path }) => { controller.abort(); return { id: path, name: path, path }; };
  const aborted = await musicApiModule.exports.pickMusic(controller.signal);
  assert.deepEqual(aborted.tracks.map(track => track.id), ['/late.wav'], '中止后保留已导入项供调用方清理，并停止剩余拷贝');
});

const settingsBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/features/use-appreciation-settings.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
  plugins: [{ name: 'appreciation-music-boundary', setup(build) {
    build.onResolve({ filter: /\/music-api$/ }, ({ path }) => ({ path, namespace: 'appreciation-music' }));
    build.onLoad({ filter: /.*/, namespace: 'appreciation-music' }, () => ({ contents: 'export const pickMusic = (signal) => globalThis.pickPlayerMusic(signal); export const releaseMusic = (id) => globalThis.releasePlayerMusic(id);' }));
    build.onResolve({ filter: /\/music-beats$/ }, ({ path }) => ({ path, namespace: 'appreciation-beats' }));
    build.onLoad({ filter: /.*/, namespace: 'appreciation-beats' }, () => ({ contents: 'export const analyzeMusicBeats = (url, signal) => globalThis.analyzePlayerMusic(url, signal);' }));
  } }],
});
const settingsModule = { exports: {} };
new Function('require', 'module', 'exports', settingsBundle.outputFiles[0].text)(require, settingsModule, settingsModule.exports);
const { useAppreciationSettings } = settingsModule.exports;

test('本地音乐批量追加并保留会话，换源不释放，保存失败不提前变更可见偏好', async () => {
  window.localStorage.clear();
  const container = document.createElement('div'), root = createRoot(container);
  const releases = [], feedback = [];
  let settings, chosen = { tracks: [{ id: 'one', name: 'One', url: '/one.wav' }, { id: 'two', name: 'Two', url: '/two.wav' }], failures: [{ name: 'bad.wav', message: 'invalid audio' }] };
  globalThis.pickPlayerMusic = async () => chosen;
  globalThis.releasePlayerMusic = async id => releases.push(id);
  globalThis.analyzePlayerMusic = async () => ({ status: 'ready', grid: BUILTIN_MUSIC[0].grid });
  function Host({ settingsVisible = true }) {
    settings = useAppreciationSettings(message => feedback.push(message));
    return settingsVisible ? createElement('p', null, settings.musicSource) : null;
  }
  try {
    await act(async () => root.render(createElement(Host)));
    assert.deepEqual(settings.playlist.map(track => track.id), BUILTIN_MUSIC.map(track => track.id));
    await act(async () => settings.chooseMusic());
    assert.equal(settings.musicSource, 'local');
    assert.deepEqual(settings.playlist.map(track => track.id), ['one', 'two']);
    assert.equal(settings.analysis.get('one').status, 'ready');
    assert.equal(settings.analysis.get('two').status, 'ready');
    assert.match(feedback.shift(), /bad.wav.*invalid audio/);
    await act(async () => root.render(createElement(Host, { settingsVisible: false })));
    await act(async () => root.render(createElement(Host)));
    assert.equal(settings.playlist.length, 2);
    const saved = window.localStorage.getItem('foliune.appreciation'), storage = window.localStorage;
    Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => saved, setItem() { throw new Error('storage full'); } } });
    try {
      await act(async () => { settings.change({ preferFill: true, groupPortraits: true }); settings.changeMusic('off'); });
      assert.equal(settings.preferences.preferFill, false);
      assert.equal(settings.preferences.groupPortraits, false);
      assert.equal(settings.musicSource, 'local');
      assert.equal(feedback.length, 2);
    } finally { Object.defineProperty(window, 'localStorage', { configurable: true, value: storage }); }
    chosen = { tracks: [{ id: 'three', name: 'Three', url: '/three.wav' }], failures: [] };
    await act(async () => settings.chooseMusic());
    assert.deepEqual(settings.playlist.map(track => track.id), ['one', 'two', 'three']);
    await act(async () => settings.changeMusic('builtin'));
    assert.equal(settings.localMusic.length, 3);
    assert.deepEqual(releases, []);
    await act(async () => settings.changeMusic('off'));
    assert.deepEqual(settings.playlist, []);
    assert.equal(readAppreciationPreferences().musicEnabled, false);
    await act(async () => settings.changeMusic('local'));
    assert.equal(settings.playlist.length, 3);
    chosen = { tracks: [], failures: [] };
    await act(async () => settings.chooseMusic());
    assert.equal(settings.playlist.length, 3, '取消选择不改变列表');
    assert.doesNotMatch(window.localStorage.getItem('foliune.appreciation'), /one|two|three|wav|volume|musicId/);
    await act(async () => settings.clearLocalMusic());
    assert.equal(settings.musicSource, 'builtin');
    assert.equal(settings.analysis.size, 0);
    assert.deepEqual(releases, ['one', 'two', 'three']);
  } finally {
    await act(async () => root.unmount());
    window.localStorage.clear();
  }
});

test('本地节拍分析串行，清空或卸载后忽略迟到结果，并清理迟到导入', async () => {
  const container = document.createElement('div'), root = createRoot(container);
  let settings, resolveAnalysis, resolvePick, pickSignal;
  const analyzed = [], releases = [], feedback = [];
  globalThis.pickPlayerMusic = async () => ({ tracks: [{ id: 'one', name: 'One', url: '/one.wav' }, { id: 'two', name: 'Two', url: '/two.wav' }], failures: [] });
  globalThis.analyzePlayerMusic = (url, signal) => new Promise(resolve => { analyzed.push({ url, signal }); resolveAnalysis = resolve; });
  globalThis.releasePlayerMusic = async id => releases.push(id);
  function Host() { settings = useAppreciationSettings(message => feedback.push(message)); return null; }
  await act(async () => root.render(createElement(Host)));
  await act(async () => settings.chooseMusic());
  assert.deepEqual(analyzed.map(item => item.url), ['/one.wav'], '上一首完成前不分析下一首');
  await act(async () => settings.clearLocalMusic());
  assert.equal(analyzed[0].signal.aborted, true);
  await act(async () => resolveAnalysis({ status: 'ready', grid: BUILTIN_MUSIC[0].grid }));
  assert.equal(settings.analysis.size, 0);
  assert.equal(analyzed.length, 1);
  globalThis.pickPlayerMusic = signal => new Promise(resolve => { pickSignal = signal; resolvePick = resolve; });
  let pending;
  await act(async () => { pending = settings.chooseMusic(); });
  await act(async () => root.unmount());
  assert.equal(pickSignal.aborted, true);
  globalThis.releasePlayerMusic = async id => { releases.push(id); throw new Error('cannot release'); };
  await act(async () => { resolvePick({ tracks: [{ id: 'late', name: 'Late', url: '/late.wav' }], failures: [] }); await pending; });
  assert.deepEqual(releases, ['one', 'two', 'late']);
  assert.match(feedback[0], /清理欣赏配乐失败.*cannot release/);
});


const { AppreciationSettings } = await load('../src/features/AppreciationSettings.tsx');
test('配乐来源禁用空本地列表，添加后显示数量并可清空，无独立音量', async () => {
  window.localStorage.clear();
  const container = document.createElement('div'), root = createRoot(container);
  document.body.append(container);
  const releases = [];
  globalThis.pickPlayerMusic = async () => ({ tracks: [{ id: 'one', name: 'One', url: '/one.wav' }, { id: 'two', name: 'Two', url: '/two.wav' }], failures: [] });
  globalThis.analyzePlayerMusic = async () => ({ status: 'fixed', reason: 'weak-pulse' });
  globalThis.releasePlayerMusic = async id => releases.push(id);
  function Host({ disabled = false }) {
    const settings = useAppreciationSettings(() => {});
    return createElement(AppreciationSettings, { settings, disabled });
  }
  try {
    await act(async () => root.render(createElement(Host)));
    const selector = container.querySelector('[aria-label="配乐"]');
    assert.equal(container.querySelector('[aria-label="每组停留"]'), null, '停留时间由应用默认值决定');
    assert.equal(container.querySelectorAll('[role=combobox]').length, 2, '只保留播放顺序和配乐两个下拉');
    await act(async () => selector.click());
    const localOption = [...document.querySelectorAll('[role=option]')].find(option => option.textContent === '本地音乐');
    assert.equal(localOption.getAttribute('aria-disabled'), 'true');
    await act(async () => selector.click());
    assert.equal(container.querySelector('input[type=range]'), null);
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '添加本地音乐').click());
    assert.equal(selector.textContent, '本地音乐');
    assert(container.textContent.includes('2 首本地音乐'));
    assert(container.textContent.includes('2 首配乐无法同步鼓点，按默认间隔切换。'));
    await act(async () => root.render(createElement(Host, { disabled: true })));
    assert.equal(container.querySelector('[aria-label="清空本地音乐"]').disabled, true);
    await act(async () => root.render(createElement(Host)));
    await act(async () => container.querySelector('[aria-label="清空本地音乐"]').click());
    assert.equal(selector.textContent, '内置音乐');
    assert.equal(container.querySelector('[aria-label="清空本地音乐"]'), null);
    assert.deepEqual(releases, ['one', 'two']);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
  }
});

test('贴屏优先和竖幅组图复用设置复选框，默认关闭、点击持久保存、禁用和重新进入保持一致', async () => {
  window.localStorage.clear();
  const container = document.createElement('div');
  document.body.append(container);
  let root = createRoot(container);
  function Host({ disabled = false }) {
    const settings = useAppreciationSettings(() => {});
    return createElement(AppreciationSettings, { settings, disabled });
  }
  const checkbox = (name = '贴屏优先') => [...container.querySelectorAll('label')].find(label => label.textContent === name).querySelector('input');
  try {
    await act(async () => root.render(createElement(Host)));
    assert.equal(checkbox().type, 'checkbox');
    assert.equal(container.querySelector('input[type=range]'), null, '不再提供独立音量滑块');
    assert(container.textContent.includes('添加本地音乐'));
    assert(container.textContent.includes('照片循环'));
    assert.equal(checkbox().checked, false);
    assert.equal(checkbox('竖幅组图').checked, false);
    await act(async () => checkbox('竖幅组图').click());
    assert.equal(readAppreciationPreferences().groupPortraits, true);
    await act(async () => checkbox().click());
    assert.equal(checkbox().checked, true);
    assert.equal(readAppreciationPreferences().preferFill, true);
    await act(async () => root.render(createElement(Host, { disabled: true })));
    assert.equal(checkbox().disabled, true);
    assert.equal(checkbox('竖幅组图').disabled, true);
    await act(async () => checkbox().click());
    assert.equal(readAppreciationPreferences().preferFill, true);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(createElement(Host)));
    assert.equal(checkbox().checked, true, '重新进入读取持久化值');
    assert.equal(checkbox('竖幅组图').checked, true);
    await act(async () => checkbox('竖幅组图').click());
    assert.equal(readAppreciationPreferences().groupPortraits, false);
    await act(async () => checkbox().click());
    assert.equal(checkbox().checked, false);
    assert.equal(readAppreciationPreferences().preferFill, false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
  }
});
