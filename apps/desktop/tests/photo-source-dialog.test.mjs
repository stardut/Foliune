import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'DOMException']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'document' ? window.document : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  entryPoints: [resolve('apps/desktop/src/components/PhotoSourceDialog.tsx')],
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent', loader: { '.css': 'empty' },
  plugins: [{ name: 'import-ipc-boundary', setup(build) {
    build.onResolve({ filter: /\/(curation-api|photo-import-api)$/ }, ({ path }) => ({ path, namespace: 'mock-import' }));
    build.onLoad({ filter: /.*/, namespace: 'mock-import' }, () => ({ contents: 'export const { prepareImport, cancelCuration, commitCuration, prepareLinkImport, cancelLinkImport } = globalThis.photoImportMock;' }));
  } }],
});
const photo = id => ({ id, library: 'collection', title: id, originalName: `${id}.jpg`, originalPath: '/test.jpg', thumbnailPath: '/test.jpg', originalUrl: '/test.jpg', thumbnailUrl: '/test.jpg', originalAvailable: true, thumbnailAvailable: true, width: 100, height: 150, tags: [], regions: [], annotation: '', source: '', capturedAt: null, location: '', project: '', importedAt: '' });
const draft = (ids = ['new1', 'new2']) => ({ id: 'draft-1', groupId: null, groupName: '相簿', capacity: null, candidates: ids.map(photo), activeIds: [], pendingIds: ids, failures: [] });
const snapshot = { photos: [], groups: [], memberships: [] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function scenario(options, run) {
  const calls = { prepare: [], cancel: [], cancelRequest: [], commit: [], confirm: [], busy: [] };
  globalThis.photoImportMock = {
    prepareImport: async (...args) => { calls.prepare.push(args); return options.prepare ? options.prepare() : draft(); },
    prepareLinkImport: async (...args) => { calls.prepare.push(args); return options.prepare ? options.prepare() : draft(); },
    cancelCuration: async id => { calls.cancel.push(id); if (options.failCancelOnce && calls.cancel.length === 1) throw new Error('候选目录无法清理'); },
    cancelLinkImport: async id => { calls.cancelRequest.push(id); },
    commitCuration: async (...args) => { calls.commit.push(args); if (options.failCommit) throw new Error('提交测试失败'); return snapshot; },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const { PhotoSourceDialog } = module.exports;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const click = async text => {
    const button = [...container.querySelectorAll('button')].find(button => button.textContent === text);
    assert(button, `button ${text} exists`); assert.equal(button.disabled, false, `${text} enabled`);
    await act(async () => button.click());
  };
  const select = async id => {
    const button = container.querySelector(`button[aria-label="选择 ${id}"]`);
    assert(button, `photo ${id} exists`); assert.equal(button.disabled, false);
    await act(async () => button.click());
  };
  const link = async () => {
    await click('链接');
    const input = container.querySelector('input[aria-label="小红书或 Instagram 链接"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'https://www.instagram.com/p/test/');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
  };
  let unmounted = false;
  const unmount = async () => { if (!unmounted) { await act(async () => root.unmount()); unmounted = true; } };
  try {
    const content = h(PhotoSourceDialog, { photos: [photo('existing')], library: 'collection', ...options.props,
      onConfirm: result => calls.confirm.push(result), onClose() {}, onBusyChange: value => calls.busy.push(value) });
    await act(async () => root.render(options.outerForm ? h('form', { onSubmit: event => { event.preventDefault(); options.outerForm(); } }, content) : content));
    await run({ calls, click, select, link, container, unmount });
  } finally { await unmount(); container.remove(); }
}

test('候选默认不选，合计上限包含已有照片，仅提交用户顺序选择的新图', async () => {
  await scenario({ props: { selectedIds: ['existing'], maxSelection: 3 }, prepare: () => ({ ...draft(['new1', 'new2', 'new3']), candidates: ['new3', 'new2', 'new1'].map(photo) }) }, async ({ calls, click, select, container }) => {
    await click('本地'); await click('选择本地照片');
    assert.equal(container.querySelectorAll('.photo-picker-item.is-selected').length, 0);
    assert.equal([...container.querySelectorAll('button')].find(b => b.textContent === '确认导入').disabled, true);
    assert.deepEqual([...container.querySelectorAll('.photo-picker-item')].map(b => b.getAttribute('aria-label')), ['选择 new1', '选择 new2', '选择 new3']);
    await select('new2'); await select('new1');
    assert.equal(container.querySelector('button[aria-label="选择 new3"]').disabled, true);
    await click('确认导入');
    assert.deepEqual(calls.commit, [['draft-1', ['new2', 'new1']]]);
    assert.deepEqual(calls.confirm, [{ photoIds: ['existing', 'new2', 'new1'], snapshot }]);
  });
});

test('链接准备中切换来源与卸载后迟到的本地draft均取消，不提交', async () => {
  const pending = deferred();
  await scenario({ prepare: () => pending.promise }, async ({ calls, click, link, container, unmount }) => {
    await link(); await click('获取图片'); await click('本地');
    assert.equal(calls.cancelRequest.length, 1);
    await act(async () => pending.resolve(draft()));
    assert.deepEqual(calls.cancel, ['draft-1']);
    assert.equal(container.querySelectorAll('.photo-picker-item').length, 0);
    assert.equal(calls.commit.length, 0);
    await unmount(); assert.equal(calls.busy.at(-1), false);
  });
  const local = deferred();
  await scenario({ props: { allowLibrary: false }, prepare: () => local.promise }, async ({ calls, click, unmount }) => {
    await click('选择本地照片'); await unmount();
    await act(async () => local.resolve(draft()));
    assert.deepEqual(calls.cancel, ['draft-1']); assert.equal(calls.confirm.length, 0);
  });
});

test('提交失败清空已消费会话，显示重准备错误，不能重复提交旧draft', async () => {
  await scenario({ failCommit: true, props: { allowLibrary: false } }, async ({ calls, click, select, container }) => {
    await click('选择本地照片'); await select('new1'); await click('确认导入');
    assert.match(container.textContent, /提交测试失败.*重新准备/);
    assert.equal([...container.querySelectorAll('button')].find(b => b.textContent === '确认导入').disabled, true);
    assert.equal(calls.commit.length, 1); assert.equal(calls.confirm.length, 0);
    await click('选择本地照片'); assert.equal(calls.prepare.length, 2);
  });
});

test('满额取舍仅含所选新候选；取消取舍清理会话，不改变图库', async () => {
  await scenario({ props: { allowLibrary: false }, prepare: () => ({ ...draft(), capacity: 2, activeIds: ['old1', 'old2'], candidates: ['old1', 'old2', 'new1', 'new2'].map(photo) }) }, async ({ calls, click, select, container }) => {
    await click('选择本地照片'); await select('new1'); await click('确认导入');
    assert.equal(container.querySelectorAll('.candidate').length, 3);
    assert.equal(container.querySelectorAll('.candidate input[type="checkbox"]').length, 6);
    assert(!container.textContent.includes('new2'));
    await click('取消全部变更');
    assert.deepEqual(calls.cancel, ['draft-1']); assert.equal(calls.commit.length, 0);
    assert(container.textContent.includes('选择本地照片'));
  });
});

test('链接Enter阻止外层表单提交；候选失败项直接显示', async () => {
  let submitted = 0;
  await scenario({ outerForm: () => submitted++, prepare: () => ({ ...draft(), failures: [{ path: 'bad.jpg', message: '无法解码' }] }) }, async ({ calls, link, container }) => {
    const input = await link();
    assert.equal(container.querySelectorAll('form').length, 1);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => input.dispatchEvent(enter));
    assert.equal(enter.defaultPrevented, true); assert.equal(submitted, 0); assert.equal(calls.prepare.length, 1);
    assert.match(container.textContent, /1 张照片未能读取.*bad.jpg · 无法解码/);
  });
});


test('取舍取消清理失败会显示真实错误，重试前保留会话所有权', async () => {
  await scenario({ failCancelOnce: true, props: { allowLibrary: false }, prepare: () => ({ ...draft(), capacity: 1, activeIds: ['old1'], candidates: ['old1', 'new1', 'new2'].map(photo) }) }, async ({ calls, click, select, container }) => {
    await click('选择本地照片'); await select('new1'); await click('确认导入');
    await click('取消全部变更');
    assert.match(container.textContent, /取消失败：候选目录无法清理/);
    assert.equal(container.querySelectorAll('.candidate').length, 2);
    await click('取消全部变更');
    assert.deepEqual(calls.cancel, ['draft-1', 'draft-1']);
    assert.equal(calls.commit.length, 0);
  });
});
