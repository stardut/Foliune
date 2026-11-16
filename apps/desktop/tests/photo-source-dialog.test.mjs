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
  stdin: { resolveDir: resolve('apps/desktop/src/components'), contents: "export { PhotoSourceDialog } from './PhotoSourceDialog'; export { PhotoPicker } from './PhotoPicker';" },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent', loader: { '.css': 'empty' },
  plugins: [{ name: 'import-ipc-boundary', setup(build) {
    build.onResolve({ filter: /\/(curation-api|photo-import-api)$/ }, ({ path }) => ({ path, namespace: 'mock-import' }));
    build.onLoad({ filter: /.*/, namespace: 'mock-import' }, () => ({ contents: 'export const { chooseLocalPhotoSources, prepareImportFiles, cancelCuration, commitCuration, prepareLinkImport, cancelLinkImport } = globalThis.photoImportMock;' }));
    build.onResolve({ filter: /\/ToastProvider$/ }, ({ path }) => ({ path, namespace: 'mock-toast' }));
    build.onLoad({ filter: /.*/, namespace: 'mock-toast' }, () => ({ contents: 'export const useToast = () => globalThis.photoImportMock.toast;' }));
  } }],
});
const thumbnailUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const photo = id => ({ id, library: 'collection', title: id, originalName: `${id}.jpg`, originalPath: '/test.jpg', thumbnailPath: '/test.jpg', originalUrl: '/test.jpg', thumbnailUrl, originalAvailable: true, thumbnailAvailable: true, width: 100, height: 150, tags: [], regions: [], annotation: '', source: '', capturedAt: null, location: '', project: '', importedAt: '' });
const draft = (ids = ['new1', 'new2']) => ({ id: 'draft-1', groupId: null, groupName: '相簿', capacity: null, candidates: ids.map(photo), activeIds: [], pendingIds: ids, failures: [] });
const makeSnapshot = photos => {
  const groups = ['collection', 'work'].map(library => ({ id: `${library}-album`, library, name: `${library}-album`, description: '', capacity: null, createdAt: '' }));
  return { photos, groups, memberships: photos.map((item, position) => ({ groupId: `${item.library}-album`, photoId: item.id, status: 'active', position })) };
};
const snapshot = makeSnapshot([]);
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };

async function scenario(options, run) {
  const calls = { choose: 0, prepare: [], cancel: [], cancelRequest: [], commit: [], confirm: [], busy: [], toast: [] };
  globalThis.photoImportMock = {
    chooseLocalPhotoSources: async () => { calls.choose++; return options.choose ? options.choose() : ['/photos/sample.jpg']; },
    prepareImportFiles: async (...args) => { calls.prepare.push(args); return options.prepare ? options.prepare() : draft(); },
    prepareLinkImport: async (...args) => { calls.prepare.push(args); return options.prepare ? options.prepare() : draft(); },
    cancelCuration: async id => { calls.cancel.push(id); if (options.failCancelOnce && calls.cancel.length === 1) throw new Error('候选目录无法清理'); },
    cancelLinkImport: async id => { calls.cancelRequest.push(id); },
    commitCuration: async (...args) => { calls.commit.push(args); if (options.failCommit) throw new Error('提交测试失败'); return snapshot; },
    toast: input => calls.toast.push(input),
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
  const { PhotoSourceDialog, PhotoPicker } = module.exports;
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const getButton = text => {
    const found = [...container.querySelectorAll('button')].find(button => button.textContent === text);
    assert(found, `button ${text} exists`);
    return found;
  };
  const click = async text => {
    const button = getButton(text);
    assert.equal(button.disabled, false, `${text} enabled`);
    await act(async () => button.click());
  };
  const select = async id => {
    const button = container.querySelector(`button[aria-label="选择 ${id}"]`);
    if (button) { assert.equal(button.disabled, false); await act(async () => button.click()); }
    else assert(container.querySelector(`button[aria-label="取消选择 ${id}"]`), `photo ${id} is already selected`);
  };
  const clickAlbum = async name => {
    const button = [...container.querySelectorAll('.photo-picker-album')].find(item => item.querySelector('.photo-picker-album-name')?.textContent === name);
    assert(button, `album ${name} exists`);
    await act(async () => button.click());
  };
  const chooseLocalPhotos = () => click('选择照片或文件夹');
  const enterText = async (label, value) => {
    const input = container.querySelector(`input[aria-label="${label}"]`);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
  };
  const link = async () => {
    await click('链接');
    return enterText('小红书或 Instagram 链接', 'https://www.instagram.com/p/test/');
  };
  let unmounted = false;
  const unmount = async () => { if (!unmounted) { await act(async () => root.unmount()); unmounted = true; } };
  try {
    const photos = options.props?.photos ?? [photo('existing')];
    const content = h(options.libraryOnly ? PhotoPicker : PhotoSourceDialog, { snapshot: makeSnapshot(photos), library: 'collection', ...options.props,
      onConfirm: result => calls.confirm.push(result), onClose() {}, onBusyChange: value => calls.busy.push(value) });
    await act(async () => root.render(options.outerForm ? h('form', { onSubmit: event => { event.preventDefault(); options.outerForm(); } }, content) : content));
    await run({ calls, click, getButton, select, clickAlbum, enterText, link, chooseLocalPhotos, container, unmount });
  } finally { await unmount(); container.remove(); }
}

for (const libraryOnly of [false, true]) {
  test(`${libraryOnly ? '图库选片' : '多来源选片'}跨页全选当前筛选结果，保留先前顺序并可取消全部选择`, async () => {
    const matching = Array.from({ length: 62 }, (_, index) => photo(`series-${index + 1}`));
    const photos = [{ ...photo('series-work'), library: 'work' }, photo('unmatched'), ...matching];
    const selectedIds = ['series-62', 'series-work'];
    await scenario({ libraryOnly, props: { photos, selectedIds } }, async ({ calls, click, clickAlbum, getButton, enterText, container }) => {
      await click('收藏');
      await clickAlbum('collection-album');
      await enterText('搜索当前相簿照片', 'series-');
      await click('下一页');
      assert.equal(container.querySelectorAll('.photo-picker-item').length, 2);
      await click('全选');
      assert.equal(getButton('全选').disabled, true);
      const expected = [...selectedIds, ...matching.slice(0, -1).map(({ id }) => id)];
      await click('确认选择');
      assert.deepEqual(calls.confirm, libraryOnly ? [expected] : [{ photoIds: expected }]);
      await click('取消全选');
      assert.equal(container.querySelector('.photo-picker-selection [role="status"]').textContent, '已选 0 张');
      assert.equal(getButton('取消全选').disabled, true);
    });
  });
}

test('本地空态直接选择混合来源，系统取消不导入，选择后直接提交', async () => {
  const paths = ['/photos/sample.jpg', '/photos/album'];
  const choices = [[], paths];
  await scenario({ props: { allowLibrary: false, groupId: 'collection-album' }, choose: () => choices.shift() }, async ({ calls, getButton, container, chooseLocalPhotos }) => {
    const chooseButton = () => getButton('选择照片或文件夹');
    assert.equal(chooseButton().closest('.photo-source-empty') !== null, true);
    assert.equal(chooseButton().hasAttribute('aria-haspopup'), false);
    assert.equal(container.querySelector('.empty-mark'), null);
    assert.equal(container.querySelector('.photo-picker-footer'), null);
    await chooseLocalPhotos();
    assert.equal(calls.choose, 1);
    assert.deepEqual(calls.prepare, []);
    assert.deepEqual(calls.commit, []);
    assert.equal(chooseButton().disabled, false);

    await chooseLocalPhotos();
    assert.deepEqual(calls.prepare, [[paths, 'collection', 'collection-album']]);
    assert.deepEqual(calls.commit, [['draft-1', ['new1', 'new2']]]);
    assert.deepEqual(calls.confirm, [{ photoIds: ['new1', 'new2'], snapshot }]);
    assert.deepEqual(calls.cancel, []);
    assert.equal(container.querySelector('.photo-picker-footer'), null);
  });
});

test('本地直接导入按候选顺序补足剩余名额，反馈超限和失败项', async () => {
  const failures = [{ path: '/photos/empty', message: '当前层级没有照片' }];
  await scenario({ props: { selectedIds: ['existing'], maxSelection: 3 }, prepare: () => ({ ...draft(['new1', 'new2', 'new3']), candidates: ['new3', 'new2', 'new1'].map(photo), failures }) }, async ({ calls, click, chooseLocalPhotos }) => {
    await click('本地'); await chooseLocalPhotos();
    assert.deepEqual(calls.commit, [['draft-1', ['new1', 'new2']]]);
    assert.deepEqual(calls.confirm, [{ photoIds: ['existing', 'new1', 'new2'], snapshot }]);
    assert.deepEqual(calls.toast, [{ title: '已导入 2 张照片 · 1 个项目未能导入',
      description: '另有 1 张超出当前选片上限。\n/photos/empty · 当前层级没有照片', status: 'error', duration: null }]);
  });
});

test('本地没有剩余名额时保留原选片并提示上限', async () => {
  await scenario({ props: { selectedIds: ['existing'], maxSelection: 1 } }, async ({ calls, click, getButton, container }) => {
    await click('本地');
    assert.equal(getButton('选择照片或文件夹').disabled, true);
    assert.match(container.textContent, /已达 1 张上限/);
    assert.equal(calls.choose, 0);
    await click('图库'); await click('确认选择');
    assert.deepEqual(calls.confirm, [{ photoIds: ['existing'] }]);
  });
});

test('链接逐张预览并更新进度，拿到候选会话后原地启用选片', async () => {
  const pending = deferred();
  await scenario({ props: { selectedIds: ['existing'] }, prepare: () => pending.promise }, async ({ calls, click, getButton, link, select, container }) => {
    await link(); await click('获取图片');
    const bar = container.querySelector('[role="progressbar"]');
    const confirm = [...container.querySelectorAll('button')].find(b => b.textContent === '确认导入');
    assert.match(bar.textContent, /正在读取帖子/);
    assert.equal(bar.hasAttribute('aria-valuenow'), false);
    assert.equal(getButton('全选').disabled, true);
    assert.equal(getButton('取消全选').disabled, true);
    const grid = container.querySelector('.photo-picker-grid');
    const placeholder = grid.querySelector('.photo-picker-placeholder[aria-hidden="true"]');
    assert(placeholder);
    assert.equal(placeholder.children.length, 3);
    assert.equal(grid.children.length, 1);
    const report = calls.prepare[0][4];
    await act(async () => report({ total: 2 }));
    assert.equal(bar.getAttribute('aria-valuenow'), '0');
    assert.equal(bar.getAttribute('aria-valuemax'), '2');
    await act(async () => report({ total: 2, photo: photo('new1') }));
    const first = container.querySelector('button[aria-label="预览 new1"]');
    assert(first);
    const firstImage = first.querySelector('img');
    assert(firstImage);
    assert.equal(first.disabled, true);
    assert.equal(first.querySelector('.photo-picker-check'), null);
    assert.equal(confirm.disabled, true);
    assert.equal(bar.getAttribute('aria-valuenow'), '1');
    assert.equal(grid.children.length, 2);
    assert(grid.firstElementChild === placeholder);
    assert(grid.lastElementChild === first);
    await act(async () => report({ total: 2, photo: photo('new2') }));
    assert.equal(bar.getAttribute('aria-valuenow'), '2');
    assert.equal(container.querySelectorAll('button[aria-label^="预览 "]').length, 2);
    assert.equal(grid.querySelector('.photo-picker-placeholder'), null);
    assert.equal(getButton('全选').disabled, true);
    await act(async () => pending.resolve(draft()));
    assert.equal(container.querySelector('button[aria-label="选择 new1"]'), first);
    assert.equal(first.querySelector('img'), firstImage);
    assert.equal(first.disabled, false);
    assert.equal(confirm.disabled, true);
    assert.equal(bar.getAttribute('aria-valuenow'), '2');
    await click('全选');
    assert.equal(grid.querySelectorAll('.is-selected').length, 2);
    assert.equal(confirm.disabled, false);
    await click('取消全选');
    assert.equal(container.querySelector('.photo-picker-selection [role="status"]').textContent, '已选 0 张');
    await select('new2'); await click('确认导入');
    assert.deepEqual(calls.commit, [['draft-1', ['new2']]]);
  });
});

test('链接超过 60 张仍连续显示，保留首格占位与滚动位置', async () => {
  const pending = deferred();
  const ids = Array.from({ length: 63 }, (_, index) => `new${index + 1}`);
  await scenario({ prepare: () => pending.promise }, async ({ calls, click, link, container }) => {
    await link(); await click('获取图片');
    const report = calls.prepare[0][4];
    const grid = container.querySelector('.photo-picker-grid');
    const scroll = container.querySelector('.photo-picker-scroll');
    const labels = () => [...grid.querySelectorAll('.photo-picker-item')].map(button => button.getAttribute('aria-label'));
    await act(async () => {
      for (const id of ids.slice(0, 60)) report({ total: ids.length, photo: photo(id) });
    });
    assert(grid.firstElementChild.matches('.photo-picker-placeholder[aria-hidden="true"]'));
    scroll.scrollTop = 100;
    const firstPhoto = grid.querySelector('.photo-picker-item');
    await act(async () => {
      for (const id of ids.slice(60, -1)) report({ total: ids.length, photo: photo(id) });
    });
    assert.equal(container.querySelector('.page-controls'), null);
    assert(grid.firstElementChild.matches('.photo-picker-placeholder'));
    assert.deepEqual(labels(), ids.slice(0, -1).map(id => `预览 ${id}`));
    assert.equal(scroll.scrollTop, 100);

    await act(async () => report({ total: ids.length, photo: photo(ids.at(-1)) }));
    assert.equal(grid.querySelector('.photo-picker-placeholder'), null);
    assert.deepEqual(labels(), ids.map(id => `预览 ${id}`));
    await act(async () => pending.resolve(draft(ids)));
    assert.equal(container.querySelector('.page-controls'), null);
    assert.deepEqual(labels(), ids.map(id => `选择 ${id}`));
    assert(grid.firstElementChild === firstPhoto);
    assert.equal(scroll.scrollTop, 100);
  });
});

test('本地导入超过 60 张时仍以一批提交', async () => {
  const ids = Array.from({ length: 62 }, (_, index) => `local${index + 1}`);
  await scenario({ prepare: () => draft(ids) }, async ({ calls, click, chooseLocalPhotos }) => {
    await click('本地'); await chooseLocalPhotos();
    assert.deepEqual(calls.commit, [['draft-1', ids]]);
    assert.deepEqual(calls.confirm, [{ photoIds: ids, snapshot }]);
  });
});

test('链接准备中切换来源忽略迟到进度，卸载后迟到的候选会话取消', async () => {
  const pending = deferred();
  await scenario({ prepare: () => pending.promise }, async ({ calls, click, link, container, unmount }) => {
    await link(); await click('获取图片');
    const report = calls.prepare[0][4];
    await act(async () => report({ total: 2, photo: photo('new1') }));
    assert.equal(container.querySelectorAll('.photo-picker-item').length, 1);
    await click('本地');
    assert.equal(calls.cancelRequest.length, 1);
    await act(async () => report({ total: 2, photo: photo('new2') }));
    await act(async () => pending.resolve(draft()));
    assert.deepEqual(calls.cancel, ['draft-1']);
    assert.equal(container.querySelector('[role="progressbar"]'), null);
    assert.equal(container.querySelector('.photo-picker-placeholder'), null);
    assert.equal(container.querySelectorAll('.photo-picker-item').length, 0);
    assert.equal(calls.commit.length, 0);
    await unmount(); assert.equal(calls.busy.at(-1), false);
  });
  const local = deferred();
  await scenario({ props: { allowLibrary: false }, prepare: () => local.promise }, async ({ calls, click, chooseLocalPhotos }) => {
    await chooseLocalPhotos(); await click('取消');
    await act(async () => local.resolve(draft()));
    assert.deepEqual(calls.cancel, ['draft-1']);
    assert.equal(calls.commit.length, 0);
    assert.equal(calls.confirm.length, 0);
  });
});

test('获取失败撤下已显示的进度和照片，保留错误和重新获取入口', async () => {
  const pending = deferred();
  await scenario({ prepare: () => pending.promise }, async ({ calls, click, link, container }) => {
    await link(); await click('获取图片');
    const report = calls.prepare[0][4];
    await act(async () => report({ total: 2, photo: photo('new1') }));
    assert.equal(container.querySelectorAll('.photo-picker-item').length, 1);
    await act(async () => pending.reject(new Error('第二张图片下载失败')));
    assert.equal(container.querySelector('[role="progressbar"]'), null);
    assert.equal(container.querySelector('.photo-picker-placeholder'), null);
    assert.equal(container.querySelectorAll('.photo-picker-item').length, 0);
    assert.match(container.querySelector('[role="alert"]').textContent, /第二张图片下载失败/);
    assert.equal([...container.querySelectorAll('button')].find(b => b.textContent === '获取图片').disabled, false);
  });
});

test('停止获取保留弹窗；重新获取期间的旧进度和旧候选不会混入', async () => {
  const old = deferred();
  const next = deferred();
  const attempts = [old, next];
  await scenario({ prepare: () => attempts.shift().promise }, async ({ calls, click, link, container }) => {
    const input = await link(); await click('获取图片');
    const reportOld = calls.prepare[0][4];
    await act(async () => reportOld({ total: 2, photo: photo('old1') }));
    await click('停止获取');
    assert.equal(container.querySelector('[role="progressbar"]'), null);
    assert.equal(container.querySelector('.photo-picker-placeholder'), null);
    assert.equal(container.querySelectorAll('.photo-picker-item').length, 0);
    assert.equal(input.value, 'https://www.instagram.com/p/test/');
    assert.deepEqual(calls.cancelRequest, [calls.prepare[0][3]]);
    await click('获取图片');
    await act(async () => {
      reportOld({ total: 2, photo: photo('old2') });
      old.resolve({ ...draft(['old1', 'old2']), id: 'old-draft' });
    });
    assert.deepEqual(calls.cancel, ['old-draft']);
    const bar = container.querySelector('[role="progressbar"]');
    assert.equal(bar.hasAttribute('aria-valuenow'), false);
    assert.equal(container.querySelectorAll('.photo-picker-item').length, 0);
    await act(async () => next.resolve(draft()));
    assert.equal(container.querySelectorAll('button[aria-label^="选择 new"]').length, 2);
  });
});

test('提交失败清空已消费会话，显示重准备错误，不能重复提交旧draft', async () => {
  await scenario({ failCommit: true, props: { allowLibrary: false } }, async ({ calls, container, chooseLocalPhotos }) => {
    await chooseLocalPhotos();
    assert.match(container.textContent, /提交测试失败.*重新准备/);
    assert.equal(container.querySelector('.photo-picker-footer'), null);
    assert.equal(calls.commit.length, 1); assert.equal(calls.confirm.length, 0);
    assert.deepEqual(calls.cancel, []);
    await chooseLocalPhotos(); assert.equal(calls.prepare.length, 2);
  });
});

test('本地全部失败保留逐项原因，可以重新选择', async () => {
  await scenario({ props: { allowLibrary: false }, prepare: () => ({ ...draft([]), failures: [{ path: 'bad.jpg', message: '无法解码' }] }) }, async ({ calls, getButton, container, chooseLocalPhotos }) => {
    await chooseLocalPhotos();
    assert.deepEqual(calls.commit, []);
    assert.deepEqual(calls.confirm, []);
    assert.match(container.querySelector('[role="alert"]').textContent, /1 个项目未能导入.*bad.jpg · 无法解码/);
    assert.equal(getButton('选择照片或文件夹').disabled, false);
  });
});

test('本地相簿满额直接进入取舍，取消清理会话且不改变图库', async () => {
  await scenario({ props: { allowLibrary: false }, prepare: () => ({ ...draft(), capacity: 2, activeIds: ['old1', 'old2'], candidates: ['old1', 'old2', 'new1', 'new2'].map(photo) }) }, async ({ calls, click, getButton, container, chooseLocalPhotos }) => {
    await chooseLocalPhotos();
    assert.equal(container.querySelectorAll('.candidate.kept').length, 4);
    assert.equal(getButton('查看变更').disabled, true);
    assert.deepEqual(calls.commit, []);
    await click('取消全部变更');
    assert.deepEqual(calls.cancel, ['draft-1']); assert.equal(calls.commit.length, 0);
    assert(container.textContent.includes('选择照片或文件夹'));
  });
});

test('本地相簿满额只按确认的取舍保存', async () => {
  await scenario({ props: { allowLibrary: false }, prepare: () => ({ ...draft(['new1']), capacity: 1, activeIds: ['old1'], candidates: ['old1', 'new1'].map(photo) }) }, async ({ calls, click, container, chooseLocalPhotos }) => {
    await chooseLocalPhotos();
    await act(async () => container.querySelector('.candidate-keep input').click());
    await click('查看变更');
    assert.deepEqual(calls.commit, []);
    await click('确认并保存');
    assert.deepEqual(calls.commit, [['draft-1', ['new1']]]);
    assert.deepEqual(calls.confirm, [{ photoIds: ['new1'], snapshot }]);
  });
});

test('链接满额时仍由用户先选片，再进入取舍', async () => {
  await scenario({ prepare: () => ({ ...draft(), capacity: 1, activeIds: ['old1'], candidates: ['old1', 'new1', 'new2'].map(photo) }) }, async ({ calls, click, select, getButton, link, container }) => {
    await link(); await click('获取图片');
    assert.equal(getButton('确认导入').disabled, true);
    await select('new2');
    assert.deepEqual(calls.commit, []);
    await click('确认导入');
    assert.deepEqual([...container.querySelectorAll('.candidate-keep span')].map((label) => label.textContent), ['old1', 'new2']);
    assert.deepEqual(calls.commit, []);
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
  await scenario({ failCancelOnce: true, props: { allowLibrary: false }, prepare: () => ({ ...draft(), capacity: 1, activeIds: ['old1'], candidates: ['old1', 'new1', 'new2'].map(photo) }) }, async ({ calls, click, container, chooseLocalPhotos }) => {
    await chooseLocalPhotos();
    await click('取消全部变更');
    assert.match(container.textContent, /取消失败：候选目录无法清理/);
    assert.equal(container.querySelectorAll('.candidate.kept').length, 3);
    await click('取消全部变更');
    assert.deepEqual(calls.cancel, ['draft-1', 'draft-1']);
    assert.equal(calls.commit.length, 0);
  });
});
