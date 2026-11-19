import './fixtures/chinese-interface.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLImageElement', 'Element', 'Node']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const preference = new window.EventTarget();
preference.matches = false;
window.matchMedia = () => preference;
const pending = new WeakMap();
window.HTMLImageElement.prototype.decode = function () {
  if (!pending.has(this)) {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    pending.set(this, { promise, resolve });
  }
  return pending.get(this).promise;
};
Object.defineProperty(window.HTMLImageElement.prototype, 'naturalWidth', { get: () => 1000 });
const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/features/PlayerPresentation.tsx', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false,
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { buildPlayerCompositions, playerCompositionNeighbor, usePlayerPresentation, PlayerFrames } = module.exports;
const photo = (id, ratio) => ({ id, title: id, originalName: `${id}.jpg`, originalUrl: `/${id}.jpg`, originalPath: `/${id}.jpg`,
  originalAvailable: true, width: ratio * 1500, height: 1500 });
const source = ratios => {
  const photos = new Map(ratios.map((ratio, i) => [String(i), photo(String(i), ratio)]));
  return { photos, order: [...photos.keys()] };
};
const sizes = scenes => scenes.map(scene => scene.end - scene.start + 1);

test('连续竖幅依舞台组成双联或三联，横幅独幅，四幅保留为两组双联', () => {
  const { photos, order } = source([1.5, .667, .667, .667, 1.8, .667, .667, .667, .667]);
  assert.deepEqual(sizes(buildPlayerCompositions(photos, order, 1.8)), [1, 3, 1, 2, 2]);
  assert.deepEqual(sizes(buildPlayerCompositions(photos, order, 1.2)), [1, 2, 1, 1, 2, 2]);
  assert.deepEqual(sizes(buildPlayerCompositions(photos, order, .8)), Array(9).fill(1));
  assert.deepEqual(sizes(buildPlayerCompositions(photos, order, 0)), Array(9).fill(1));
});

test('构图覆盖每张一次并保持顺序，前后导航及循环按整组边界行进', () => {
  for (let count = 1; count <= 20; count++) {
    const { photos, order } = source(Array(count).fill(.667));
    const scenes = buildPlayerCompositions(photos, order, 1.8);
    assert.deepEqual(scenes.flatMap(scene => order.slice(scene.start, scene.end + 1)), order);
    for (let i = 0; i < scenes.length; i++) {
      assert.equal(playerCompositionNeighbor(scenes, scenes[i].end, 1, false), scenes[i + 1]?.start ?? null);
      assert.equal(playerCompositionNeighbor(scenes, scenes[i].start, -1, false), scenes[i - 1]?.start ?? null);
    }
    assert.equal(playerCompositionNeighbor(scenes, 0, -1, true), scenes.at(-1).start);
    assert.equal(playerCompositionNeighbor(scenes, count - 1, 1, true), 0);
  }
});

test('近方竖幅不挤进三联，尺寸缺失照片独立呈现且不跨过去分组', () => {
  const { photos, order } = source([.85, .85, .85, 0, .667, .667]);
  assert.deepEqual(sizes(buildPlayerCompositions(photos, order, 1.5)), [2, 1, 1, 2]);
});

test('重拍短切、尺寸重组保留实际图片节点，退场有限卸载且活跃图片至多12张', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { photos, order } = source([1.5, .667, .667, .667, 1.5, .667, .667, .667, 1.5]);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let presentation;
  function Host({ index, playlist = order, aspect = 1.8, accent = false }) {
    presentation = usePlayerPresentation(photos, playlist, index, true, { stageAspect: aspect, accent });
    return h(PlayerFrames, { presentation, onRelink: async () => {} });
  }
  const render = props => act(async () => root.render(h(Host, props)));
  const tick = ms => act(async () => t.mock.timers.tick(ms));
  const image = id => container.querySelector(`img[src="/${id}.jpg"]`);
  const ready = element => act(async () => pending.get(element).resolve());
  const current = () => [...container.querySelectorAll('[data-role=current] img')].map(img => img.alt);
  try {
    await render({ index: 0 });
    const first = image('0'), portrait = image('1');
    await ready(first);
    assert.deepEqual(current(), ['0']);
    await render({ index: 1, accent: true });
    await ready(portrait);
    await ready(image('2'));
    assert.deepEqual(current(), ['0'], '整组完成后才交接');
    await ready(image('3'));
    assert.deepEqual(current(), ['1', '2', '3']);
    assert.equal(image('1'), portrait, '预读节点原位变成展示节点');
    assert.equal(presentation.transition.duration, 150);
    assert.equal(presentation.transition.effect, 'gather', '重拍仍保留构图语义');
    assert(container.querySelectorAll('img').length <= 12);
    await tick(150);
    assert.equal(container.querySelector('[data-role=outgoing]'), null);
    await render({ index: 1, aspect: .8 });
    assert.deepEqual(current(), ['1']);
    assert.equal(image('1'), portrait);
    assert.equal(presentation.transition, null, '尺寸变化不伪装为新照片切换');
    await render({ index: 1, aspect: 1.8 });
    await ready(image('2'));
    await ready(image('3'));
    assert.deepEqual(current(), ['1', '2', '3']);
    assert.equal(image('1'), portrait);
    assert.deepEqual(presentation.displayedRange, { start: 1, end: 3 });
    await ready(image('4'));
    await render({ index: 4 });
    assert.equal(presentation.transition.effect, 'gather');
    assert.equal(presentation.transition.duration, 320);
    await tick(320);
    assert.equal(container.querySelector('[data-role=outgoing]'), null);
    await render({ index: 3, aspect: .8 });
    await ready(image('3'));
    await tick(320);
    const third = image('3');
    await render({ index: 3, aspect: 1.8 });
    await ready(image('1'));
    await ready(image('2'));
    assert.equal(presentation.transition, null, '保留非组首照片定位时，扩宽不切场');
    await render({ index: 3, aspect: .8 });
    assert.deepEqual(current(), ['3']);
    assert.equal(image('3'), third);
    assert.equal(presentation.transition, null, '保留非组首照片定位时，缩窄不切场');
    await render({ index: 0, playlist: ['1', '1'] });
    const repeated = [...container.querySelectorAll('img[src="/1.jpg"]')];
    assert.equal(repeated.length, 2, '画册可以在不同位置引用同一幅照片');
    for (const element of repeated) await ready(element);
    assert.deepEqual(current(), ['1', '1']);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
