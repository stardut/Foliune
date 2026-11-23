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
const sampled = [];
const painted = [];
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,frost-fixture';
window.HTMLCanvasElement.prototype.getContext = function () {
  let image;
  return {
    drawImage: (element) => { image = element; sampled.push({ image, width: this.width, height: this.height }); },
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: (pixels) => painted.push({ canvas: this, pixels }),
    getImageData: (_, __, width, height) => {
      const pixels = new Uint8ClampedArray(width * height * 4);
      const tone = 40 + Number(image.alt) * 20;
      for (let i = 0; i < pixels.length; i += 4) pixels.set([tone, 80, 120, 255], i);
      return { data: pixels };
    },
  };
};
const pending = new WeakMap();
window.HTMLImageElement.prototype.decode = function () {
  if (!pending.has(this)) {
    let resolve, reject;
    const promise = new Promise((done, failed) => { resolve = done; reject = failed; });
    pending.set(this, { promise, resolve, reject });
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
const { buildPlayerCompositions, playerCompositionNeighbor, usePlayerPresentation, PlayerFrames, playerPhotoFit } = module.exports;
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

test('真实屏幕比例优先保持照片高度，16:10的常见竖幅用双联、瘦幅三联', () => {
  const standard = source([2 / 3, 2 / 3, 2 / 3]);
  const slim = source([9 / 16, 9 / 16, 9 / 16]);
  assert.deepEqual(sizes(buildPlayerCompositions(standard.photos, standard.order, 16 / 10)), [2, 1]);
  assert.deepEqual(sizes(buildPlayerCompositions(slim.photos, slim.order, 16 / 10)), [3]);
  assert.deepEqual(sizes(buildPlayerCompositions(standard.photos, standard.order, 16 / 9)), [3]);
});

test('近方竖幅不挤进三联，尺寸缺失照片独立呈现且不跨过去分组', () => {
  const { photos, order } = source([.85, .85, .85, 0, .667, .667]);
  assert.deepEqual(sizes(buildPlayerCompositions(photos, order, 1.5)), [2, 1, 1, 2]);
});

test('单张与组图就绪后立即直切，尺寸重组保留实际图片节点且无方向时活跃图片至多12张', async () => {
  const { photos, order } = source([1.5, .667, .667, .667, 1.5, .667, .667, .667, 1.5]);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let presentation;
  function Host({ index, playlist = order, aspect = 1.8 }) {
    presentation = usePlayerPresentation(photos, playlist, index, true, { stageAspect: aspect, groupPortraits: true });
    return h(PlayerFrames, { presentation, onRelink: async () => {} });
  }
  const render = props => act(async () => root.render(h(Host, props)));
  const image = id => container.querySelector(`img[src="/${id}.jpg"]`);
  const ready = element => act(async () => pending.get(element).resolve());
  const current = () => [...container.querySelectorAll('[data-role=current] img')].map(img => img.alt);
  try {
    await render({ index: 0 });
    const first = image('0'), portrait = image('1');
    await ready(first);
    assert.deepEqual(current(), ['0']);
    assert.equal(first.crossOrigin, 'anonymous');
    assert.deepEqual(sampled.find(sample => sample.image === first), { image: first, width: 96, height: 96 });
    assert(presentation.decoded.get(presentation.displayed.frame.key).edges, '边色与ready在同一条目中一起就绪');
    const mat = container.querySelector('.player-mat[data-role=current]');
    const backgroundCanvases = [...mat.querySelectorAll('.player-mat-wing canvas')];
    assert.equal(backgroundCanvases.length, 4, '四边只有窄条背景画布，不复制整张原图');
    assert(backgroundCanvases.every(canvas => painted.some(record => record.canvas === canvas)), '同一次提交已绘制侧翼，不等待额外图片decode');
    assert(backgroundCanvases.every(canvas => canvas.width <= 96 && canvas.height <= 96));
    assert.equal(mat.querySelectorAll('img').length, 0, '侧翼不增加完整原图节点');
    const firstMat = mat.style.backgroundImage;
    await render({ index: 1 });
    await ready(portrait);
    await ready(image('2'));
    assert.deepEqual(current(), ['0'], '整组完成后才交接');
    assert.equal(container.querySelector('.player-mat[data-role=current]').style.backgroundImage, firstMat, '预读不能提前换掉可见底色');
    await ready(image('3'));
    assert.deepEqual(current(), ['1', '2', '3']);
    assert.equal(image('1'), portrait, '预读节点原位变成展示节点');
    assert.notEqual(container.querySelector('.player-mat[data-role=current]').style.backgroundImage, firstMat, '整组照片与新底板同次交接');
    assert.equal(container.querySelectorAll('.player-seam[data-role=current]').length, 2);
    assert.equal(sampled.filter(sample => sample.image === portrait).length, 1, '展示复用96px边条，不重复解码或采样');
    assert.equal(container.querySelector('[data-role=outgoing]'), null, '就绪提交后不存在退场层或动画等待');
    assert.equal(container.querySelector('[data-effect]'), null, '不为横幅或组图保留归位动效');
    assert(container.querySelectorAll('img').length <= 12);
    await render({ index: 1, aspect: .8 });
    assert.deepEqual(current(), ['1']);
    assert.equal(image('1'), portrait);
    assert.equal(container.querySelector('[data-role=outgoing]'), null, '尺寸重组不保留旧场景');
    await render({ index: 1, aspect: 1.8 });
    await ready(image('2'));
    await ready(image('3'));
    assert.deepEqual(current(), ['1', '2', '3']);
    assert.equal(image('1'), portrait);
    assert.deepEqual(presentation.displayedRange, { start: 1, end: 3 });
    await ready(image('4'));
    await render({ index: 4 });
    assert.deepEqual(current(), ['4'], '组图回单张同样即时交接');
    assert.equal(container.querySelector('[data-role=outgoing]'), null);
    await render({ index: 3, aspect: .8 });
    await ready(image('3'));
    const third = image('3');
    await render({ index: 3, aspect: 1.8 });
    await ready(image('1'));
    await ready(image('2'));
    assert.deepEqual(current(), ['1', '2', '3'], '保留非组首定位时直接完成扩宽重组');
    await render({ index: 3, aspect: .8 });
    assert.deepEqual(current(), ['3']);
    assert.equal(image('3'), third);
    assert.equal(container.querySelector('[data-role=outgoing]'), null, '缩窄后没有旧场景残留');
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


test('下一组全部得到解码结果才允许音乐切图，失败和无下一场不会永久阻塞', async () => {
  const { photos, order } = source([1.5, .667, .667, 1.5]);
  photos.get('3').originalAvailable = false;
  const container = document.createElement('div'), root = createRoot(container);
  let presentation;
  function Host({ index }) {
    presentation = usePlayerPresentation(photos, order, index, false, { stageAspect: 1.8, groupPortraits: true });
    return h(PlayerFrames, { presentation, onRelink: async () => {} });
  }
  const render = index => act(async () => root.render(h(Host, { index })));
  const image = id => container.querySelector(`img[src="/${id}.jpg"]`);
  try {
    await render(0);
    await act(async () => pending.get(image('0')).resolve());
    assert.equal(presentation.requestedVisible, true);
    assert.equal(presentation.nextReady, false);
    await act(async () => pending.get(image('1')).reject(new Error('invalid source')));
    assert.equal(presentation.nextReady, false, '下一组仍有一张未就绪，不得提前切图');
    await act(async () => pending.get(image('2')).resolve());
    assert.equal(presentation.nextReady, true, '失败为已确定结果，不能让音乐永远等它');
    assert.equal(presentation.displayed.start, 0, '预解码只开放后续切图，不提前展示下一组');
    await render(1);
    assert.equal(presentation.displayed.status, 'error');
    assert.equal(presentation.nextReady, true, '下一场原件不可用已是确定结果，不等待不存在的decode');
    assert(container.querySelector('.image-unavailable'), '已知失败仍通过既有错误场景反馈');
    await render(3);
    assert.equal(presentation.nextReady, true, '非循环末场允许时钟按既有规则结束');
  } finally { await act(async () => root.unmount()); }
});

test('画布读取失败只降级装饰，照片与中性底色仍一起ready且照片可见', async t => {
  t.mock.method(window.HTMLCanvasElement.prototype, 'getContext', () => null);
  t.mock.method(console, 'warn', () => {});
  const { photos, order } = source([1.5]);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let presentation;
  function Host() {
    presentation = usePlayerPresentation(photos, order, 0, false, { stageAspect: 1.6 });
    return h(PlayerFrames, { presentation, onRelink: async () => {} });
  }
  try {
    await act(async () => root.render(h(Host)));
    const image = container.querySelector('img');
    await act(async () => pending.get(image).resolve());
    assert.equal(presentation.displayed.status, 'ready');
    assert.equal(presentation.requestedVisible, true);
    assert.equal(container.querySelector('.player-frame[data-role=current] img'), image);
    assert.deepEqual(presentation.decoded.get(presentation.displayed.frame.key).edges.left, [20, 21, 22]);
    assert.match(container.querySelector('.player-mat').style.backgroundImage, /rgb\(20 21 22\)/);
    assert.equal(container.querySelector('.image-unavailable'), null);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});


test('单张贴屏以原图面积损失为准，7%双向边界包含、略超拒绝且无效尺寸保持完整', () => {
  assert.equal(playerPhotoFit({ width: 3, height: 2 }, 16 / 10, true), 'cover');
  assert.equal(playerPhotoFit({ width: 3, height: 2 }, 16 / 10, false), 'contain');
  assert.equal(playerPhotoFit({ width: 3, height: 2 }, 16 / 9, true), 'contain');
  for (const stage of [1.5 / .93, 1.5 * .93]) assert.equal(playerPhotoFit({ width: 3, height: 2 }, stage, true), 'cover');
  for (const stage of [1.5 / (.93 - 1e-10), 1.5 * (.93 - 1e-10)]) assert.equal(playerPhotoFit({ width: 3, height: 2 }, stage, true), 'contain');
  for (const stage of [0, -1, NaN, Infinity]) assert.equal(playerPhotoFit({ width: 3, height: 2 }, stage, true), 'contain');
  for (const size of [undefined, { width: 0, height: 2 }, { width: 3, height: 0 }, { width: Infinity, height: 2 }, { width: 3, height: NaN }]) {
    assert.equal(playerPhotoFit(size, 1.6, true), 'contain');
  }
});

test('cover跟随真实舞台重组且复用img，双三联保持contain，就绪后立即替换旧cover', async t => {
  t.mock.getter(window.HTMLImageElement.prototype, 'naturalWidth', function () { return this.width; });
  t.mock.getter(window.HTMLImageElement.prototype, 'naturalHeight', function () { return this.height; });
  const { photos, order } = source([1.5, 2 / 3, 2 / 3, 2 / 3, 1.8]);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let presentation;
  function Host({ aspect = 1.6, index = 0, preferFill = false }) {
    presentation = usePlayerPresentation(photos, order, index, true, { stageAspect: aspect, preferFill, groupPortraits: true });
    return h(PlayerFrames, { presentation, onRelink: async () => {} });
  }
  const render = props => act(async () => root.render(h(Host, props)));
  const image = id => container.querySelector(`img[src="/${id}.jpg"]`);
  const ready = element => act(async () => pending.get(element).resolve());
  try {
    await render({ preferFill: true });
    assert.equal(presentation.requested.fit, 'contain', '尚未解码不信任持久化尺寸');
    const first = image('0');
    await ready(first);
    assert.equal(first.closest('.player-frame').dataset.fit, 'cover');
    assert.equal(container.querySelector('.player-mat'), null);
    await render({});
    assert.equal(first.closest('.player-frame').dataset.fit, 'contain', '默认开关关闭仍完整显示');
    assert(container.querySelector('.player-mat'));
    await render({ preferFill: true, aspect: 1.8 });
    assert.equal(first.closest('.player-frame').dataset.fit, 'contain', '真实舞台超限回到完整构图');
    await render({ preferFill: true });
    assert.equal(first.closest('.player-frame').dataset.fit, 'cover');
    assert.equal(image('0'), first);
    assert.equal(container.querySelector('[data-role=outgoing]'), null, '同照片重测不保留旧场景');
    await render({ index: 1, preferFill: true });
    await ready(image('1')); await ready(image('2'));
    assert.equal(presentation.displayed.fit, 'contain');
    assert.equal(presentation.displayed.frames.length, 2);
    assert.equal(first.closest('.player-frame').dataset.role, 'prepared', '旧cover即时退出可见场景，仍可作为相邻预读复用');
    assert.equal(container.querySelector('.player-mat[data-role=outgoing]'), null, '旧cover没有错误哑光遮挡新场景');
    await render({ index: 1, preferFill: true, aspect: 1.8 });
    await ready(image('3'));
    assert.equal(presentation.displayed.frames.length, 3);
    assert.equal(presentation.displayed.fit, 'contain');
    for (const frame of container.querySelectorAll('.player-frame[data-role=current]')) assert.equal(frame.dataset.fit, 'contain');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test('裁切决策使用真实解码尺寸，元数据过期或原图损坏不突破7%面积上限', async t => {
  t.mock.getter(window.HTMLImageElement.prototype, 'naturalWidth', function () { return this.alt === '0' ? 1800 : 1500; });
  t.mock.getter(window.HTMLImageElement.prototype, 'naturalHeight', () => 1000);
  const { photos, order } = source([1.5, 1.8, 1.5]);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let presentation;
  function Host({ index = 0 }) {
    presentation = usePlayerPresentation(photos, order, index, false, { stageAspect: 1.6, preferFill: true });
    return h(PlayerFrames, { presentation, onRelink: async () => {} });
  }
  const render = index => act(async () => root.render(h(Host, { index })));
  const image = id => container.querySelector(`img[src="/${id}.jpg"]`);
  try {
    await render(0);
    await act(async () => pending.get(image('0')).resolve());
    assert.equal(presentation.displayed.fit, 'contain', '元数据3:2但真实16:9，不允许按旧尺寸裁切');
    await render(1);
    await act(async () => pending.get(image('1')).resolve());
    assert.equal(presentation.displayed.fit, 'cover', '真实3:2按实际尺寸可铺满16:10');
    await render(2);
    await act(async () => pending.get(image('2')).reject(new Error('invalid source')));
    assert.equal(presentation.displayed.status, 'error');
    assert.equal(presentation.displayed.fit, 'contain');
    assert(container.querySelector('.image-unavailable'));
    assert.equal(container.querySelector('.player-frame[data-role=current][data-fit=cover]'), null);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});


test('竖幅组图默认逐张，开启复用不同屏幕比例分组，开关不重建当前原图节点', async () => {
  const { photos, order } = source(Array(6).fill(2 / 3));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let presentation;
  function Host({ groupPortraits, aspect = 16 / 9 }) {
    presentation = usePlayerPresentation(photos, order, 0, true, { stageAspect: aspect, groupPortraits });
    return h(PlayerFrames, { presentation, onRelink: async () => {} });
  }
  const render = props => act(async () => root.render(h(Host, props)));
  const image = id => container.querySelector(`img[src="/${id}.jpg"]`);
  const ready = element => act(async () => pending.get(element).resolve());
  try {
    await render({});
    const first = image('0');
    await ready(first);
    assert.deepEqual(sizes(presentation.compositions), Array(6).fill(1));
    assert.equal(presentation.displayed.frames.length, 1);
    assert.equal(playerCompositionNeighbor(presentation.compositions, 0, 1, true), 1);
    await render({ groupPortraits: true, aspect: 16 / 10 });
    await ready(image('1'));
    assert.deepEqual(sizes(presentation.compositions), [2, 2, 2]);
    assert.equal(presentation.displayed.frames.length, 2);
    assert.equal(playerCompositionNeighbor(presentation.compositions, 0, 1, true), 2);
    await render({ groupPortraits: true, aspect: 16 / 9 });
    await ready(image('2'));
    assert.deepEqual(sizes(presentation.compositions), [3, 3]);
    assert.equal(presentation.displayed.frames.length, 3);
    assert.equal(playerCompositionNeighbor(presentation.compositions, 0, 1, true), 3);
    await render({ groupPortraits: true, aspect: .8 });
    assert.deepEqual(sizes(presentation.compositions), Array(6).fill(1));
    await render({ groupPortraits: false, aspect: 16 / 9 });
    assert.deepEqual(sizes(presentation.compositions), Array(6).fill(1));
    assert.equal(presentation.displayed.frames.length, 1);
    assert.equal(image('0'), first);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test('方向预载按整组保留三组和反向一组，单张邻三联不会截断，readiness始终检查实际下一组', async () => {
  const { photos, order } = source([1.5, ...Array(18).fill(2 / 3)]);
  const container = document.createElement('div'), root = createRoot(container);
  let presentation;
  function Host({ index = 0, direction = 0, loop = true }) {
    presentation = usePlayerPresentation(photos, order, index, loop, { stageAspect: 1.8, groupPortraits: true, direction });
    return h(PlayerFrames, { presentation, onRelink: async () => {} });
  }
  const render = props => act(async () => root.render(h(Host, props)));
  const image = id => container.querySelector(`img[src="/${id}.jpg"]`);
  const ready = id => act(async () => pending.get(image(id)).resolve());
  const active = () => [...presentation.frames.values()].map(frame => Number(frame.id)).sort((a, b) => a - b);
  try {
    await render({});
    assert.deepEqual(active(), [0, 1, 2, 3, 16, 17, 18], '无方向只准备前后各一整组');
    await ready(0);
    await render({ index: 1, direction: 1 });
    assert.deepEqual(active(), Array.from({ length: 13 }, (_, i) => i), '三组三联与一张反向照片完整保留，超过旧12张上限');
    for (const id of [1, 2, 3]) await ready(id);
    assert.equal(presentation.displayed.start, 1);
    assert.equal(image(1).getAttribute('fetchpriority'), 'high');
    assert.equal(image(4).getAttribute('fetchpriority'), 'low');
    assert.equal(presentation.nextReady, false);
    for (const id of [4, 5]) await ready(id);
    assert.equal(presentation.nextReady, false, '下一组三联最后一张未解码时不提前通过');
    await ready(6);
    assert.equal(presentation.nextReady, true);
    await render({ index: 7, direction: -1 });
    assert.deepEqual(active(), Array.from({ length: 13 }, (_, i) => i), '反向三组及实际下一组均保留');
    assert.equal(presentation.nextReady, false, '反向邻居已就绪也不能冒充实际下一组就绪');
    for (const id of [7, 8, 9, 10, 11]) await ready(id);
    assert.equal(presentation.displayed.start, 7);
    assert.equal(presentation.nextReady, false);
    await ready(12);
    assert.equal(presentation.nextReady, true);
    await render({ index: 0, direction: -1, loop: false });
    assert.deepEqual(active(), [0, 1, 2, 3], '非循环起点不补绕回的组');
  } finally { await act(async () => root.unmount()); }
});

test('小列表方向预载循环去重，不重复挂载同一组或漏掉反向跨两轮的组', async () => {
  const container = document.createElement('div'), root = createRoot(container);
  let presentation;
  function Host({ count, direction }) {
    const { photos, order } = source(Array(count).fill(1.5));
    presentation = usePlayerPresentation(photos, order, 0, true, { direction });
    return h(PlayerFrames, { presentation, onRelink: async () => {} });
  }
  try {
    for (const count of [1, 2, 3, 4]) for (const direction of [-1, 1]) {
      await act(async () => root.render(h(Host, { count, direction })));
      assert.deepEqual([...presentation.frames.values()].map(frame => frame.id).sort(), Array.from({ length: count }, (_, i) => String(i)));
      assert.equal(container.querySelectorAll('img').length, count);
    }
  } finally { await act(async () => root.unmount()); }
});
