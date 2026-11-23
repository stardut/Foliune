import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/features/player-mat.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { playerEdgesFromPixels, playerMatColors, samplePlayerMat, neutralPlayerMat, playerTexturesFromPixels } = module.exports;

function edgeSample(center = [255, 255, 255, 255]) {
  const pixels = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const color = x < 2 ? [255, 0, 0, 255] : x >= 30 ? [0, 255, 0, 255]
      : y < 2 ? [0, 0, 255, 255] : y >= 30 ? [255, 255, 255, 255] : center;
    pixels.set(color, (y * 32 + x) * 4);
  }
  return pixels;
}

test('邻接四边分别取色，主体变化不染底，明亮饱和图限制到暗色哑光范围', () => {
  const edges = playerEdgesFromPixels(edgeSample(), 32);
  assert.deepEqual(edges, playerEdgesFromPixels(edgeSample([0, 0, 0, 255]), 32));
  assert(edges.left[0] > edges.left[1] && edges.left[0] > edges.left[2]);
  assert(edges.right[1] > edges.right[0] && edges.right[1] > edges.right[2]);
  assert(edges.top[2] > edges.top[0] && edges.top[2] > edges.top[1]);
  for (const rgb of Object.values(edges)) for (const channel of rgb) assert(channel >= 12 && channel <= 42);
  assert.deepEqual(edges.bottom, [37, 37, 37]);
});

test('组合只使用最外侧边色，上下按照片实际宽度混合，透明图仍有有效中性边色', () => {
  const first = { left: [30, 18, 18], right: [18, 30, 18], top: [30, 20, 20], bottom: [20, 30, 20] };
  const last = { left: [18, 18, 30], right: [28, 20, 18], top: [18, 20, 20], bottom: [20, 18, 20] };
  const colors = playerMatColors([{ edges: first, ratio: .5 }, { edges: last, ratio: 1 }]);
  assert.deepEqual(colors.left, first.left);
  assert.deepEqual(colors.right, last.right);
  assert.deepEqual(colors.top, [22, 20, 20]);
  assert.deepEqual(colors.bottom, [20, 22, 20]);
  const transparent = playerEdgesFromPixels(new Uint8ClampedArray(32 * 32 * 4), 32);
  assert.deepEqual(transparent.left, transparent.right);
  assert(transparent.left.every(value => value > 0));
});

test('装饰采样不可用或跨域受限仍返回可展示底色，记录一次且总是释放小画布', t => {
  const canvases = [];
  let tainted = false;
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0, getContext() {
      if (!tainted) return null;
      return { drawImage() {}, getImageData() { throw new DOMException('tainted', 'SecurityError'); } };
    } };
    canvases.push(canvas);
    return canvas;
  } };
  try {
    assert.equal(samplePlayerMat({}), neutralPlayerMat);
    tainted = true;
    assert.equal(samplePlayerMat({}), neutralPlayerMat);
    assert.equal(warnings.length, 1);
    for (const canvas of canvases) assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  } finally { delete globalThis.document; }
});


function spatialSample(size = 96, center = [0, 255, 0]) {
  const pixels = new Uint8ClampedArray(size * size * 4), band = Math.floor(size * .10);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const left = y < size / 3 ? [160, 192, 224] : y < size * 2 / 3 ? [103, 95, 92] : [161, 131, 91];
    const right = y < size / 3 ? [140, 160, 200] : [195, 110, 39];
    const color = x < band ? left : x >= size - band ? right : y < band ? [100, 160, 220] : y >= size - band ? [190, 130, 50] : center;
    pixels.set([...color, 255], (y * size + x) * 4);
  }
  return pixels;
}
const texel = (texture, x, y) => [...texture.pixels.slice((y * texture.width + x) * 4, (y * texture.width + x) * 4 + 3)];

test('窄条保留天空、山影、暖光的沿边位置与明度，完整主体不进入纹理', () => {
  const textures = playerTexturesFromPixels(spatialSample(), 96);
  assert.deepEqual(textures, playerTexturesFromPixels(spatialSample(96, [255, 0, 255]), 96), '中心主体改变不改变侧翼');
  assert.deepEqual(texel(textures.left, 3, 10), [160, 192, 224]);
  assert.deepEqual(texel(textures.left, 3, 48), [103, 95, 92]);
  assert.deepEqual(texel(textures.left, 3, 86), [161, 131, 91]);
  assert.deepEqual(texel(textures.right, 3, 48), [195, 110, 39]);
  assert.deepEqual([textures.left.width, textures.left.height], [9, 96]);
  assert.deepEqual([textures.top.width, textures.top.height], [96, 9]);
  assert(Object.values(textures).every(texture => texture.width * texture.height <= 96 * 9));
  const transparent = playerTexturesFromPixels(new Uint8ClampedArray(96 * 96 * 4), 96);
  assert.deepEqual(texel(transparent.left, 0, 0), [20, 21, 22]);
});

test('纹理只从实际解码节点绘制一次，小颗粒全会话共享且画布及时释放', () => {
  const draws = [], canvases = [], encodes = [];
  const source = {};
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0, toDataURL(type) { encodes.push(type); return 'data:image/png;base64,shared-grain'; }, getContext() {
      return {
        drawImage: (...args) => draws.push(args), getImageData: () => ({ data: spatialSample() }),
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData() {},
      };
    } };
    canvases.push(canvas); return canvas;
  } };
  try {
    const first = samplePlayerMat(source), second = samplePlayerMat(source);
    assert(first.textures && second.textures);
    assert.deepEqual(draws, [[source, 0, 0, 96, 96], [source, 0, 0, 96, 96]]);
    assert.deepEqual(encodes, ['image/png'], '全会话只编码一次共享颗粒');
    assert.equal(first.frost, second.frost);
    for (const canvas of canvases) assert.deepEqual([canvas.width, canvas.height], [0, 0]);
  } finally { delete globalThis.document; }
});
