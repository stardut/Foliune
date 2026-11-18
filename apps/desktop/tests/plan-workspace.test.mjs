import './fixtures/chinese-interface.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { inputOf } from '../src/features/planning/plan-content.ts';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'KeyboardEvent', 'ResizeObserver']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
}
globalThis.window = window;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.isTauri = true;

const { createElement: h, act, StrictMode } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: {
    contents: `export { PlanningWorkspace } from './src/features/planning/PlanningWorkspace';
      export { ToastProvider } from './src/components/ToastProvider';`,
    resolveDir: resolve('apps/desktop'),
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, loader: { '.css': 'empty' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { PlanningWorkspace, ToastProvider } = module.exports;

const initial = {
  ...inputOf(), id: 'plan-1', title: '晨雾', executionDate: '2026-11-20', visualDirection: '林间散射光', styling: '灰色大衣',
  createdAt: '2026-11-11T03:00:00Z', updatedAt: '2026-11-11T03:00:00Z',
};
const photo = (id, title) => ({
  id, library: 'collection', title, originalName: `${id}.jpg`, originalPath: '/test.jpg', thumbnailPath: '/test.jpg',
  originalUrl: '/test.jpg', thumbnailUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  originalAvailable: true, thumbnailAvailable: true, width: 100, height: 150, tags: [],
});
const photos = [photo('one', '山谷'), photo('two', '树林'), photo('three', '雾原')];
const snapshot = { photos, groups: [], memberships: [] };
const conflict = '记录已被修改，请重新读取后再保存';
const noop = () => {};

function button(container, label) {
  const item = [...container.querySelectorAll('button')].find((node) => node.textContent === label || node.getAttribute('aria-label') === label);
  assert.ok(item, `找不到按钮 ${label}`);
  return item;
}
const click = (item) => act(async () => { assert.equal(item.disabled, false); item.focus(); item.click(); });
const dialog = () => document.querySelector('dialog[open]');
const enter = (field, value) => act(async () => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
});

async function scenario(check) {
  let record = structuredClone(initial);
  let callbackId = 0;
  const callbacks = new Map();
  const saves = [];
  const deletes = [];
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_, id) => callbacks.delete(id) };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' } },
    transformCallback: (callback) => { callbacks.set(++callbackId, callback); return callbackId; },
    invoke: async (command, args) => {
      if (command === 'plugin:event|listen') {
        assert.equal(args.event, 'tauri://focus');
        assert.deepEqual(args.target, { kind: 'Window', label: 'main' });
        return args.handler;
      }
      if (command === 'plugin:event|unlisten') return;
      if (command === 'plans_list') return record ? [structuredClone(record)] : [];
      if (command === 'plans_save') {
        saves.push(args);
        assert.equal(args.id, record.id);
        if (args.expectedRevision !== record.updatedAt) throw conflict;
        record = { ...record, ...args.input, updatedAt: '2026-11-13T03:00:00Z' };
        return structuredClone(record);
      }
      if (command === 'plans_delete') {
        deletes.push(args);
        if (!record) throw '拍摄策划不存在';
        assert.equal(args.id, record.id);
        if (args.expectedRevision !== record.updatedAt) throw conflict;
        record = null;
        return { photos: [], groups: [], memberships: [] };
      }
      assert.fail(`unexpected IPC ${command}`);
    },
  };
  const focusWindow = () => act(async () => { for (const callback of callbacks.values()) callback({ event: 'tauri://focus' }); });
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  try {
    await act(async () => root.render(h(StrictMode, null, h(ToastProvider, null, h(PlanningWorkspace, {
      snapshot, photos, onSnapshot: noop, onDirtyChange: noop, onBusyChange: noop,
    })))));
    await click(container.querySelector('.plan-list-item'));
    await check({ container, saves, deletes, focusWindow, record: () => record, replace: (next) => { record = next; } });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    assert.equal(dialog(), null);
    assert.equal(callbacks.size, 0);
  }
}

async function openPicker(section, label) {
  await click(button(section, label));
  const modal = dialog();
  await click(button(modal, '收藏'));
  await click(modal.querySelector('.photo-picker-album'));
  return modal;
}

test('全案参考支持批量选择、选片取消、键盘排序和保存后阅读', async () => {
  await scenario(async ({ container, saves }) => {
    assert.equal(container.querySelector('.plan-overall-references'), null);
    await click(button(container, '编辑'));
    const section = container.querySelector('[aria-label="全案参考图"]');
    assert.equal(section.previousElementSibling.getAttribute('aria-label'), '整体视觉');
    assert.equal(section.nextElementSibling.getAttribute('aria-label'), '整组准备');
    const choose = await openPicker(section, '添加参考图');
    await click(button(choose, '选择 树林'));
    await click(button(choose, '选择 山谷'));
    await click(button(choose, '取消'));
    assert.equal(dialog(), null);
    assert.equal(section.querySelectorAll('.plan-photo').length, 0);
    assert.equal(button(container, '保存策划').disabled, true);

    const select = await openPicker(section, '添加参考图');
    await click(button(select, '选择 树林'));
    await click(button(select, '选择 山谷'));
    await click(button(select, '选择 雾原'));
    await click(button(select, '确认选择'));
    assert.equal(section.querySelectorAll('.plan-photo').length, 3);
    const intent = section.querySelector('textarea[aria-label="参考图 2 的参考意图"]');
    await enter(intent, '借鉴山脊线条');
    const figure = section.querySelectorAll('figure')[1];
    await act(async () => figure.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true })));
    await click(button(section, '移除参考图 3'));
    await click(button(container, '保存策划'));
    assert.equal(saves.length, 1);
    assert.equal(saves[0].expectedRevision, initial.updatedAt);
    assert.deepEqual(saves[0].input.references.map(({ photoId, intent }) => [photoId, intent]), [['one', '借鉴山脊线条'], ['two', '']]);
    assert.equal(new Set(saves[0].input.references.map(({ id }) => id)).size, 2);
    assert.equal(container.querySelector('.plan-overall-references figcaption').textContent, '借鉴山脊线条');
    assert.equal(container.querySelector('.plan-overall-references button'), null);
    await click(button(container, '返回策划列表'));
    await click(container.querySelector('.plan-list-item'));
    assert.equal(container.querySelectorAll('.plan-overall-references figure').length, 2);
  });
});

test('焦点回归刷新阅读，编辑时保留草稿和原修订，冲突后可放弃并读取最新内容', async () => {
  await scenario(async ({ container, saves, focusWindow, record, replace }) => {
    const current = '2026-11-11T04:00:00Z';
    replace({ ...record(), title: 'CLI 首次更新', updatedAt: current });
    await focusWindow();
    assert.equal(container.querySelector('h1').textContent, 'CLI 首次更新');
    await click(button(container, '编辑'));
    const title = container.querySelector('input[name="title"]');
    await enter(title, '本地草稿');

    const latest = '2026-11-11T05:00:00Z';
    replace({ ...record(), title: 'CLI 后续更新', updatedAt: latest });
    await focusWindow();
    assert.equal(title.value, '本地草稿');
    await click(button(container, '保存策划'));
    assert.equal(saves[0].expectedRevision, current);
    assert.equal(record().title, 'CLI 后续更新');
    assert.equal(title.value, '本地草稿');
    assert.equal(container.querySelector('.plan-error').textContent, conflict);

    await click(button(container, '取消'));
    await click(button(dialog(), '放弃修改'));
    assert.equal(container.querySelector('h1').textContent, 'CLI 后续更新');
    await click(button(container, '编辑'));
    await enter(container.querySelector('input[name="title"]'), '基于最新版本编辑');
    await click(button(container, '保存策划'));
    assert.equal(saves[1].expectedRevision, latest);
    assert.equal(container.querySelector('h1').textContent, '基于最新版本编辑');
  });
});

test('删除确认固定标题和版本，冲突后显示新内容并允许重新确认', async () => {
  await scenario(async ({ container, deletes, focusWindow, record, replace }) => {
    await click(button(container, '删除策划'));
    const latest = '2026-11-11T04:00:00Z';
    replace({ ...record(), title: 'CLI 改写标题', updatedAt: latest });
    await focusWindow();
    assert.match(dialog().textContent, /晨雾/);
    await click(button(dialog(), '删除策划'));
    assert.equal(deletes[0].expectedRevision, initial.updatedAt);
    assert.equal(record().title, 'CLI 改写标题');
    assert.equal(container.querySelector('h1').textContent, 'CLI 改写标题');
    assert.equal(container.querySelector('.plan-error').textContent, conflict);

    await click(button(container, '删除策划'));
    assert.match(dialog().textContent, /CLI 改写标题/);
    await click(button(dialog(), '删除策划'));
    assert.equal(deletes[1].expectedRevision, latest);
    assert.equal(record(), null);
    assert.match(container.textContent, /写下下一次拍摄的想法/);
  });
});

for (const dirty of [false, true]) {
  test(`外部删除后${dirty ? '保护本地草稿直到显式放弃' : '停用详情操作并可返回列表'}`, async () => {
    await scenario(async ({ container, saves, focusWindow, replace }) => {
      if (dirty) {
        await click(button(container, '编辑'));
        await enter(container.querySelector('input[name="title"]'), '保留这份草稿');
      }
      replace(null);
      await focusWindow();
      assert.match(container.textContent, /拍摄策划已删除/);
      if (dirty) {
        assert.equal(container.querySelector('input[name="title"]').value, '保留这份草稿');
        assert.equal(button(container, '保存策划').disabled, true);
        assert.equal(button(container, '导出长图').disabled, false);
        await click(button(container, '返回策划列表'));
        assert.doesNotMatch(dialog().textContent, /保存并返回/);
        await click(button(dialog(), '继续编辑'));
        assert.equal(container.querySelector('input[name="title"]').value, '保留这份草稿');
        await click(button(container, '取消'));
        await click(button(dialog(), '放弃修改'));
      }
      assert.equal(saves.length, 0);
      await click(button(container, '返回策划列表'));
      assert.equal(container.querySelector('.plan-list-item'), null);
    });
  });
}
