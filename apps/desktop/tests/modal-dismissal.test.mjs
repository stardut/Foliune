import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Event', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act, StrictMode, useState } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: {
    contents: `export { Modal } from './src/components/ui'; export { BookReader } from './src/features/books/BookReader'; export { currentModalHost } from './src/lib/modal-stack';`,
    resolveDir: resolve('apps/desktop'),
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false,
  plugins: [{ name: 'reader-page-boundary', setup(build) {
    build.onResolve({ filter: /\/BookPageView$/ }, ({ path }) => ({ path, namespace: 'reader-page-boundary' }));
    build.onLoad({ filter: /.*/, namespace: 'reader-page-boundary' }, () => ({ contents: 'export const BookPageView = () => null;' }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { Modal, BookReader, currentModalHost } = module.exports;

async function scenario(render, run) {
  const trigger = document.body.appendChild(document.createElement('button'));
  trigger.textContent = '打开'; trigger.focus();
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(StrictMode, null, render())));
    await run({ container, root, trigger });
  } finally {
    await act(async () => root.unmount());
    assert.equal(currentModalHost(), document.body);
    container.remove(); trigger.remove();
  }
}

async function implicitDismiss(dialog, target = dialog) {
  const cancel = new Event('cancel', { cancelable: true });
  await act(async () => {
    dialog.click();
    target.click();
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    dialog.dispatchEvent(cancel);
  });
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(dialog.open, true);
  assert.equal(dialog.isConnected, true);
}

test('共用弹窗保留输入，遮罩、内容空白和 Escape 不关闭，明确取消后恢复焦点', async () => {
  const closed = [];
  function Host() {
    const [open, setOpen] = useState(true);
    const close = () => { closed.push('close'); setOpen(false); };
    return open && h(Modal, { title: '编辑', onClose: close },
      h('div', { 'data-content': '' }, h('input', { defaultValue: '原内容', 'aria-label': '内容' })),
      h('button', { onClick: close }, '取消'));
  }
  await scenario(() => h(Host), async ({ container, trigger }) => {
    const dialog = container.querySelector('dialog');
    const field = dialog.querySelector('input');
    field.value = '未保存内容';
    await implicitDismiss(dialog, dialog.querySelector('[data-content]'));
    assert.equal(field.value, '未保存内容');
    assert.deepEqual(closed, []);
    await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === '取消').click());
    assert.equal(container.querySelector('dialog'), null);
    assert.deepEqual(closed, ['close']);
    assert.equal(document.activeElement, trigger);
  });
});

test('共用弹窗关闭按钮沿用忙碌禁用，恢复后可关闭；没有关闭回调仍阻止原生取消', async () => {
  const closed = [];
  await scenario(() => h(Modal, { title: '保存', onClose: () => closed.push('close'), closeDisabled: true }, '保存中'), async ({ container, root }) => {
    let dialog = container.querySelector('dialog');
    await implicitDismiss(dialog);
    const close = dialog.querySelector('[aria-label="关闭"]');
    assert.equal(close.disabled, true);
    await act(async () => close.click());
    assert.deepEqual(closed, []);
    await act(async () => root.render(h(Modal, { title: '保存', onClose: () => closed.push('close') }, '已保存')));
    dialog = container.querySelector('dialog');
    await act(async () => dialog.querySelector('[aria-label="关闭"]').click());
    assert.deepEqual(closed, ['close']);
    await act(async () => root.render(h(Modal, { title: '处理中' }, '请稍候')));
    dialog = container.querySelector('dialog');
    assert.equal(dialog.querySelector('[aria-label="关闭"]'), null);
    await implicitDismiss(dialog);
  });
});

test('画册阅读空白和 Escape 不关闭，章节下拉可收起，明确关闭仍卸载并恢复焦点', async () => {
  const version = { pages: [{ id: 'page', chapterId: 'chapter' }], chapters: [{ id: 'chapter', title: '第一章' }], pageWidth: 100, pageHeight: 100 };
  function Host() {
    const [open, setOpen] = useState(true);
    return open && h(BookReader, { version, photos: [], title: '旅行', initialPageIndex: 0, onClose: () => setOpen(false) });
  }
  await scenario(() => h(Host), async ({ container, trigger }) => {
    const dialog = container.querySelector('dialog');
    await implicitDismiss(dialog, dialog.querySelector('.book-reader-stage'));
    const chapter = dialog.querySelector('[role="combobox"]');
    await act(async () => chapter.click());
    assert(dialog.querySelector('[role="listbox"]'));
    await act(async () => chapter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.equal(dialog.querySelector('[role="listbox"]'), null);
    assert.equal(document.activeElement, chapter);
    assert.equal(dialog.open, true);
    await act(async () => dialog.querySelector('[aria-label="关闭阅读"]').click());
    assert.equal(container.querySelector('dialog'), null);
    assert.equal(document.activeElement, trigger);
  });
});
