import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/features/review-presentation.ts', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
});
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { ReviewPresentation } = module.exports;

test('重开本地原片时重新读源文件，移出显示缺失，放回后可读', async (t) => {
  const decoded = new Set();
  let sourcePresent = true;
  globalThis.Image = class {
    naturalWidth = 1600;
    async decode() {
      if (decoded.has(this.src)) return;
      if (!sourcePresent) throw new Error('Source file missing');
      decoded.add(this.src);
    }
  };
  t.after(() => { delete globalThis.Image; });
  const photo = {
    id: 'photo',
    originalPath: 'local-photo:/photos/source.jpg',
    originalUrl: 'work-photo://localhost/photo',
    thumbnailUrl: 'asset://localhost/thumb.jpg',
    originalAvailable: true,
    thumbnailAvailable: true,
  };
  async function reopen() {
    const review = new ReviewPresentation(photo, () => {});
    review.update([photo], photo.id, 0, true);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      return review.state.incoming ?? review.state.current;
    } finally {
      review.dispose();
    }
  }

  assert.equal((await reopen()).kind, 'image');
  sourcePresent = false;
  assert.equal((await reopen()).kind, 'error');
  sourcePresent = true;
  assert.equal((await reopen()).kind, 'image');
});

function preloadFixture(t) {
  const images = [];
  globalThis.Image = class {
    constructor() { images.push(this); }
    decode() { return new Promise(() => {}); }
    removeAttribute(name) { if (name === 'src') this.src = undefined; }
  };
  t.after(() => { delete globalThis.Image; });
  const photos = Array.from({ length: 10 }, (_, index) => ({
    id: String(index), originalUrl: `/${index}.jpg`, originalPath: `/${index}.jpg`, originalAvailable: true,
  }));
  const active = () => images.filter(image => image.src).map(image => image.src).sort();
  return { photos, images, active };
}

test('大图初始前后各一张，有效切换后沿方向三张、反向一张，快速反向释放旧窗口', t => {
  const { photos, images, active } = preloadFixture(t);
  const review = new ReviewPresentation(photos[4], () => {}, true);
  t.after(() => review.dispose());
  review.update(photos, '4', 0, true);
  assert.deepEqual(active(), ['/3.jpg', '/4.jpg', '/5.jpg']);
  assert.equal(images.find(image => image.src === '/4.jpg').fetchPriority, 'high');
  assert.equal(images.find(image => image.src === '/5.jpg').fetchPriority, 'low');
  review.update(photos, '5', 1, true);
  assert.deepEqual(active(), ['/4.jpg', '/5.jpg', '/6.jpg', '/7.jpg', '/8.jpg']);
  assert.equal(images.find(image => image.src === '/5.jpg').fetchPriority, 'high', '预读变为目标时提高优先级');
  review.update(photos, '4', -1, true);
  assert.deepEqual(active(), ['/1.jpg', '/2.jpg', '/3.jpg', '/4.jpg', '/5.jpg']);
  review.update(photos, '4', 1, false);
  assert.deepEqual(active(), ['/1.jpg', '/2.jpg', '/3.jpg', '/4.jpg', '/5.jpg'], '同一目标的刷新不构成有效换向');
  review.retry();
  assert.deepEqual(active(), ['/1.jpg', '/2.jpg', '/3.jpg', '/4.jpg', '/5.jpg'], '重试的零方向保留最近有效方向');
  review.update(photos, '0', -1, true);
  assert.deepEqual(active(), ['/0.jpg', '/1.jpg'], '非循环边界只保留存在的照片');
});

test('大图目标不可读仍准备全部可读邻居，重定位保持最近方向并取消旧地址', t => {
  const { photos, active } = preloadFixture(t);
  const review = new ReviewPresentation(photos[5], () => {}, true);
  t.after(() => review.dispose());
  review.update(photos, '5', 0, true);
  const unavailable = photos.map(photo => photo.id === '4' ? { ...photo, originalAvailable: false } : photo);
  review.update(unavailable, '4', -1, true);
  assert.equal(review.state.current.kind, 'error');
  assert.deepEqual(active(), ['/1.jpg', '/2.jpg', '/3.jpg', '/5.jpg']);
  const relinked = photos.map(photo => photo.id === '4' ? { ...photo, originalUrl: '/replacement.jpg' } : photo);
  review.update(relinked, '4', 0, true);
  assert.deepEqual(active(), ['/1.jpg', '/2.jpg', '/3.jpg', '/5.jpg', '/replacement.jpg']);
  review.retry(relinked[4]);
  assert.deepEqual(active(), ['/1.jpg', '/2.jpg', '/3.jpg', '/5.jpg', '/replacement.jpg']);
});

test('单张布局沿用原有前后各一张，不因连续切图扩大预读', t => {
  const { photos, active } = preloadFixture(t);
  const review = new ReviewPresentation(photos[4], () => {});
  t.after(() => review.dispose());
  review.update(photos, '4', 0, true);
  review.update(photos, '5', 1, true);
  assert.deepEqual(active(), ['/4.jpg', '/5.jpg', '/6.jpg']);
  review.update(photos, '4', -1, true);
  assert.deepEqual(active(), ['/3.jpg', '/4.jpg', '/5.jpg']);
});
