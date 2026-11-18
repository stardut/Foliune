import './fixtures/chinese-interface.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { inputOf } from '../src/features/planning/plan-content.ts';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['document', 'HTMLElement', 'HTMLInputElement', 'Event', 'KeyboardEvent', 'ResizeObserver']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
}
globalThis.window = window;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.isTauri = true;

const { createElement: h, act, StrictMode } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: {
    contents: `export { PhotoDetail } from './src/features/PhotoDetail';
      export { PlanDetail } from './src/features/planning/PlanDetail';
      export { ToastProvider } from './src/components/ToastProvider';`,
    resolveDir: resolve('apps/desktop'),
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, loader: { '.css': 'empty' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { PhotoDetail, PlanDetail, ToastProvider } = module.exports;

const noop = () => {};
const activeDialog = () => [...document.querySelectorAll('dialog[open]')].at(-1);
const button = (container, label) => [...container.querySelectorAll('button')].find((node) => node.textContent === label);
const click = (node) => act(async () => node.click());
const keydown = (node, key) => act(async () => node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));

async function enter(input, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function scenario(element, check) {
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(StrictMode, null, h(ToastProvider, null, element))));
    await check(container);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    assert.equal(activeDialog(), undefined);
  }
}

test('旧策划仍能读取，保存和保存并返回时要求补选有效执行日期', async () => {
  const plan = { ...inputOf(), id: 'legacy', title: '日出', shootDate: '日出前集合', createdAt: '', updatedAt: '' };
  const saves = [];
  let closed = false;
  window.__TAURI_INTERNALS__ = { invoke: async (command, { id, input }) => {
    assert.equal(command, 'plans_save');
    assert.equal(id, plan.id);
    saves.push(input);
    return { ...plan, ...input };
  } };
  await scenario(h(PlanDetail, {
    plan, snapshot: { photos: [], groups: [], memberships: [] }, photos: [], onSnapshot: noop,
    onClose: () => { closed = true; }, onSaved: noop, onDeleted: noop, onDirtyChange: noop, onBusyChange: noop,
  }), async (container) => {
    assert.match(container.querySelector('.plan-meta').textContent, /执行日期未设置/);
    await click(button(container, '编辑'));
    await enter(container.querySelector('[name="title"]'), '改后的日出');
    const trigger = container.querySelector('[name="executionDate"]');
    const expectDateError = async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      assert.equal(document.activeElement, trigger);
      assert.equal(trigger.getAttribute('aria-invalid'), 'true');
      assert.equal(saves.length, 0);
    };
    await click(button(container, '保存策划'));
    await expectDateError();
    await click(container.querySelector('[aria-label="返回策划列表"]'));
    await click(button(activeDialog(), '保存并返回'));
    await expectDateError();

    await click(trigger);
    const dialog = activeDialog();
    const input = dialog.querySelector('input');
    assert.equal(document.activeElement, input);
    await enter(input, '1900-02-29');
    await click(button(dialog, '确定'));
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(activeDialog(), dialog);
    await enter(input, '2000-02-29');
    const year = dialog.querySelector('[role="spinbutton"][aria-label="年"]');
    assert.ok(year.querySelectorAll('li').length <= 14);
    await keydown(year, 'ArrowUp');
    assert.equal(input.value, '2001-02-28');
    await keydown(year, 'Home');
    assert.equal(input.value, '0001-02-28');
    await enter(input, '9999-12-31');
    await click(button(dialog, '确定'));
    assert.equal(document.activeElement, trigger);
    assert.equal(saves.length, 0);
    await click(container.querySelector('[aria-label="返回策划列表"]'));
    await click(button(activeDialog(), '保存并返回'));
    assert.equal(closed, true);
    assert.equal(saves.length, 1);
    assert.equal(saves[0].executionDate, '9999-12-31');
    assert.equal(saves[0].shootDate, plan.shootDate);
  });
});

test('照片日期弹窗独立确认，保留秒、未改原值和明确清除语义', async () => {
  const photo = {
    id: 'photo', title: '摄影', originalName: 'original.jpg', originalAvailable: false, originalPath: '', tags: [],
    annotation: '', source: '', location: '', project: '', capturedAt: '2026-08-06T08:09:37.240+08:00',
  };
  const saves = [];
  await scenario(h(PhotoDetail, { photo, onClose: noop, onRelink: noop, onSave: async (patch) => { saves.push(patch); } }), async (container) => {
    const detail = activeDialog();
    const trigger = detail.querySelector('.date-picker-trigger');
    await click(trigger);
    const dialog = activeDialog();
    const input = dialog.querySelector('input');
    assert.match(input.value, /:37$/);
    assert.equal(dialog.querySelectorAll('[role="spinbutton"]').length, 6);
    await click(button(dialog, '确定'));
    assert.equal(activeDialog(), detail);
    assert.equal(document.activeElement, trigger);
    assert.equal(saves.length, 0);
    await click(button(detail, '保存'));
    assert.equal('capturedAt' in saves[0], false);

    await click(trigger);
    const editDialog = activeDialog();
    const editInput = editDialog.querySelector('input');
    await enter(editInput, '2028-02-29 22:04:51');
    await keydown(editInput, 'Escape');
    assert.equal(activeDialog(), editDialog);
    await click(button(editDialog, '取消'));
    assert.equal(activeDialog(), detail);
    assert.match(trigger.textContent, /:37$/);

    await click(trigger);
    await enter(activeDialog().querySelector('input'), '2028-02-29 22:04:51');
    await click(button(activeDialog(), '确定'));
    await click(button(detail, '保存'));
    assert.equal(saves[1].capturedAt, new Date('2028-02-29T22:04:51').toISOString());
    await click(trigger);
    await click(button(activeDialog(), '清除'));
    await click(button(detail, '保存'));
    assert.equal(saves[2].capturedAt, null);
    assert.equal(container.querySelectorAll('dialog[open]').length, 1);
  });
});
