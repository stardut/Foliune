import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Element', 'Node', 'Event', 'MouseEvent', 'DOMException']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'document' ? window.document : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Keep the browser contracts strict while letting real React schedule DOM
// mutation, layout effects, passive cleanup, portals, and external-store updates.
// happy-dom does not implement the platform top layer.
const openPopovers = new WeakSet();
const calls = [];
const nativeMatches = HTMLElement.prototype.matches;
HTMLElement.prototype.matches = function (selector) {
  return selector === ':popover-open' ? openPopovers.has(this) : nativeMatches.call(this, selector);
};
HTMLElement.prototype.showPopover = function () {
  calls.push({ connected: this.isConnected, host: this.parentElement?.tagName });
  if (!this.isConnected) throw new DOMException('Popover is not connected to a document', 'InvalidStateError');
  openPopovers.add(this);
};
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

const { createElement: h, act, useState } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: { contents: `export { ToastProvider, useToast } from './src/components/ToastProvider'; export { Modal } from './src/components/ui';`, resolveDir: resolve('apps/desktop'), sourcefile: 'toast-regression.tsx', loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent', loader: { '.css': 'empty' },
});

async function scenario({ modal = true, nested = false, close = true } = {}) {
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const { ToastProvider, useToast, Modal } = module.exports;
  const container = document.createElement('div');
  document.body.append(container);
  const errors = [];
  const root = createRoot(container, { onUncaughtError: error => errors.push(error) });
  function Flow() {
    const [open, setOpen] = useState(modal);
    const toast = useToast();
    const confirm = async () => { await Promise.resolve(); if (close) setOpen(false); toast({ title: '已保存' }); };
    return h('main', { 'data-editor': '' },
      h('h1', null, '当前画册'),
      !modal && h('button', { onClick: confirm }, '保存'),
      nested && h(Modal, { title: '外层编辑', onClose() {} }, h('p', null, '仍在编辑')),
      open && h(Modal, { title: '确认保存', onClose() {} }, h('button', { onClick: confirm }, '保存')),
    );
  }
  const before = calls.length;
  try {
    await act(async () => root.render(h(ToastProvider, null, h(Flow))));
    const button = [...container.querySelectorAll('button')].find(button => button.textContent === '保存');
    assert(button, 'real confirmation button is mounted');
    await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(errors.length, 0, `React must keep the editor mounted: ${errors.map(error => `${error.name}: ${error.message}`).join(', ')}`);
    assert(container.querySelector('[data-editor]'), 'editor survives the save confirmation');
    const viewport = document.querySelector('.toast-viewport');
    assert(viewport?.isConnected, 'feedback remains connected after modal cleanup');
    assert(viewport.textContent.includes('已保存'), 'saved feedback remains visible');
    assert(viewport.matches(':popover-open'), 'connected toast enters the top layer');
    assert.equal(viewport.parentElement.tagName, nested || (modal && !close) ? 'DIALOG' : 'BODY');
    assert(calls.slice(before).every(call => call.connected), 'never call showPopover on a detached portal');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}

test('保存时关闭真实Modal，同批成功反馈不会卸载编辑器', async () => scenario());
test('内层确认关闭后，反馈迁入仍打开的外层Modal', async () => scenario({ nested: true }));
test('普通保存使用body宿主，未关闭的Modal内保存使用dialog宿主', async () => {
  await scenario({ modal: false });
  await scenario({ close: false });
});

test('拼图先关闭应用弹窗再请求系统目录，取消及失败保留导出设置', async () => {
  const bundle = await build({
    stdin: { contents: `export { CollageWorkspace } from './src/features/collage/CollageWorkspace'; export { currentModalHost } from './src/lib/modal-stack';`, resolveDir: resolve('apps/desktop') },
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent', loader: { '.css': 'empty' },
    plugins: [{ name: 'collage-boundaries', setup(build) {
      build.onResolve({ filter: /\/(PhotoPicker|CollagePreview|CollageSequence|CollageTools|collage-api|export-directory)$/ }, ({ path }) => ({ path, namespace: 'collage-boundary' }));
      build.onLoad({ filter: /.*/, namespace: 'collage-boundary' }, ({ path }) => {
        const name = path.split('/').at(-1);
        if (name === 'export-directory') return { contents: 'export const selectExportDirectory = () => globalThis.collageExportFixture.pick();' };
        if (name === 'collage-api') return { contents: 'export const exportCollagePng = (directory, input) => globalThis.collageExportFixture.export(directory, input);' };
        return { contents: `export const ${name} = () => null;` };
      });
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const { CollageWorkspace, currentModalHost } = module.exports;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const photos = ['a', 'b'].map(id => ({ id, library: 'collection', width: 400, height: 600, originalAvailable: true }));
  const exported = [];
  let pickDirectory;
  let exportPng;
  globalThis.collageExportFixture = {
    pick() {
      assert.equal(container.querySelector('dialog'), null);
      assert.equal(currentModalHost(), document.body);
      assert.equal(container.querySelector('.collage-workspace').getAttribute('aria-busy'), 'true');
      return new Promise(resolve => { pickDirectory = resolve; });
    },
    export(directory, input) {
      assert.equal(directory, '/exports');
      assert.equal(input.title, '夜景');
      assert.equal(Math.max(input.width, input.height), 200);
      return new Promise((resolve, reject) => { exportPng = { resolve, reject }; });
    },
  };
  const submit = () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const fields = () => [...container.querySelectorAll('dialog input')];
  const change = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  try {
    await act(async () => root.render(h(CollageWorkspace, { snapshot: { photos }, library: 'collection', initialPhotoIds: ['a', 'b'], onExit() {}, onRelink() {}, onExported: path => exported.push(path) })));
    await act(async () => container.querySelector('.collage-header-actions > .button').click());
    await act(async () => { const [title, longEdge] = fields(); change(title, ' 夜景 '); change(longEdge, '200'); });
    await act(async () => submit());
    await act(async () => pickDirectory(null));
    assert.equal(exportPng, undefined);
    assert.deepEqual(fields().map(input => input.value), [' 夜景 ', '200']);
    await act(async () => submit());
    await act(async () => pickDirectory('/exports'));
    assert.equal(container.querySelector('dialog[open] button[type="submit"]').textContent, '正在导出…');
    await act(async () => exportPng.reject(new Error('写入失败')));
    assert.equal(container.querySelector('dialog [role="alert"]').textContent, '写入失败');
    assert.deepEqual(fields().map(input => input.value), [' 夜景 ', '200']);
    await act(async () => submit());
    await act(async () => pickDirectory('/exports'));
    await act(async () => exportPng.resolve('/exports/夜景.png'));
    assert.deepEqual(exported, ['/exports/夜景.png']);
  } finally {
    delete globalThis.collageExportFixture;
    await act(async () => root.unmount());
    container.remove();
  }
});
