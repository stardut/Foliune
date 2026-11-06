import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../src/features/books/book-cover-design.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { centerCoverCrop, fitCoverTitle, designCoverTitle, mapCoverRegions, placeCoverTitle, loadCoverSample } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const measure = (text, size, italic) => Array.from(text).reduce((sum, c) => sum + (/\p{Script=Han}/u.test(c) ? 1 : /[MW]/.test(c) ? .9 : .52) * size * (italic ? 1.04 : 1), 0);
const plain = (layout) => layout.lines.flat().map((run) => run.text).join('').replace(/\s/g, '');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function sample(pixel) {
  const size = 96; const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = pixel(x, y); const index = (y * size + x) * 4;
    pixels.set([value, value, value, 255], index);
  }
  return { pixels, size, crop: centerCoverCrop(960, 640), sourceWidth: 960, sourceHeight: 640 };
}
test('分析中心裁切与cover一致，横竖方原比例源区不变形', () => {
  assert.deepEqual(centerCoverCrop(960, 640), { x: 160, y: 0, width: 640, height: 640 });
  assert.deepEqual(centerCoverCrop(640, 960), { x: 0, y: 160, width: 640, height: 640 });
  assert.deepEqual(centerCoverCrop(640, 640), { x: 0, y: 0, width: 640, height: 640 });
  assert.throws(() => centerCoverCrop(0, 640));
});
test('中英混排及无空格长名按测量容纳，真实内容完整、英文末词使用italic', () => {
  for (const width of [240, 260]) for (const title of ['山间 · 竖幅封面', 'Cloud Studies', '潮汐之间 Between Tides', 'The UninterruptedLightAcrossTheMountainValley', '繁體攝影與山川湖泊'.repeat(12), 'W'.repeat(200)]) {
    const layout = fitCoverTitle(title, width, measure);
    assert.ok(layout.size >= 12 && layout.size <= 44);
    assert.ok(layout.width <= width * .8 + 1e-7);
    assert.ok(layout.height <= width * .52 + 1e-7);
    if (!layout.truncated) assert.equal(plain(layout), title.replace(/\s/g, ''));
    else assert.ok(plain(layout).endsWith('…'));
  }
  const english = fitCoverTitle('Cloud Studies', 260, measure);
  const runs = english.lines.flat();
  assert.equal(runs.filter((run) => run.italic).map((run) => run.text).join(''), 'Studies');
  assert.equal(runs.filter((run) => !run.italic).map((run) => run.text).join('').trim(), 'Cloud');
});
test('多换行极端标题保持12px可读字号，明确省略并不越出边界', () => {
  const layout = fitCoverTitle('山\n'.repeat(90), 240, measure);
  assert.equal(layout.size, 12); assert.equal(layout.truncated, true);
  assert.ok(layout.height <= 240 * .52);
  assert.ok(plain(layout).endsWith('…'));
});
test('候选深浅字依据局部对比选择，所有实际标题框在封面内', () => {
  const layout = fitCoverTitle('山间', 260, measure);
  for (const [value, expected] of [[255, '#171716'], [0, '#f8f4eb']]) {
    const placement = placeCoverTitle(sample(() => value), layout, 260);
    assert.equal(placement.color, expected); assert.equal(placement.reinforced, false);
    assert.ok(placement.x >= 0 && placement.y >= 0);
    assert.ok(placement.x + layout.width / 260 <= 1);
    assert.ok(placement.y + layout.height / 260 <= 1);
  }
});
test('宁取3–4.5对比的安静上左区，不为极端对比移入高纹理中心主体', () => {
  const layout = fitCoverTitle('Cloud Studies', 260, measure);
  // sRGB 118 gives both soft white and near-black text only 3–4.5:1.
  const scene = sample((x, y) => x > 40 && x < 85 && y > 40 && y < 85 ? ((x + y) % 2 ? 30 : 80) : 118);
  const placement = placeCoverTitle(scene, layout, 260);
  assert.equal(placement.x, .08); assert.equal(placement.y, .07);
  assert.equal(placement.reinforced, false); assert.equal(placement.color, '#f8f4eb');
  assert.ok(layout.size <= 36 && layout.height <= 260 * .52);
  const chinese = fitCoverTitle('潮汐之间', 260, measure);
  assert.equal(chinese.lines.length, 2);
  assert.deepEqual(chinese.lines.map((line) => line.map((run) => run.text).join('')), ['潮汐', '之间']);
  assert.ok(fitCoverTitle('潮汐之间 Between Tides', 260, measure).size <= 32);
  assert.ok(fitCoverTitle('The UninterruptedLightAcrossTheMountainValley', 260, measure).size <= 30);
});
test('同位置同字色下，小于24px按4.5保护，大字按3保护，不改变选位尺寸', () => {
  const scene = sample(() => 118);
  const base = fitCoverTitle('Cloud Studies', 260, measure);
  const large = placeCoverTitle(scene, { ...base, size: 24 }, 260);
  const small = placeCoverTitle(scene, { ...base, size: 23 }, 260);
  assert.equal(large.reinforced, false); assert.equal(small.reinforced, true);
  assert.equal(small.x, large.x); assert.equal(small.y, large.y);
  assert.equal(small.color, large.color); assert.equal(small.score, large.score);
});
test('半透明白色PNG按真实深色舞台合成后选择浅字，透明RGB不误导对比', () => {
  const translucent = sample(() => 255);
  for (let index = 3; index < translucent.pixels.length; index += 4) translucent.pixels[index] = 25;
  const placement = placeCoverTitle(translucent, fitCoverTitle('山间', 260, measure), 260);
  assert.equal(placement.color, '#f8f4eb'); assert.equal(placement.reinforced, false);
  for (let index = 3; index < translucent.pixels.length; index += 4) translucent.pixels[index] = 0;
  assert.equal(placeCoverTitle(translucent, fitCoverTitle('山间', 260, measure), 260).color, '#f8f4eb');
});
test('纹理和人工区域影响位置，不能只用整图平均明度', () => {
  const layout = fitCoverTitle('山间', 260, measure);
  const dark = sample(() => 0);
  const original = placeCoverTitle(dark, layout, 260);
  const avoid = { x: 160 / 960, y: 0, width: .5, height: .36 };
  const moved = placeCoverTitle(dark, layout, 260, [avoid]);
  assert.ok(moved.x !== original.x || moved.y !== original.y);
  const noisyTop = sample((x, y) => y < 35 && x < 60 ? ((x + y) % 2 ? 255 : 0) : 0);
  const placement = placeCoverTitle(noisyTop, layout, 260);
  assert.ok(placement.y > original.y || placement.x > original.x);
  const mapped = mapCoverRegions([{ x: 0, y: 0, width: .1, height: 1 }, { x: .5, y: 0, width: .5, height: 1 }], dark.crop, 960, 640);
  assert.equal(mapped.length, 1); close(mapped[0].x, .5); close(mapped[0].width, .5);
});
test('感知归一化梯度识别暗岩石纹理，不把暗部误当安静区', () => {
  const scene = sample((x, y) => y > 55 ? ((x + y) % 2 ? 45 : 8) : 230);
  const placement = placeCoverTitle(scene, fitCoverTitle('山间', 260, measure), 260);
  assert.ok(placement.y < .2); assert.equal(placement.color, '#171716');
});
test('有限布局联合比较保留原名及边界，不凭空放大短名，平静中区不固定排斥', () => {
  const title = '潮汐之间 Between Tides';
  const scene = sample((x, y) => y > 39 && y < 62 ? 180 : ((x + y) % 2 ? 230 : 15));
  const selected = designCoverTitle(scene, title, 260, measure);
  assert.equal(plain(selected.layout), title.replace(/\s/g, ''));
  assert.ok(selected.layout.size >= 18 && selected.layout.size <= fitCoverTitle(title, 260, measure).size);
  assert.ok(selected.placement.x + selected.layout.width / 260 <= 1);
  assert.ok(selected.placement.y + selected.layout.height / 260 <= 1);
  assert.ok(selected.placement.y >= .2 && selected.placement.y <= .52);
  const camel = fitCoverTitle('The UninterruptedLightAcrossTheMountainValley', 260, measure);
  assert.equal(plain(camel), 'TheUninterruptedLightAcrossTheMountainValley');
  assert.ok(camel.lines.some((line) => /^(Light|Across|The|Mountain|Valley)/.test(line.map((run) => run.text).join(''))));
});
test('全图复杂明暗无法稳定对比时启用仅字形描边，书名仍可见', () => {
  const placement = placeCoverTitle(sample((x, y) => (x + y) % 2 ? 255 : 0), fitCoverTitle('Cloud Studies', 260, measure), 260);
  assert.equal(placement.reinforced, true);
  assert.ok(placement.color && placement.outline && placement.color !== placement.outline);
});
function environment({ tainted = false, loadFails = false } = {}) {
  const oldImage = globalThis.Image; const oldDocument = globalThis.document; const calls = [];
  const canvas = { width: 0, height: 0, getContext: () => ({
    drawImage(...args) { calls.push(['draw', ...args.slice(1)]); },
    getImageData(...args) { calls.push(['read', ...args]); if (tainted) throw new DOMException('tainted', 'SecurityError'); return { data: sample(() => 0).pixels }; },
  }) };
  globalThis.Image = class {
    naturalWidth = 960; naturalHeight = 640;
    set crossOrigin(value) { calls.push(['cors', value]); }
    set src(value) { calls.push(['source', value]); queueMicrotask(() => loadFails ? this.onerror() : this.onload()); }
  };
  globalThis.document = { createElement: () => canvas };
  return { calls, canvas, restore() { globalThis.Image = oldImage; globalThis.document = oldDocument; } };
}
test('实际采样绘制中心cover源区，CORS先于src设置，画布释放', async () => {
  const env = environment();
  try {
    await loadCoverSample('asset://localhost/thumbnail.jpg');
    assert.deepEqual(env.calls.slice(0, 2), [['cors', 'anonymous'], ['source', 'asset://localhost/thumbnail.jpg']]);
    assert.deepEqual(env.calls.find((call) => call[0] === 'draw'), ['draw', 160, 0, 640, 640, 0, 0, 96, 96]);
    assert.deepEqual(env.calls.find((call) => call[0] === 'read'), ['read', 0, 0, 96, 96]);
    assert.equal(env.canvas.width, 0); assert.equal(env.canvas.height, 0);
  } finally { env.restore(); }
});
test('CORS与canvas污染明确失败，不重试其它来源', async () => {
  for (const options of [{ tainted: true }, { loadFails: true }]) {
    const env = environment(options);
    try {
      await assert.rejects(loadCoverSample('asset://localhost/thumbnail.jpg'), /封面分析不可用/);
      assert.equal(env.calls.filter((call) => call[0] === 'source').length, 1);
      assert.equal(env.canvas.width, 0);
    } finally { env.restore(); }
  }
});

test('离开书架后取消在途图片分析，不再创建采样画布或绘制', async () => {
  const originalImage = globalThis.Image; const originalDocument = globalThis.document;
  let image; let canvases = 0;
  globalThis.Image = class { constructor() { image = this; } set src(value) {} };
  globalThis.document = { createElement() { canvases++; } };
  try {
    const controller = new AbortController();
    const pending = loadCoverSample('asset://localhost/late.jpg', controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(image.onload, null); assert.equal(image.onerror, null); assert.equal(canvases, 0);
    await assert.rejects(loadCoverSample('asset://localhost/late.jpg', controller.signal), { name: 'AbortError' });
    assert.equal(canvases, 0);
  } finally { globalThis.Image = originalImage; globalThis.document = originalDocument; }
});
