import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'document' ? window.document : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };

const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: {
    contents: `export { BookCreator } from './apps/desktop/src/features/books/BookCreator';
      export { CurationWorkspace } from './apps/desktop/src/features/CurationWorkspace';`,
    resolveDir: process.cwd(),
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
  write: false, logLevel: 'silent', loader: { '.css': 'empty' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { BookCreator, CurationWorkspace } = module.exports;
const thumbnailUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const photo = (id) => ({
  id, library: 'collection', title: id, originalName: `${id}.jpg`,
  originalAvailable: true, thumbnailAvailable: true, originalUrl: thumbnailUrl, thumbnailUrl,
  width: 16, height: 12, tags: [],
});
const photos = Array.from({ length: 63 }, (_, index) => photo(`match-${index + 1}`));

async function scenario(Component, props, run) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const button = (text) => [...container.querySelectorAll('button')].find((item) => item.textContent === text);
  const click = async (target) => {
    const element = typeof target === 'string' ? button(target) : target;
    assert.ok(element, `存在操作 ${target}`);
    assert.equal(Boolean(element.disabled), false);
    await act(async () => element.click());
  };
  try {
    await act(async () => root.render(h(Component, props)));
    await run({ container, button, click });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}

test('画册全选跨页追加筛选结果，保留原选片顺序与章节，清除跨筛选', async () => {
  const created = [];
  await scenario(BookCreator, {
    photos: [...photos, photo('outside'), photo('unselected')],
    initialSelected: ['match-2', 'outside', 'match-5'],
    busy: false, onSnapshot() {}, onClose() {}, onCreate: async (input) => created.push(input),
  }, async ({ container, button, click }) => {
    await click('添加章节');
    await click(container.querySelector('[aria-label="match-5 所属章节"]'));
    await click([...container.querySelectorAll('[role="option"]')].find((option) => option.textContent === '第 2 章'));
    await click('返回选片');

    const query = container.querySelector('[aria-label="搜索可选照片"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(query, 'match');
      query.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('全选');
    assert.match(container.querySelector('.book-create-selection').textContent, /已选 64 张照片/);
    assert.equal(button('全选').disabled, true);
    await click('下一页');
    assert.equal(container.querySelectorAll('.book-photo-picker button[aria-pressed="true"]').length, 3);
    assert.deepEqual(created, []);

    await click('设置画册');
    await click('创建并排版');
    assert.deepEqual(created[0].chapters.map((chapter) => chapter.photoIds), [
      ['match-2', 'outside', ...photos.map(({ id }) => id).filter((id) => !['match-2', 'match-5'].includes(id))],
      ['match-5'],
    ]);
    await click('返回选片');
    await click('取消全选');
    assert.match(container.querySelector('.book-create-selection').textContent, /已选 0 张照片/);
    assert.equal(button('设置画册').disabled, true);
  });
});

test('取舍批量保留跨页，容量与确认门槛继续生效', async () => {
  const committed = [];
  const draft = {
    id: 'draft', groupId: 'album', groupName: '候选', capacity: 62, candidates: photos,
    activeIds: ['match-1'], pendingIds: photos.slice(1).map(({ id }) => id), failures: [],
  };
  await scenario(CurationWorkspace, {
    draft, onCancel: async () => {}, onCommit: async (ids) => committed.push(ids),
  }, async ({ container, button, click }) => {
    assert.equal(button('查看变更').disabled, true);
    await click('下一页');
    await click('全部不保留');
    assert.equal(container.querySelectorAll('.candidate-keep input:checked').length, 0);
    await click('上一页');
    assert.equal(container.querySelectorAll('.candidate-keep input:checked').length, 0);
    await click('全部保留');
    assert.equal(container.querySelectorAll('.candidate-keep input:checked').length, 60);
    await click('下一页');
    assert.equal(container.querySelectorAll('.candidate-keep input:checked').length, 3);
    assert.equal(button('查看变更').disabled, true);
    assert.deepEqual(committed, []);

    await click('全部不保留');
    await click('查看变更');
    assert.equal(button('全部保留'), undefined);
    assert.match(container.querySelector('.curation-summary').textContent, /从当前相簿废弃/);
    assert.deepEqual(committed, []);
    await click('确认并保存');
    assert.deepEqual(committed, [[]]);
  });
});
