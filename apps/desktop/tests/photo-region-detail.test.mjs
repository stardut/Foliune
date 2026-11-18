import './fixtures/chinese-interface.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: {
    contents: `export { PhotoDetail } from './src/features/PhotoDetail';
      export { ToastProvider } from './src/components/ToastProvider';`,
    resolveDir: resolve('apps/desktop'),
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, loader: { '.css': 'empty' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { PhotoDetail, ToastProvider } = module.exports;

async function searchRegion(input, query) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, query);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const enter = (input) => act(async () => input.dispatchEvent(
  new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
));

test('有 GPS 的照片可以填写和清除手选地区，保存只提交地区及其原基准', async () => {
  const photo = {
    id: 'gps-photo', title: '摄影', originalName: 'original.jpg', originalAvailable: false, originalPath: '', tags: [],
    annotation: '', source: '', location: '39.916345, 116.397155', project: '', capturedAt: null,
  };
  const regionId = 'CHN:city-330100';
  const saves = [];
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  const click = (node) => act(async () => node.click());
  const render = (photo) => act(async () => root.render(h(ToastProvider, null, h(PhotoDetail, {
    key: photo.locationRegionId ?? '', photo, busy: false, onRelink: async () => {}, onClose: () => {},
    onSave: async (patch, expected) => saves.push([patch, expected]),
  }))));
  const save = () => click(container.querySelector('button[type="submit"]'));
  const location = () => [...container.querySelectorAll('label')].find((label) => label.textContent === '地点').querySelector('input');
  try {
    await render(photo);
    const region = container.querySelector('[role="combobox"]');
    assert.equal(region.readOnly, false);
    await click(region);
    await searchRegion(region, '天津市');
    await enter(region);
    assert.match(region.value, /天津市/);

    await click(region);
    await searchRegion(region, '浙江 杭州');
    assert.equal(container.querySelector('[role="option"]').textContent, '杭州市浙江省');
    await enter(region);
    assert.equal(region.value, '杭州市 · 浙江省');

    assert.equal(location().value, photo.location);
    await save();
    assert.deepEqual(saves, [[{ locationRegionId: regionId }, { locationRegionId: '' }]]);

    await render({ ...photo, locationRegionId: regionId });
    await click(container.querySelector('[aria-label="清除拍摄地区"]'));
    assert.equal(container.querySelector('[role="combobox"]').value, '');
    assert.equal(location().value, photo.location);
    await save();
    assert.deepEqual(saves[1], [{ locationRegionId: '' }, { locationRegionId: regionId }]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
