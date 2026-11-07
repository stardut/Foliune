import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'Element', 'Node', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = key === 'window' ? window : window[key];
  Object.defineProperty(globalThis, key, { configurable: true, value: key.endsWith('AnimationFrame') ? value.bind(window) : value });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: {
    contents: 'export { PhotoReview } from "./PhotoReview"; export { PhotoDetail } from "./PhotoDetail";',
    resolveDir: resolve('apps/desktop/src/features'),
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
  write: false, loader: { '.css': 'empty' },
  plugins: [{ name: 'preview-boundaries', setup(build) {
    build.onResolve({ filter: /\/(api|PhotoReviewImage)$/ }, ({ path }) => ({ path, namespace: 'preview-boundary' }));
    build.onLoad({ filter: /.*/, namespace: 'preview-boundary' }, ({ path }) => ({
      contents: path.endsWith('/api')
        ? 'export const readPhotoMetadata = (...args) => globalThis.requestReviewMetadata(...args);'
        : `export const PhotoReviewImage = () => null;
          export function useReviewPresentation(photos, id) {
            const photo = globalThis.presentedReviewPhoto ?? photos.find(photo => photo.id === id);
            return { state: { current: photo && { photo }, waiting: false }, controller: {} };
          }`,
    }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { PhotoReview, PhotoDetail } = module.exports;

const photo = (id, fields = {}) => ({
  id, title: id, originalName: `${id}.jpg`, originalPath: `/test/${id}.jpg`,
  originalAvailable: true, width: 3000, height: 2000, capturedAt: null, location: '', source: '',
  ...fields,
});
const withoutExif = {
  camera: null, lens: null, focalLengthMm: null, focalLength35mm: null,
  aperture: null, exposureSeconds: null, iso: null, exposureCompensationEv: null,
  exposureMode: null, meteringMode: null, whiteBalance: null, flashFired: null,
  exifReadFailed: false, fileFormat: 'PNG', fileSizeBytes: 900,
};

async function scenario(photos, run, onClose = () => {}) {
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  const calls = [];
  globalThis.requestReviewMetadata = (id, path) => new Promise((resolve, reject) => calls.push({ id, path, resolve, reject }));
  const render = (next) => act(async () => root.render(h(PhotoReview, {
    photos: next, initialPhotoId: photos[0].id, context: '相簿', busy: false, onClose, onRelink() {},
  })));
  const trigger = () => container.querySelector('.photo-review-info-button');
  const panel = () => container.querySelector('.photo-review-info-panel');
  const toggle = () => act(async () => trigger().click());
  try {
    await render(photos);
    await run({ container, calls, render, trigger, panel, toggle });
  } finally {
    delete globalThis.presentedReviewPhoto;
    delete globalThis.requestReviewMetadata;
    await act(async () => root.unmount());
    container.remove();
  }
}

test('返回报告已呈现帧，等待中的下一张不覆盖，并先解除模态', async () => {
  const first = photo('first');
  const second = photo('second');
  for (const visible of [first, second]) {
    const closed = [];
    await scenario([first, second], async ({ container }) => {
      const dialog = container.querySelector('dialog');
      globalThis.presentedReviewPhoto = visible;
      await act(async () => container.querySelector('[aria-label="下一张"]').click());
      assert.equal(dialog.querySelector('h2').textContent, visible.title);
      await act(async () => {
        dialog.querySelector('.photo-review-back').click();
      });
      assert.deepEqual(closed, [[visible.id, false]]);
    }, (id) => closed.push([id, !!document.querySelector('dialog[open]')]));
  }
});

test('大图遮罩、空白及 Escape/cancel 保留当前照片，返回按钮仍可关闭', async () => {
  const closed = [];
  await scenario([photo('first')], async ({ container }) => {
    const dialog = container.querySelector('dialog');
    const stage = container.querySelector('.photo-review-stage');
    await act(async () => {
      dialog.click();
      stage.click();
      stage.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    const cancel = new window.Event('cancel', { cancelable: true });
    await act(async () => dialog.dispatchEvent(cancel));
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(dialog.open, true);
    assert.deepEqual(closed, []);
    await act(async () => dialog.querySelector('.photo-review-back').click());
    assert.deepEqual(closed, ['first']);
  }, id => closed.push(id));
});

test('按需读取原件并排列拍摄参数，保持手填时间地点', async () => {
  const first = photo('portrait', { capturedAt: '2021-06-02T11:00:00Z', location: '手填地点', source: '收藏来源' });
  await scenario([first], async ({ calls, panel, toggle, render }) => {
    assert.equal(calls.length, 0);
    await toggle();
    assert.deepEqual(calls.map(({ id, path }) => [id, path]), [['portrait', '/test/portrait.jpg']]);
    assert.equal(panel().querySelector('[role=status]').textContent, '正在读取原图信息…');
    assert.match(panel().textContent, /2021.*手填地点/);
    await act(async () => calls[0].resolve({
      ...withoutExif, camera: 'FUJIFILM X-T5', lens: 'XF35mm F1.4 R', focalLengthMm: 35,
      focalLength35mm: 53, aperture: 1.4, exposureSeconds: 1 / 250, iso: 800,
      exposureCompensationEv: 0, exposureMode: 'manual', meteringMode: 'pattern',
      whiteBalance: 'auto', flashFired: false, fileFormat: 'JPEG', fileSizeBytes: 4_210_000,
    }));
    const metrics = panel().querySelector('.photo-review-metrics');
    assert.deepEqual([...metrics.querySelectorAll('dt')].map(node => node.textContent), ['焦距', '光圈', '快门', 'ISO']);
    assert.deepEqual([...metrics.querySelectorAll('dd')].map(node => node.textContent), ['35 mm', 'f/1.4', '1/250 s', '800']);
    assert.deepEqual([...panel().querySelectorAll('h4')].map(node => node.textContent), ['时间与地点', '相机与镜头', '文件']);
    assert.match(panel().textContent, /53 mm.*portrait.jpg.*3000 × 2000 px.*JPEG.*4.21 MB.*收藏来源/);
    const details = panel().querySelector('details');
    assert.equal(details.open, false);
    assert.match(details.textContent, /0 EV.*手动.*多区测光.*自动.*未闪光/);
    await render([{ ...first, capturedAt: null, location: '' }]);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(panel().textContent, /手填地点|时间与地点/);
  });
});

test('切图和 Escape 关闭浮层，迟到结果不影响下一张', async () => {
  await scenario([photo('first'), photo('second')], async ({ container, calls, trigger, panel, toggle }) => {
    await toggle();
    await act(async () => container.querySelector('[aria-label="下一张"]').click());
    assert.equal(panel(), null);
    await toggle();
    await act(async () => calls[0].resolve({ ...withoutExif, camera: '旧相机' }));
    assert.doesNotMatch(panel().textContent, /旧相机/);
    assert.equal(panel().querySelector('[role=status]').textContent, '正在读取原图信息…');
    await act(async () => calls[1].resolve(withoutExif));
    assert.equal(panel().querySelector('.photo-review-metrics, details'), null);
    assert.deepEqual([...panel().querySelectorAll('h4')].map(node => node.textContent), ['文件']);
    assert.match(panel().textContent, /second.*PNG.*900 B/);
    await act(async () => panel().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(panel(), null);
    assert.equal(document.activeElement, trigger());
    await toggle();
    await act(async () => calls[2].resolve({ ...withoutExif, exifReadFailed: true, fileFormat: 'JPEG' }));
    assert.equal(panel().querySelector('[role=status]').textContent, '无法读取拍摄参数');
    assert.match(panel().textContent, /JPEG.*900 B/);
  });
});

test('重定位时等到新画面再读取新修订，读取失败保留图库信息', async () => {
  const first = photo('portrait', { location: '已填写地点' });
  await scenario([first], async ({ calls, trigger, panel, toggle, render }) => {
    await toggle();
    globalThis.presentedReviewPhoto = first;
    const relinked = { ...first, originalPath: '/test/relinked.webp' };
    await render([relinked]);
    assert.equal(panel(), null);
    assert.equal(trigger().disabled, true);
    delete globalThis.presentedReviewPhoto;
    await render([relinked]);
    await toggle();
    assert.deepEqual(calls.map(({ id, path }) => [id, path]), [['portrait', first.originalPath], ['portrait', relinked.originalPath]]);
    await act(async () => {
      calls[0].resolve({ ...withoutExif, camera: '旧原件相机' });
      calls[1].reject(new Error('读取失败'));
    });
    assert.equal(panel().querySelector('[role=status]').textContent, '无法读取原图信息');
    assert.match(panel().textContent, /已填写地点/);
    assert.doesNotMatch(panel().textContent, /旧原件相机/);
  });
});

test('详情读取拍摄参数，重定位时清掉旧参数，保存文字不覆盖历史区域', async () => {
  const first = photo('portrait', {
    originalUrl: '/test/portrait.jpg', location: '手填地点', tags: [], annotation: '原来的文字', project: '',
    regions: [{ id: 'old', x: 0, y: 0, width: 0.5, height: 0.5, text: '' }],
  });
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  const calls = [];
  const saved = [];
  globalThis.requestReviewMetadata = (id, path) => new Promise((resolve, reject) => calls.push({ id, path, resolve, reject }));
  const render = (current) => act(async () => root.render(h(PhotoDetail, {
    photo: current, busy: false, onClose() {}, onRelink() {}, onSave: async (patch) => saved.push(patch),
  })));
  const info = () => container.querySelector('.detail-preview .photo-info-content');
  try {
    await render({ ...first, originalAvailable: false });
    assert.equal(calls.length, 0);
    assert.match(info().textContent, /原图缺失.*手填地点/);
    await render(first);
    await act(async () => calls[0].resolve({ ...withoutExif, camera: '旧原件相机', iso: 400 }));
    assert.match(info().textContent, /ISO400.*旧原件相机/);
    await render({ ...first, originalPath: '/test/relinked.jpg', originalUrl: '/test/relinked.jpg' });
    assert.deepEqual(calls.map(({ id, path }) => [id, path]), [[first.id, first.originalPath], [first.id, '/test/relinked.jpg']]);
    assert.match(info().textContent, /正在读取原图信息/);
    assert.doesNotMatch(info().textContent, /旧原件相机|ISO400/);
    await act(async () => calls[1].reject(new Error('读取失败')));
    assert.match(info().textContent, /无法读取原图信息.*手填地点/);
    assert.doesNotMatch(container.textContent, /区域标注/);
    await act(async () => {
      const annotation = container.querySelector('textarea');
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(annotation, '更新的文字');
      annotation.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await act(async () => container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].annotation, '更新的文字');
    assert.equal(Object.hasOwn(saved[0], 'regions'), false);
  } finally {
    delete globalThis.requestReviewMetadata;
    await act(async () => root.unmount());
    container.remove();
  }
});
