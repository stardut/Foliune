import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
test.beforeEach(() => window.localStorage.clear());
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'ResizeObserver', 'IntersectionObserver', 'CompositionEvent', 'CSS']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'document' ? window.document : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window.HTMLImageElement.prototype, 'complete', { configurable: true, get: () => false });
globalThis.Image = class {
  naturalWidth = 100;
  decode() { return Promise.resolve(); }
  removeAttribute() {}
};
const pendingDecodes = new WeakMap();
Object.defineProperties(window.HTMLImageElement.prototype, {
  naturalWidth: { configurable: true, get: () => 100 },
  decode: { configurable: true, value() { return pendingDecodes.get(this) ?? Promise.resolve(); } },
});
const incomingImage = (scope) => scope.querySelector('.album-single-stage .photo-review-frame-incoming img');
const shownImage = (scope) => scope.querySelector('.album-single-stage .photo-review-frame:not([aria-hidden]) img');
// Happy DOM has no CSS layout; provide the strip's viewport and fractional pitch.
const filmstripPitch = 77.8125;
const filmstripViewport = 650;
const nativeWidth = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'clientWidth');
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
  ...nativeWidth,
  get() {
    if (!this.matches('.album-filmstrip')) return nativeWidth.get.call(this);
    const count = Number(this.firstElementChild?.style.getPropertyValue('--filmstrip-count'));
    return Math.min(filmstripViewport, count * filmstripPitch);
  },
});
const nativeRect = window.Element.prototype.getBoundingClientRect;
window.Element.prototype.getBoundingClientRect = function () {
  if (this.matches('.album-filmstrip-pitch')) return new window.DOMRect(0, 0, filmstripPitch, 1);
  if (this.matches('.album-filmstrip')) return new window.DOMRect(0, 0, this.clientWidth, 60);
  if (this.matches('.album-filmstrip-thumb')) {
    const left = 4 + Number(this.dataset.photoIndex) * filmstripPitch - this.closest('.album-filmstrip').scrollLeft;
    return new window.DOMRect(left, 0, filmstripPitch - 8, 60);
  }
  return nativeRect.call(this);
};
const { createElement: h, act: reactAct } = require('react');
const { createRoot } = require('react-dom/client');
let autoLoadStage = true;
async function act(run) {
  await reactAct(run);
  const incoming = autoLoadStage && incomingImage(document);
  if (incoming) await reactAct(async () => incoming.dispatchEvent(new Event('load')));
}
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
// Keep Workspace's real home/detail/search logic, album cards and header.
// Replace unrelated workbenches and the native/geometry boundaries only.
const bundle = await build({
  stdin: { contents: `export { LibraryWorkspace } from './LibraryWorkspace'; export { SearchWorkspace } from './search/SearchWorkspace';`, resolveDir: resolve('apps/desktop/src/features') },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent',
  loader: { '.css': 'empty' },
  plugins: [{ name: 'workspace-boundaries', setup(build) {
    build.onResolve({ filter: /^react$/, namespace: 'workspace-boundary' }, () => ({ path: 'react', external: true }));
    build.onResolve({ filter: /\/(PhotoCanvas|PhotoDetail|CurationWorkspace|PhotoSourceDialog|AddPhotosToBook|PhotoReview|SocialWorkspace|CollageWorkspace|ToastProvider|use-context-menu|api|book-api|model-api|planning-api)$/ }, ({ path }) => ({ path, namespace: 'workspace-boundary' }));
    build.onLoad({ filter: /.*/, namespace: 'workspace-boundary' }, ({ path }) => {
      const name = path.split('/').at(-1);
      if (name === 'PhotoCanvas') return { contents: `import { createElement as h, useLayoutEffect } from 'react';
        export const PhotoCanvas = ({ photos, sections, selected, onLayoutReady, onPreview, onMenu, onSelect, onReveal, restore }) => {
          useLayoutEffect(() => { onLayoutReady?.(); }, [onLayoutReady]);
          useLayoutEffect(() => { globalThis.captureAlbumTestWallReveal?.(onReveal); }, [onReveal]);
          useLayoutEffect(() => { if (restore) globalThis.captureAlbumTestWallRestore?.(restore); }, [restore]);
          return h('div', { className: 'virtual-photo-wall', 'data-testid': 'photo-canvas', 'data-section-headings': sections?.map(([heading]) => heading).join(',') }, photos.map((photo, index) =>
            h('span', { key: photo.id, 'data-photo-id': photo.id, 'data-photo-index': index },
              h('button', { className: 'photo-interaction-target', 'aria-pressed': selected.length ? selected.includes(photo.id) : undefined,
                onContextMenu: (event) => onMenu(photo, { x: 0, y: 0 }, event.currentTarget),
                onClick: () => selected.length ? onSelect(photo.id) : onPreview(photo),
              }, photo.title))));
        };
        export const SelectionBar = ({ count, onMore }) => count ? h('button', {
          'data-testid': 'selection-more', onClick: (event) => onMore({ x: 0, y: 0 }, event.currentTarget),
        }, '选片更多') : null;` };
      if (name === 'PhotoReview') return { contents: `import { createElement as h } from 'react';
        export const PhotoReview = ({ photos, initialPhotoId, onClose, fullscreen }) => h('div', { 'data-testid': 'photo-review', 'data-review-ids': photos.map(photo => photo.id).join(), 'data-initial-id': initialPhotoId, 'data-fullscreen-entry': fullscreen }, h('button', { onClick: (event) => onClose(event.currentTarget.parentElement.dataset.visibleId ?? initialPhotoId) }, '关闭'));` };
      if (name === 'ToastProvider') return { contents: 'export const useToast = () => () => {};' };
      if (name === 'use-context-menu') return { contents: 'export const isContextMenuTracking = () => false; export const useContextMenu = (scope) => (actions, at, trigger) => globalThis.captureAlbumTestMenu?.({ scope, actions, at, trigger });' };
      if (name === 'api') return { contents: [
        'export const isDesktop = () => !!globalThis.albumAirDropTest;',
        'export const shareAlbumAirDrop = (...args) => globalThis.albumAirDropTest(...args);',
        'export const updateGroup = (...args) => globalThis.albumCoverTest(...args);',
        'export const readAlbumCover = () => { throw new Error("Unexpected album cover read"); };',
        ...['cancelCuration', 'prepareGroupCuration', 'setMembershipStatuses', 'updatePhoto', 'createGroup', 'commitCuration', 'deleteGroup'].map(name => `export const ${name} = () => { throw new Error('Unexpected native mutation: ${name}'); };`),
      ].join('\n') };
      if (name === 'book-api') return { contents: 'export const listBooks = async () => globalThis.searchFixture?.books?.() ?? [];' };
      if (name === 'model-api') return { contents: 'export const listModels = async () => globalThis.searchFixture?.models?.() ?? [];' };
      if (name === 'planning-api') return { contents: 'export const listPlans = async () => globalThis.searchFixture?.plans?.() ?? [];' };
      return { contents: `export const ${name} = () => null;` };
    });
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { LibraryWorkspace, SearchWorkspace } = module.exports;
const photo = (library, suffix) => ({ id: `${library}-${suffix}`, library, title: `${library}-${suffix}`, originalName: `${suffix}.jpg`, originalPath: '/test.jpg', thumbnailPath: '/test.jpg', originalUrl: '/test.jpg', thumbnailUrl: '/test.jpg', originalAvailable: true, thumbnailAvailable: true, width: 100, height: 150, tags: ['shared'], regions: [], annotation: '', source: '', capturedAt: null, location: '', project: '', importedAt: '' });
const groups = ['collection', 'work'].flatMap(library => ['album', 'empty'].map(suffix => ({ id: `${library}-${suffix}`, library, name: `${library}-${suffix}`, description: '', capacity: null, createdAt: '' })));
const mixed = {
  photos: ['collection', 'work'].flatMap(library => ['active', 'discarded', 'loose'].map(suffix => photo(library, suffix))),
  groups,
  memberships: ['collection', 'work'].flatMap(library => ['active', 'discarded'].map((status, position) => ({ groupId: `${library}-album`, photoId: `${library}-${status}`, status, position }))),
};
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
async function scenario(space, input, run, options = {}) {
  const snapshot = freeze(structuredClone(input));
  const before = structuredClone(snapshot);
  const container = document.createElement(space === 'search' || options.withMain ? 'main' : 'div'); document.body.append(container);
  const root = createRoot(container);
  const calls = [];
  const relinks = [];
  const plays = [];
  const idle = [];
  const onBrowsingIdleChange = value => idle.push(value);
  const session = options.session ?? { query: '', category: 'all', scrollTop: 0 };
  const showDetail = () => { container.scrollTop = 0; root.render(h('div', null, '详情')); };
  const renderSnapshot = (next = snapshot) => act(async () => root.render(h(space === 'search' ? SearchWorkspace : LibraryWorkspace, {
    ...(space === 'search' ? { session, onOpenBook: showDetail, onOpenModel: showDetail, onOpenPlan: showDetail } : { space }),
    snapshot: next, onSnapshot: next => calls.push(next), onFeedback: options.onFeedback ?? (() => {}), onRelink: async (photo) => relinks.push(photo.id), onPlay: (ids) => plays.push(ids), onBrowsingIdleChange,
  })));
  try {
    await renderSnapshot(snapshot);
    await run({ container, relinks, renderSnapshot, session, plays, idle });
    assert.deepEqual(snapshot, before, '浏览和搜索不改变照片、真实相簿或成员关系');
    assert.deepEqual(calls, options.expectedSnapshots ?? [], '只应用用户操作返回的图库快照');
  } finally { await act(async () => root.unmount()); container.remove(); }
}

for (const library of ['collection', 'work']) {
  test(`${library} 从相簿返回首页时恢复原滚动位置`, async () => {
    await scenario(library, mixed, async ({ container }) => {
      container.scrollTop = 240;
      await act(async () => container.querySelector('.album-open').click());
      assert.equal(container.scrollTop, 0, '从相簿顶部开始浏览');
      container.scrollTop = 90;
      await act(async () => container.querySelector('button[aria-label^="返回"][aria-label$="相簿"]').click());
      assert.equal(container.scrollTop, 240, '回到进入前的相簿列表位置');
    }, { withMain: true });
  });

  test(`${library} 首页有已归属、废弃和无归属照片时，只呈现对应真实相簿并保持单击与返回`, async () => {
    await scenario(library, mixed, async ({ container }) => {
      const cards = [...container.querySelectorAll('button.album-open')];
      assert.deepEqual(cards.map(card => card.querySelector('h2').textContent), [`${library}-album`, `${library}-empty`]);
      assert.deepEqual(cards.map(card => card.querySelector('.album-count').textContent.trim()), ['1 张', '0 张']);
      assert.equal(container.querySelector('.photo-count').textContent, '2 本相簿');
      assert.equal(container.textContent.includes('未归入相簿'), false);
      assert.equal(container.querySelector('[data-testid="photo-canvas"]'), null);
      await act(async () => cards[0].click());
      assert.equal(container.querySelector('.album-detail-title h1').textContent, `${library}-album`);
      assert.deepEqual([...container.querySelectorAll('[data-photo-id]')].map(photo => photo.dataset.photoId), [`${library}-active`]);
      await act(async () => container.querySelector('button[aria-label="相簿更多操作"]').click());
      assert.equal(menuFor(albumMore(container)).textContent.includes('相簿信息'), false);
      assert.equal(menuFor(albumMore(container)).textContent.includes('查看已废弃'), true);
      await act(async () => container.querySelector(`button[aria-label="返回${library === 'work' ? '作品相簿' : '收藏相簿'}"]`).click());
      assert.equal(container.querySelectorAll('button.album-open').length, 2);
      await act(async () => container.querySelectorAll('button.album-open')[1].click());
      await openAlbumMore(albumMore(container));
      assert.equal(photoSortOptions(menuFor(albumMore(container))).filter((option) => option.disabled).length, 5);
    });
  });

  test(`${library} 没有真实相簿但有无归属照片时显示新建相簿空态`, async () => {
    await scenario(library, { ...mixed, groups: mixed.groups.filter(group => group.library !== library), memberships: mixed.memberships.filter(member => !member.groupId.startsWith(library)) }, async ({ container }) => {
      assert.equal(container.querySelector('.empty-state h2').textContent, '还没有相簿');
      assert.equal(container.querySelector('.empty-state button').textContent, '新建相簿');
      assert.equal(container.querySelector('.photo-count').textContent, '0 本相簿');
      assert.equal(albumSortTrigger(container).disabled, true);
      assert.equal(container.querySelectorAll('button.album-open').length, 0);
      assert.equal(container.textContent.includes('未归入相簿'), false);
    });
  });
}

test('相簿首页与详情共用有效成员，分别保留收藏和废弃的相簿顺序', async () => {
  const member = (photoId, status, position) => ({ groupId: 'collection-album', photoId, status, position });
  const input = {
    ...mixed,
    photos: [...mixed.photos, photo('collection', 'earliest'), photo('collection', 'discarded-first')],
    memberships: [
      ...mixed.memberships,
      member('collection-active', 'active', 9),
      member('collection-loose', 'active', 2),
      member('work-active', 'active', -2),
      member('missing-photo', 'discarded', 0),
      member('collection-earliest', 'active', 1),
      member('collection-discarded-first', 'discarded', 0),
    ],
  };
  await scenario('collection', input, async ({ container }) => {
    const card = container.querySelector('.album-open');
    const shownPhotos = () => [...container.querySelectorAll('[data-photo-id]')].map(photo => photo.dataset.photoId);
    assert.equal(card.querySelector('.album-count').textContent.trim(), '3 张');
    assert.equal(card.querySelector('img').alt, 'collection-active');
    await act(async () => card.click());
    assert.deepEqual(shownPhotos(), ['collection-active', 'collection-earliest', 'collection-loose']);
    await act(async () => container.querySelector('button[aria-label="相簿更多操作"]').click());
    await act(async () => [...menuFor(albumMore(container)).querySelectorAll('button')].find(button => button.textContent === '查看已废弃').click());
    assert.deepEqual(shownPhotos(), ['collection-discarded-first', 'collection-discarded']);
    await act(async () => container.querySelector('.album-return').click());
    assert.deepEqual(shownPhotos(), ['collection-active', 'collection-earliest', 'collection-loose']);
  });
});

async function changeSort(trigger, label) {
  await act(async () => trigger.click());
  const item = [...menuFor(trigger).querySelectorAll('[role="menuitemradio"]')].find((option) => option.textContent === label);
  assert.ok(item, `找不到排序选项 ${label}`);
  await act(async () => item.click());
}

const albumMore = (container) => container.querySelector('button[aria-label="相簿更多操作"]');
const albumSortTrigger = (container) => container.querySelector('button[aria-haspopup="menu"][aria-label^="相簿排序 · "]');
const menuFor = (trigger) => document.getElementById(trigger.getAttribute('aria-controls') ?? '');
const radioGroup = (menu, label) => menu?.querySelector(`[role="group"][aria-label="${label}"]`);
const photoSortOptions = (menu) => [...(radioGroup(menu, '照片排序')?.querySelectorAll('button') ?? [])];

async function openAlbumMore(trigger) {
  await act(async () => { trigger.focus(); trigger.click(); });
}

async function changePhotoSort(trigger, label) {
  await openAlbumMore(trigger);
  const item = photoSortOptions(menuFor(trigger)).find((option) => option.textContent === label);
  assert.ok(item, `找不到照片排序选项 ${label}`);
  await act(async () => item.click());
}

async function assertPhotoSort(trigger, label) {
  await openAlbumMore(trigger);
  const checked = photoSortOptions(menuFor(trigger)).filter((option) => option.getAttribute('aria-checked') === 'true');
  assert.deepEqual(checked.map((option) => option.textContent), [label]);
  assert.ok(checked[0].querySelector('.dropdown-row-check'));
  await pressKey(checked[0], 'Escape');
}

test('隔空投送区分整本相簿、选片和未选照片，取消后保留选择', async (t) => {
  const userAgent = t.mock.getter(window.navigator, 'userAgent', () => 'Mozilla/5.0 (Macintosh)');
  const groupId = 'collection-album';
  const photos = ['a', 'b', 'c'].map((suffix) => photo('collection', suffix));
  const input = {
    ...mixed, photos: [...mixed.photos, ...photos],
    memberships: [...mixed.memberships, ...photos.map(({ id }, position) => ({ groupId, photoId: id, status: 'active', position: position + 2 }))],
  };
  const shares = [];
  let actions, finish;
  globalThis.albumAirDropTest = (...args) => {
    shares.push(args);
    return new Promise((resolve) => { finish = resolve; });
  };
  globalThis.captureAlbumTestMenu = (menu) => { actions = menu.actions; };
  try {
    await scenario('collection', input, async ({ container, renderSnapshot }) => {
      const action = (id) => actions.find((item) => item.id === id);
      const context = (button) => act(async () => button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
      const run = (id) => act(async () => action(id).run());
      const finishSharing = () => act(async () => finish());
      const card = container.querySelector('.album-open');
      await context(card);
      assert.equal(action('airdrop').text, '隔空投送整本 · 4 张');
      await run('airdrop');
      assert.deepEqual(shares.pop(), [groupId, undefined]);
      assert.equal(card.disabled, true);
      await finishSharing();

      await act(async () => card.click());
      await act(async () => container.querySelector('[aria-label="总览"]').click());
      const photoButton = (id) => container.querySelector(`[data-photo-id="collection-${id}"] button`);
      await context(photoButton('a'));
      await run('select');
      await act(async () => photoButton('b').click());
      await act(async () => container.querySelector('[data-testid="selection-more"]').click());
      assert.equal(action('airdrop').text, '隔空投送 · 2 张');
      await run('airdrop');
      assert.deepEqual(shares.pop(), [groupId, [photos[0].id, photos[1].id]]);
      await finishSharing();
      assert.equal(photoButton('a').getAttribute('aria-pressed'), 'true');
      assert.equal(photoButton('b').getAttribute('aria-pressed'), 'true');

      await context(photoButton('c'));
      assert.equal(action('airdrop').text, '隔空投送');
      await run('airdrop');
      assert.deepEqual(shares.pop(), [groupId, [photos[2].id]]);
      await finishSharing();

      userAgent.mock.mockImplementation(() => 'Mozilla/5.0 (Windows NT)');
      await renderSnapshot();
      await context(photoButton('a'));
      assert.equal(action('airdrop'), undefined);
    });
  } finally {
    delete globalThis.captureAlbumTestMenu;
    delete globalThis.albumAirDropTest;
  }
});

function pressKey(target, key) {
  return act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
}

test('相簿封面以右击照片取景，取消保留旧封面，保存后卡片与弹窗一致', async (t) => {
  const groupId = 'collection-album';
  const cover = { photoId: 'collection-loose', offsetX: .5, offsetY: 1, zoom: 2 };
  const input = { ...mixed,
    photos: mixed.photos.map((photo) => photo.id === cover.photoId ? { ...photo, originalUrl: '/source.jpg', thumbnailUrl: '/preview.jpg' } : photo),
    memberships: [...mixed.memberships, { groupId, photoId: cover.photoId, status: 'active', position: 2 }],
  };
  const saved = { ...input, groups: input.groups.map((group) => group.id === groupId ? { ...group, cover } : group) };
  const discarded = { ...saved, memberships: input.memberships.map((member) => member.photoId === cover.photoId ? { ...member, status: 'discarded' } : member) };
  let actions, settleSave;
  t.mock.method(window.Element.prototype, 'getBoundingClientRect', function () { return new window.DOMRect(0, 0, 300, 200); });
  globalThis.captureAlbumTestMenu = (menu) => { actions = menu.actions; };
  const update = t.mock.fn(() => new Promise((resolve, reject) => { settleSave = { resolve, reject }; }));
  globalThis.albumCoverTest = update;
  try {
    await scenario('collection', input, async ({ container, renderSnapshot }) => {
      const photoButton = (id) => container.querySelector(`[data-photo-id="collection-${id}"] button`);
      const action = (id) => actions.find((item) => item.id === id);
      const context = (target) => act(async () => { target.focus(); target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })); });
      const run = (id) => act(async () => { assert.equal(action(id)?.allowed(), true); action(id).run(); });
      const click = (target) => act(async () => target.click());
      const frame = () => container.querySelector('.album-cover-editor-frame');
      const zoom = () => container.querySelector('.album-cover-zoom input');
      const save = () => container.querySelector('dialog .button-primary');
      const cancel = () => container.querySelector('dialog .form-actions .button');
      const openCrop = async () => {
        await context(photoButton('loose'));
        await run('cover');
        assert.equal(frame().querySelector('img').alt, cover.photoId);
        assert.equal(frame().querySelector('img').getAttribute('src'), '/source.jpg');
        assert.equal(save().disabled, true);
        await act(async () => frame().querySelector('img').dispatchEvent(new Event('load')));
      };
      await click(container.querySelector('.album-open'));
      await click(container.querySelector('[aria-label="总览"]'));
      await context(photoButton('active'));
      await run('select');
      await click(container.querySelector('[data-testid="selection-more"]'));
      assert.equal(action('cover'), undefined);

      await openCrop();
      await pressKey(frame(), 'ArrowDown');
      assert.equal(frame().style.getPropertyValue('--album-cover-position'), '50% 53.2%');
      await click(cancel());
      assert.equal(update.mock.callCount(), 0);
      assert.equal(document.activeElement, photoButton('loose'));

      await click(photoButton('loose'));
      await click(container.querySelector('[data-testid="selection-more"]'));
      assert.equal(action('cover'), undefined);
      await openCrop();
      assert.equal(photoButton('active').getAttribute('aria-pressed'), 'true');
      assert.equal(photoButton('loose').getAttribute('aria-pressed'), 'true');
      const pointer = (type, clientY) => act(async () => frame().dispatchEvent(new window.PointerEvent(type, { pointerId: 1, clientX: 100, clientY, bubbles: true })));
      await pointer('pointerdown', 120);
      await pointer('pointermove', -200);
      await pointer('pointerup', -200);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(zoom(), '2');
        zoom().dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.equal(zoom().value, '2');
      assert.equal(frame().style.getPropertyValue('--album-cover-position'), '50% 100%');
      await click(save());
      assert.deepEqual(update.mock.calls[0].arguments, [groupId, { cover }]);
      assert.equal(cancel().disabled, true);
      const dialog = container.querySelector('dialog');
      assert.equal(dialog.open, true);
      assert.match(dialog.querySelector('[role="status"]')?.textContent ?? '', /保存/);
      assert.ok(save().querySelector('.spin'));
      assert.equal(save().disabled, true);
      assert.equal(zoom().disabled, true);
      await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
      assert.equal(container.querySelector('dialog'), dialog);
      await click(save());
      assert.equal(update.mock.callCount(), 1);
      await act(async () => settleSave.reject(new Error('封面写入失败')));
      assert.equal(container.querySelector('dialog [role="alert"]').textContent, '封面写入失败');
      assert.equal(save().disabled, false);
      assert.equal(save().querySelector('.spin'), null);
      assert.equal(frame().style.getPropertyValue('--album-cover-top'), '-100%');
      await click(save());
      await act(async () => settleSave.resolve(saved));
      assert.equal(container.querySelector('dialog'), null);
      await renderSnapshot(saved);
      await openCrop();
      assert.equal(zoom().value, '2');
      const previewStyle = frame().getAttribute('style');
      await click(cancel());

      await click(container.querySelector('[aria-label="返回收藏相簿"]'));
      const card = () => container.querySelector('.album-open .album-cover');
      assert.equal(card().querySelector('img').alt, cover.photoId);
      assert.equal(card().querySelector('img').getAttribute('src'), '/preview.jpg');
      assert.equal(card().getAttribute('style'), previewStyle);
      await renderSnapshot(discarded);
      assert.equal(card().querySelector('img').alt, 'collection-active');
      assert.equal(card().getAttribute('style'), null);
      await renderSnapshot(saved);
      assert.equal(card().querySelector('img').alt, cover.photoId);
      await click(container.querySelector('.album-open'));
      await click(albumMore(container));
      await click([...menuFor(albumMore(container)).querySelectorAll('button')].find((button) => button.textContent === '查看已废弃'));
      await context(photoButton('discarded'));
      assert.equal(action('cover'), undefined);
    }, { expectedSnapshots: [saved] });
  } finally {
    delete globalThis.captureAlbumTestMenu;
    delete globalThis.albumCoverTest;
  }
});

test('相簿按创建时间或自然名称双向排序，照片排序不影响封面及加入顺序', async () => {
  const input = {
    photos: [
      { ...photo('collection', '10'), capturedAt: '2025-01-01T00:00:00Z' },
      { ...photo('collection', '2'), capturedAt: '2025-01-02T00:00:00Z' },
    ],
    groups: [[2, '2025-01-01'], [10, '2025-01-02'], [1, '2025-01-03']].map(([number, createdAt]) => ({
      ...groups[0], id: `album-${number}`, name: `相簿${number}`, createdAt,
    })),
    memberships: [10, 2].map((number, position) => ({ groupId: 'album-2', photoId: `collection-${number}`, status: 'active', position })),
  };
  await scenario('collection', input, async ({ container, idle }) => {
    const homeSort = () => albumSortTrigger(container);
    const currentIcon = () => homeSort().querySelector('svg').getAttribute('class');
    const cardOrder = () => [...container.querySelectorAll('.album-open h2')].map((item) => item.textContent);
    const cover = () => container.querySelector('.album-open img');
    const shownPhotos = () => [...container.querySelectorAll('[data-photo-id]')].map((item) => item.dataset.photoId);
    assert.deepEqual(cardOrder(), ['相簿2', '相簿10', '相簿1']);
    assert.equal(homeSort().getAttribute('aria-label'), '相簿排序 · 创建时间 · 由旧到新');
    assert.equal(homeSort().title, homeSort().getAttribute('aria-label'));
    assert.match(currentIcon(), /lucide-arrow-up-wide-narrow/);
    assert.equal(idle.at(-1), true);
    await act(async () => homeSort().focus());
    await pressKey(homeSort(), 'ArrowDown');
    assert.equal(idle.at(-1), false);
    assert.equal(homeSort().getAttribute('aria-expanded'), 'true');
    const checked = menuFor(homeSort()).querySelector('[role="menuitemradio"][aria-checked="true"]');
    assert.equal(document.activeElement, checked);
    assert.equal(checked.textContent, '创建时间 · 由旧到新');
    assert.ok(checked.querySelector('.dropdown-row-check'));
    await pressKey(checked, 'ArrowDown');
    assert.equal(document.activeElement.textContent, '创建时间 · 由新到旧');
    await act(async () => document.activeElement.click());
    assert.equal(document.activeElement, homeSort());
    assert.equal(homeSort().getAttribute('aria-expanded'), 'false');
    assert.equal(idle.at(-1), true);
    assert.match(currentIcon(), /lucide-arrow-down-wide-narrow/);
    assert.deepEqual(cardOrder(), ['相簿1', '相簿10', '相簿2']);
    await changeSort(homeSort(), '相簿名 · 升序');
    assert.match(currentIcon(), /lucide-arrow-down-az/);
    assert.deepEqual(cardOrder(), ['相簿1', '相簿2', '相簿10']);
    await changeSort(homeSort(), '相簿名 · 降序');
    assert.match(currentIcon(), /lucide-arrow-down-za/);
    assert.deepEqual(cardOrder(), ['相簿10', '相簿2', '相簿1']);
    await act(async () => homeSort().click());
    await act(async () => cover().dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true })));
    assert.equal(homeSort().getAttribute('aria-expanded'), 'false');
    await act(async () => cover().closest('button').click());
    const sort = albumMore(container);
    assert.equal(albumSortTrigger(container), null);
    await openAlbumMore(sort);
    assert.deepEqual(photoSortOptions(menuFor(albumMore(container))).map((item) => item.textContent), [
      '加入顺序', '拍摄时间 · 由旧到新', '拍摄时间 · 由新到旧', '文件名 · 升序', '文件名 · 降序',
    ]);
    assert.equal(idle.at(-1), false);
    await act(async () => photoSortOptions(menuFor(albumMore(container)))[0].focus());
    await pressKey(document.activeElement, 'Escape');
    assert.equal(document.activeElement, sort);
    assert.equal(photoSortOptions(menuFor(albumMore(container))).length, 0);
    assert.equal(idle.at(-1), true);
    await openAlbumMore(sort);
    await act(async () => container.querySelector('[data-photo-id]').dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true })));
    assert.equal(sort.getAttribute('aria-expanded'), 'false');
    await assertPhotoSort(sort, '拍摄时间 · 由新到旧');
    assert.deepEqual(shownPhotos(), ['collection-2', 'collection-10']);
    await changePhotoSort(sort, '文件名 · 升序');
    assert.deepEqual(shownPhotos(), ['collection-2', 'collection-10']);
    await changePhotoSort(sort, '加入顺序');
    assert.equal(document.activeElement, sort);
    await assertPhotoSort(sort, '加入顺序');
    assert.deepEqual(shownPhotos(), ['collection-10', 'collection-2']);
    await changePhotoSort(sort, '文件名 · 升序');
    await act(async () => container.querySelector('[aria-label="返回收藏相簿"]').click());
    assert.equal(homeSort().title, '相簿排序 · 相簿名 · 降序');
    assert.equal(cover().alt, 'collection-10');
  });
});

test('相簿首页与相簿内的排序分别记忆，收藏与作品重挂载后共用', async () => {
  const input = {
    groups,
    photos: ['collection', 'work'].flatMap((library) => ['10', '2'].map((name) => photo(library, name))),
    memberships: groups.flatMap(({ id, library }) => ['10', '2'].map((name, position) => ({
      groupId: id, photoId: `${library}-${name}`, status: 'active', position,
    }))),
  };
  const sort = (container) => albumSortTrigger(container);
  const cardNames = (container) => [...container.querySelectorAll('.album-open h2')].map((title) => title.textContent);
  const photoIds = (container) => [...container.querySelectorAll('[data-photo-id]')].map((item) => item.dataset.photoId);

  await scenario('collection', input, async ({ container }) => {
    await changeSort(sort(container), '相簿名 · 降序');
    await act(async () => container.querySelector('.album-open').click());
    await changePhotoSort(albumMore(container), '文件名 · 升序');
    await act(async () => container.querySelector('[aria-label="返回收藏相簿"]').click());
    assert.deepEqual(cardNames(container), ['collection-empty', 'collection-album']);
    await act(async () => container.querySelectorAll('.album-open')[1].click());
    await assertPhotoSort(albumMore(container), '文件名 · 升序');
    assert.deepEqual(photoIds(container), ['collection-2', 'collection-10']);
  });

  await scenario('work', input, async ({ container }) => {
    assert.equal(sort(container).title, '相簿排序 · 相簿名 · 降序');
    assert.deepEqual(cardNames(container), ['work-empty', 'work-album']);
    await act(async () => container.querySelector('.album-open').click());
    await assertPhotoSort(albumMore(container), '文件名 · 升序');
    assert.deepEqual(photoIds(container), ['work-2', 'work-10']);
    await changePhotoSort(albumMore(container), '加入顺序');
    assert.deepEqual(photoIds(container), ['work-10', 'work-2']);
  });

  await scenario('collection', input, async ({ container }) => {
    assert.equal(sort(container).title, '相簿排序 · 相簿名 · 降序');
    await act(async () => container.querySelector('.album-open').click());
    await assertPhotoSort(albumMore(container), '加入顺序');
    assert.deepEqual(photoIds(container), ['collection-10', 'collection-2']);
  });
});

test('已保存的无效相簿和照片排序分别使用默认值', async () => {
  window.localStorage.setItem('foliune.album-sort', 'membership');
  window.localStorage.setItem('foliune.photo-sort', 'constructor');
  await scenario('collection', mixed, async ({ container }) => {
    const sortTitle = () => albumSortTrigger(container).title;
    assert.equal(sortTitle(), '相簿排序 · 创建时间 · 由旧到新');
    await act(async () => container.querySelector('.album-open').click());
    await assertPhotoSort(albumMore(container), '拍摄时间 · 由新到旧');
  });
});

test('排序偏好写入失败时反馈错误，仍可在当前页排序并重试', async (t) => {
  const feedback = [];
  const storage = window.localStorage;
  const storageAccess = t.mock.getter(window, 'localStorage', () => ({
    getItem: (key) => storage.getItem(key),
    setItem() { throw new Error('写入被拒绝'); },
  }));
  await scenario('collection', mixed, async ({ container }) => {
    const sort = albumSortTrigger(container);
    await changeSort(sort, '相簿名 · 降序');
    assert.equal(sort.title, '相簿排序 · 相簿名 · 降序');
    assert.deepEqual(feedback, [['无法记住排序偏好', true]]);
    assert.equal(storage.getItem('foliune.album-sort'), null);
    storageAccess.mock.restore();
    await changeSort(sort, '相簿名 · 降序');
    assert.equal(window.localStorage.getItem('foliune.album-sort'), 'name-desc');
  }, { onFeedback: (...args) => feedback.push(args) });
});

test('作品按拍摄时间跨月连续排序，可选择地点分组，文件名及预览沿用当前序列', async () => {
  const photos = [
    { ...photo('work', '2'), title: '山', location: '甲', capturedAt: '2025-01-01T00:00:00Z' },
    { ...photo('work', '10'), title: '海', location: '甲', capturedAt: '2026-01-04T00:00:00Z' },
    { ...photo('work', '1'), title: '云', location: '乙', importedAt: '2025-02-02T00:00:00Z' },
    { ...photo('work', '9'), title: '风', location: '乙', capturedAt: '2025-12-03T09:00:00+08:00' },
  ];
  const input = {
    photos, groups: groups.filter(({ id }) => id === 'work-album'),
    memberships: photos.map(({ id }, position) => ({ groupId: 'work-album', photoId: id, status: 'active', position })),
  };
  let photoMenu;
  globalThis.captureAlbumTestMenu = ({ actions }) => { photoMenu = actions; };
  try {
    await scenario('work', input, async ({ container, plays }) => {
      const button = (label) => container.querySelector(`button[aria-label="${label}"]`);
      const more = () => act(async () => { button('相簿更多操作').focus(); button('相簿更多操作').click(); });
      const photoButton = (number) => container.querySelector(`[data-photo-id="work-${number}"] button`);
      const order = () => [...container.querySelectorAll('[data-photo-id]')].map((item) => item.dataset.photoId);
      const headings = () => container.querySelector('[data-testid="photo-canvas"]').getAttribute('data-section-headings');
      const ids = (...numbers) => numbers.map((number) => `work-${number}`);
      await act(async () => container.querySelector('.album-open').click());
      const sort = albumMore(container);
      await assertPhotoSort(sort, '拍摄时间 · 由新到旧');
      assert.deepEqual(order(), ids(10, 9, 1, 2));
      assert.equal(headings(), null);
      await changePhotoSort(sort, '拍摄时间 · 由旧到新');
      assert.deepEqual(order(), ids(2, 1, 9, 10));
      assert.equal(headings(), null);
      await changePhotoSort(sort, '拍摄时间 · 由新到旧');
      await more();
      assert.equal(radioGroup(menuFor(sort), '分组方式').querySelector('button[aria-checked="true"]').textContent, '不分组');
      await act(async () => [...radioGroup(menuFor(sort), '分组方式').querySelectorAll('button')].find((item) => item.textContent === '地点').click());
      assert.deepEqual(order(), ids(10, 2, 9, 1));
      assert.equal(headings(), '甲,乙');
      await changePhotoSort(sort, '拍摄时间 · 由旧到新');
      assert.deepEqual(order(), ids(1, 9, 2, 10));

      await act(async () => photoButton(9).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
      await act(async () => photoMenu.find((action) => action.id === 'select').run());
      await changePhotoSort(sort, '文件名 · 升序');
      assert.deepEqual(order(), ids(1, 2, 9, 10));
      assert.equal(headings(), null);
      await openAlbumMore(sort);
      await pressKey(document.activeElement, 'Escape');
      assert.equal(sort.getAttribute('aria-expanded'), 'false');
      assert.equal(document.activeElement, sort);
      assert.equal(photoButton(9).getAttribute('aria-pressed'), 'true');
      await pressKey(sort, 'Escape');
      assert.equal(photoButton(9).hasAttribute('aria-pressed'), false);
      await more();
      assert.equal(radioGroup(menuFor(sort), '分组方式'), null);
      await act(async () => [...menuFor(albumMore(container)).querySelectorAll('button')].find((item) => item.textContent === '欣赏').click());
      assert.deepEqual(plays, [ids(1, 2, 9, 10)]);
      await act(async () => button('总览').click());
      await act(async () => photoButton(2).click());
      const review = container.querySelector('[data-testid="photo-review"]');
      assert.equal(review.dataset.initialId, 'work-2');
      assert.deepEqual(review.dataset.reviewIds.split(','), ids(1, 2, 9, 10));
      await act(async () => review.querySelector('button').click());

      await act(async () => button('单张').click());
      assert.equal(shownImage(container).alt, '山');
      const otherThumbnail = container.querySelector('.album-filmstrip button[title="风"]');
      await act(async () => otherThumbnail.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
      await act(async () => photoMenu.find((action) => action.id === 'preview').run());
      const otherReview = container.querySelector('[data-testid="photo-review"]');
      assert.equal(otherReview.dataset.initialId, 'work-9');
      await act(async () => otherReview.querySelector('button').click());
      assert.equal(shownImage(container).alt, '风');
      assert.equal(document.activeElement, otherThumbnail);
      await changePhotoSort(sort, '文件名 · 降序');
      assert.deepEqual([...container.querySelectorAll('.album-filmstrip button')].map((item) => item.title), ['海', '风', '山', '云']);
      assert.equal(shownImage(container).alt, '风');
      await openAlbumMore(sort);
      await act(async () => photoSortOptions(menuFor(albumMore(container)))[0].focus());
      await pressKey(document.activeElement, 'ArrowLeft');
      assert.equal(shownImage(container).alt, '风');
      await pressKey(document.activeElement, 'Escape');
      assert.equal(document.activeElement, sort);
      assert.equal(sort.getAttribute('aria-expanded'), 'false');
      await act(async () => button('展览').click());
      assert.deepEqual(order(), ids(10, 9, 2, 1));
      await changePhotoSort(sort, '拍摄时间 · 由旧到新');
      assert.deepEqual(order(), ids(1, 9, 2, 10));
      await more();
      assert.equal(radioGroup(menuFor(sort), '分组方式').querySelector('button[aria-checked="true"]').textContent, '地点');
      await act(async () => [...radioGroup(menuFor(sort), '分组方式').querySelectorAll('button')].find((item) => item.textContent === '不分组').click());
      assert.deepEqual(order(), ids(2, 1, 9, 10));
      assert.equal(headings(), null);
    });
  } finally { delete globalThis.captureAlbumTestMenu; }
});

function typeQuery(container, query) {
  const input = container.querySelector('#global-search-input');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, query);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

test('全图库搜索预览只挂前三张，大图及查看全部继续包含两个图库的已归属、已废弃和无归属照片', async () => {
  await scenario('search', mixed, async ({ container }) => {
    const visiblePhotoIds = () => [...container.querySelectorAll('[data-photo-id]')].map(photo => photo.dataset.photoId);
    const input = container.querySelector('#global-search-input');
    assert.equal(document.activeElement, input);
    assert.equal(container.querySelector('.search-results'), null);
    await act(async () => typeQuery(container, ' SHARED '));
    assert.deepEqual(visiblePhotoIds(), mixed.photos.slice(0, 3).map(photo => photo.id));
    assert.deepEqual([...container.querySelectorAll('.search-group')].map(group => group.getAttribute('aria-label')), ['照片']);
    await act(async () => container.querySelector('[data-photo-id] button').click());
    const review = container.querySelector('[data-testid="photo-review"]');
    assert.equal(review.dataset.initialId, mixed.photos[0].id);
    assert.deepEqual(review.dataset.reviewIds.split(','), mixed.photos.map(photo => photo.id));
    await act(async () => review.querySelector('button').click());
    await act(async () => container.querySelector('[aria-label="查看全部照片"]').click());
    assert.deepEqual(visiblePhotoIds(), mixed.photos.map(photo => photo.id));
    assert.equal(container.querySelector('.photo-count').textContent, '6');
    assert.equal(document.activeElement.dataset.searchCategory, 'photos');
    assert.equal(input.value, ' SHARED ');
  });
});

test('搜索预览和完整结果全选各自范围，批量操作沿用结果顺序', async () => {
  let actions;
  globalThis.captureAlbumTestMenu = (menu) => { actions = menu.actions; };
  try {
    await scenario('search', mixed, async ({ container, plays }) => {
      const photoButton = () => container.querySelector('[data-photo-id] button');
      const selectionMore = () => container.querySelector('[data-testid="selection-more"]');
      const action = (id) => actions.find((item) => item.id === id);
      const run = (id) => act(async () => { assert.ok(action(id).allowed()); action(id).run(); });
      const click = (target) => act(async () => target.click());
      await act(async () => typeQuery(container, 'shared'));
      await act(async () => photoButton().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
      assert.equal(action('select-all').text, '全选预览照片');
      await run('select-all');
      await click(selectionMore());
      await run('play');
      assert.deepEqual(plays[0], mixed.photos.slice(0, 3).map(({ id }) => id));
      assert.equal(action('select-all').text, '取消全选');
      await run('select-all');
      assert.equal(selectionMore(), null);

      await click(container.querySelector('[aria-label="查看全部照片"]'));
      const select = () => [...container.querySelectorAll('.search-group-heading .text-button')].find((item) => item.textContent.endsWith('全选'));
      assert.equal(select().textContent, '全选');
      await click(select());
      await click(selectionMore());
      await run('play');
      assert.deepEqual(plays[1], mixed.photos.map(({ id }) => id));
      assert.equal(select().textContent, '取消全选');
      await click(select());
      assert.equal(selectionMore(), null);
    });
  } finally { delete globalThis.captureAlbumTestMenu; }
});

test('从搜索照片墙右击全屏，切图后仍按原位置恢复搜索照片墙', async () => {
  let actions, restored;
  globalThis.captureAlbumTestMenu = (menu) => { actions = menu.actions; };
  globalThis.captureAlbumTestWallRestore = (restore) => { restored = restore; };
  try {
    await scenario('search', mixed, async ({ container }) => {
      await act(async () => typeQuery(container, 'shared'));
      const trigger = container.querySelector('[data-photo-index="1"] button');
      container.scrollTop = 230;
      await act(async () => trigger.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
      const index = actions.findIndex(({ id }) => id === 'preview');
      assert.deepEqual(actions.slice(index, index + 2).map(({ text }) => text), ['查看大图', '全屏查看']);
      await act(async () => actions[index + 1].run());
      const review = container.querySelector('[data-testid="photo-review"]');
      assert.equal(review.dataset.fullscreenEntry, 'direct');
      assert.equal(review.dataset.initialId, mixed.photos[1].id);
      assert.deepEqual(review.dataset.reviewIds.split(','), mixed.photos.map(({ id }) => id));
      review.dataset.visibleId = mixed.photos.at(-1).id;
      container.scrollTop = 40;
      await act(async () => review.querySelector('button').click());
      assert.equal(container.querySelector('[data-testid="photo-review"]'), null);
      assert.equal(restored.id, mixed.photos[1].id);
      assert.equal(restored.scrollTop, 230);
      assert.equal(restored.focus, trigger);
    });
  } finally {
    delete globalThis.captureAlbumTestMenu;
    delete globalThis.captureAlbumTestWallRestore;
  }
});

test('宽窗混合结果预览六张，缩回窄窗保留可见选择并转移被隐藏照片的焦点', async () => {
  const originalViewport = { width: window.innerWidth, height: window.innerHeight };
  const viewport = (width) => window.happyDOM.setViewport({ width, height: 880 });
  const photos = [...mixed.photos, photo('work', 'seventh'), photo('work', 'eighth')]
    .map((item) => ({ ...item, annotation: 'only photos' }));
  let photoMenu;
  globalThis.captureAlbumTestMenu = ({ actions }) => { photoMenu = actions; };
  globalThis.searchFixture = { books: () => [{ id: 'book', title: 'Shared', coverPhotoId: null }] };
  try {
    viewport(949);
    await scenario('search', { ...mixed, photos }, async ({ container }) => {
      const preview = () => [...container.querySelectorAll('[data-photo-id]')].map((item) => item.dataset.photoId);
      const button = (index) => container.querySelector(`[data-photo-index="${index}"] button`);
      const viewAll = () => container.querySelector('[aria-label="查看全部照片"]');
      await act(async () => typeQuery(container, 'shared'));
      assert.deepEqual(preview(), photos.slice(0, 3).map((item) => item.id));
      await act(async () => viewport(1320));
      assert.deepEqual(preview(), photos.slice(0, 6).map((item) => item.id));
      await act(async () => button(5).click());
      const review = container.querySelector('[data-testid="photo-review"]');
      assert.equal(review.dataset.initialId, photos[5].id);
      assert.deepEqual(review.dataset.reviewIds.split(','), photos.map((item) => item.id));
      await act(async () => review.querySelector('button').click());
      await act(async () => button(0).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
      await act(async () => photoMenu.find((action) => action.id === 'select').run());
      await act(async () => { button(5).focus(); button(5).click(); });
      assert.equal(button(5).getAttribute('aria-pressed'), 'true');
      await act(async () => viewport(949));
      assert.equal(document.activeElement, viewAll());
      assert.equal(button(0).getAttribute('aria-pressed'), 'true');
      assert.equal(button(5), null);
      await act(async () => viewport(1320));
      assert.equal(button(0).getAttribute('aria-pressed'), 'true');
      assert.equal(button(5).getAttribute('aria-pressed'), 'false');
      await act(async () => viewAll().click());
      assert.deepEqual(preview(), photos.map((item) => item.id));
      await act(async () => container.querySelector('[data-search-category="all"]').click());
      await act(async () => typeQuery(container, 'only photos'));
      assert.deepEqual(preview(), photos.slice(0, 3).map((item) => item.id));
    });
  } finally {
    delete globalThis.captureAlbumTestMenu;
    delete globalThis.searchFixture;
    window.happyDOM.setViewport(originalViewport);
  }
});

const searchPlans = [{
  id: 'shoot', title: '人像习作', executionDate: '2026-11-05', updatedAt: '2026-11-05T12:00:00Z', references: [],
  parts: [{ title: '树林', shotList: '历史自由清单', references: [], shots: [{
    title: '逆光肖像', references: [{ id: 'ref', photoId: 'collection-loose', intent: '短焦透过树叶拍摄林间虚化。' }],
  }] }],
}];
const searchBooks = Array.from({ length: 4 }, (_, index) => ({ id: `book-${index}`, title: `林间摄影集 ${index + 1}`, coverPhotoId: 'collection-loose' }));
const searchModels = [{ id: 'model-1', name: '山岚', city: '杭州', tags: ['林间'], coverPhotoId: 'work-loose' }];

test('统一搜索独立读取、重试和筛选，策划显示深层命中片段', async () => {
  let modelReads = 0;
  let failModel;
  globalThis.searchFixture = {
    books: () => searchBooks,
    models: () => (++modelReads === 1 ? new Promise((_, reject) => { failModel = reject; }) : searchModels),
    plans: () => searchPlans,
  };
  const loose = { ...mixed.photos.find((photo) => photo.id === 'collection-loose'), source: '林间采集', regions: [{ text: '左侧阴影' }] };
  const library = { ...mixed, photos: mixed.photos.map((photo) => photo.id === loose.id ? loose : photo) };
  try {
    await scenario('search', library, async ({ container }) => {
      assert.equal(modelReads, 0, '未输入时不加载各分类');
      await act(async () => typeQuery(container, '林间'));
      const groupNames = () => [...container.querySelectorAll('.search-group')].map(group => group.getAttribute('aria-label'));
      assert.deepEqual(groupNames(), ['照片', '画册', '策划']);
      assert.match(container.querySelector('.search-loading').textContent, /正在读取模特/);
      assert.equal(container.querySelectorAll('[data-search-result^="books:"]').length, 3);
      assert.ok(container.querySelector('[aria-label="查看全部画册"]'));
      assert.equal(container.querySelector('[aria-label="查看全部策划"]'), null, '已经完整显示的分组不重复提供入口');
      assert.equal(container.querySelector('[data-search-result^="books:"] img').getAttribute('src'), loose.thumbnailUrl);
      assert.match(container.querySelector('[data-search-result^="planning:"] .search-result-detail').textContent, /树林 · 逆光肖像 · 参考意图：.*林间/);
      await act(async () => failModel(new Error('索引不可读')));
      assert.match(container.querySelector('[role="alert"]').textContent, /无法读取模特：索引不可读/);
      assert.deepEqual(groupNames(), ['照片', '画册', '策划']);
      await act(async () => container.querySelector('[data-search-category="models"]').click());
      assert.equal(container.querySelector('.empty-state'), null, '读取失败不会冒充无匹配');
      await act(async () => container.querySelector('[aria-label="重新读取模特"]').click());
      assert.equal(modelReads, 2);
      assert.deepEqual(groupNames(), ['模特']);
      assert.match(container.querySelector('[data-search-result^="models:"]').textContent, /山岚.*杭州/);
      await act(async () => container.querySelector('[data-search-category="all"]').click());
      await act(async () => container.querySelector('[aria-label="查看全部画册"]').click());
      assert.equal(container.querySelectorAll('[data-search-result^="books:"]').length, 4);
      await act(async () => container.querySelector('[data-search-category="all"]').click());
      await act(async () => typeQuery(container, '左侧阴影'));
      assert.deepEqual(groupNames(), ['照片']);
      assert.equal(container.querySelector('[data-photo-id]').dataset.photoId, loose.id);
      await act(async () => typeQuery(container, '人像习作'));
      assert.equal(container.querySelector('.search-result-detail'), null, '标题直接命中无需重复');
      await act(async () => typeQuery(container, '历史自由清单'));
      assert.match(container.querySelector('.empty-state').textContent, /没有匹配结果/);
    });
  } finally { delete globalThis.searchFixture; }
});

test('搜索返回保持词、分类、滚动和结果焦点，已失效的结果回到搜索框', async () => {
  let books = searchBooks;
  let readBooks = () => books;
  globalThis.searchFixture = { books: () => readBooks() };
  try {
    await scenario('search', mixed, async ({ container, renderSnapshot, session }) => {
      const result = () => container.querySelector('[data-search-result="books:book-3"]');
      Object.defineProperties(container, { clientHeight: { value: 200 }, scrollHeight: { value: 600 } });
      await act(async () => typeQuery(container, '林间'));
      await act(async () => container.querySelector('[aria-label="查看全部画册"]').click());
      await act(async () => { container.scrollTop = 120; result().click(); });
      assert.deepEqual(session, { query: '林间', category: 'books', scrollTop: 120, focusResult: 'books:book-3' });
      assert.equal(container.scrollTop, 0);
      let finishRead;
      readBooks = () => new Promise(resolve => { finishRead = resolve; });
      await renderSnapshot();
      assert.equal(document.activeElement.id, 'global-search-input', '等待数据时仍可直接输入');
      await act(async () => finishRead(books));
      assert.equal(container.querySelector('#global-search-input').value, '林间');
      assert.equal(container.querySelector('[data-search-category="books"]').getAttribute('aria-pressed'), 'true');
      assert.equal(container.scrollTop, 120);
      assert.equal(document.activeElement, result());
      await act(async () => result().click());
      books = books.slice(0, 3);
      readBooks = () => books;
      await renderSnapshot();
      assert.equal(result(), null);
      assert.equal(document.activeElement.id, 'global-search-input');
      assert.equal(container.scrollTop, 0);
      assert.equal(session.focusResult, undefined);
    });
  } finally { delete globalThis.searchFixture; }
});

test('后到的分组补足高度后恢复滚动与结果焦点，无需等待更慢的无关分类', async () => {
  let finishModels;
  let finishPlans;
  globalThis.searchFixture = {
    books: () => searchBooks,
    models: () => new Promise(resolve => { finishModels = resolve; }),
    plans: () => new Promise(resolve => { finishPlans = resolve; }),
  };
  const session = { query: '林间', category: 'all', scrollTop: 120, focusResult: 'books:book-0' };
  try {
    await scenario('search', mixed, async ({ container }) => {
      const model = () => container.querySelector('[data-search-result^="models:"]');
      const book = () => container.querySelector('[data-search-result="books:book-0"]');
      Object.defineProperties(container, {
        clientHeight: { value: 200 },
        scrollHeight: { get: () => model() ? 600 : 240 },
      });
      assert.ok(book());
      assert.equal(document.activeElement.id, 'global-search-input');
      await act(async () => finishModels(searchModels));
      assert.match(container.querySelector('.search-loading').textContent, /正在读取策划/);
      assert.equal(container.scrollTop, 120);
      assert.equal(document.activeElement, book());
      await act(async () => finishPlans(searchPlans));
      assert.equal(document.activeElement, book());
    }, { session });
  } finally { delete globalThis.searchFixture; }
});

test('中文输入法预编辑不改已提交查询、分类与滚动，组词结束才切换匹配', async () => {
  await scenario('search', mixed, async ({ container, session }) => {
    const input = container.querySelector('#global-search-input');
    await act(async () => typeQuery(container, 'shared'));
    await act(async () => container.querySelector('[data-search-category="photos"]').click());
    await act(async () => { container.scrollTop = 80; input.focus(); });
    await act(async () => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      typeQuery(container, 'lin');
    });
    assert.equal(input.value, 'lin');
    assert.equal(session.query, 'shared');
    assert.equal(session.category, 'photos');
    assert.equal(container.scrollTop, 80);
    assert.equal(container.querySelectorAll('[data-photo-id]').length, mixed.photos.length);
    await act(async () => {
      typeQuery(container, '林间');
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '林间' }));
    });
    assert.equal(session.query, '林间');
    assert.equal(container.scrollTop, 0);
    assert.match(container.querySelector('.empty-state').textContent, /没有匹配的照片/);
  });
});

test('相簿冷开等待首屏或短上限，旧就绪信号不能启动下一次过渡', async (t) => {
  const animations = trackAnimations(t);
  let wallReady;
  let alreadyReady = false;
  globalThis.captureAlbumTestWallReveal = (callback) => {
    wallReady = callback;
    if (alreadyReady) callback?.([]);
  };
  try {
    await scenario('collection', mixed, async ({ container }) => {
      const open = () => act(async () => container.querySelector('.album-open').click());
      const back = () => act(async () => container.querySelector('button[aria-label="返回收藏相簿"]').click());
      await open();
      const held = animations.slice(-2);
      assert.equal(container.querySelector('.album-detail-header h1').textContent, 'collection-album');
      assert.ok(held.every(({ paused, handle }) => paused && handle.currentTime === 0));
      const stale = wallReady;
      await back();
      assert.ok(held.every(({ canceled }) => canceled));

      await open();
      const next = animations.slice(-2);
      stale([]);
      assert.ok(next.every(({ paused, plays }) => paused && plays === 0));
      wallReady([container.querySelector('[data-photo-index]')]);
      wallReady([]);
      assert.ok(next.every(({ plays }) => plays === 1));

      await back();
      await open();
      const timed = animations.slice(-2);
      assert.ok(timed.every(({ paused }) => paused));
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      assert.ok(timed.every(({ plays }) => plays === 1));
      wallReady([]);
      assert.ok(timed.every(({ plays }) => plays === 1));

      await back();
      alreadyReady = true;
      await open();
      const immediate = animations.slice(-2);
      assert.ok(immediate.every(({ paused }) => !paused), '子组件提交中已经报告排版就绪时立即播放');
    }, { withMain: true });
  } finally { delete globalThis.captureAlbumTestWallReveal; }
});

test('相簿单张按既有顺序浏览，菜单和弹窗隔离方向键，搜索保留墙面模式', async () => {
  const input = {
    ...mixed,
    photos: [...mixed.photos, photo('collection', 'third')],
    memberships: [
      ...mixed.memberships,
      { groupId: 'collection-album', photoId: 'collection-third', status: 'active', position: 2 },
      { groupId: 'collection-album', photoId: 'collection-loose', status: 'active', position: 1 },
    ],
  };
  await scenario('collection', input, async ({ container }) => {
    const button = label => container.querySelector(`button[aria-label="${label}"]`);
    const thumb = () => container.querySelector('.album-filmstrip [aria-current="true"]');
    const key = async (key, target = document.activeElement) => act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    await act(async () => container.querySelector('.album-open').click());
    assert.deepEqual([...container.querySelectorAll('.album-view-options button')].map(item => item.getAttribute('aria-label')), ['展览', '总览', '单张']);
    assert.equal(button('展览').getAttribute('aria-pressed'), 'true');
    await act(async () => button('单张').click());
    assert.equal(button('单张').getAttribute('aria-pressed'), 'true');
    assert.equal(container.querySelector('[data-testid="photo-canvas"]'), null);
    assert.deepEqual([...container.querySelectorAll('.album-filmstrip button')].map(item => item.title), ['collection-active', 'collection-loose', 'collection-third']);
    assert.equal(shownImage(container).alt, 'collection-active');

    await act(async () => thumb().focus());
    await key('ArrowLeft');
    assert.equal(thumb().title, 'collection-active');
    await key('ArrowRight');
    assert.equal(thumb().title, 'collection-loose');
    assert.equal(document.activeElement, thumb());
    await act(async () => container.querySelector('button[title="collection-third"]').click());
    await key('ArrowRight');
    assert.equal(shownImage(container).alt, 'collection-third');

    await act(async () => { button('相簿更多操作').focus(); button('相簿更多操作').click(); });
    assert.equal(menuFor(albumMore(container)).textContent.includes('显示方式'), false);
    assert.match(menuFor(albumMore(container)).textContent, /导入照片.*欣赏.*查看已废弃/);
    await key('ArrowLeft');
    assert.equal(thumb().title, 'collection-third');
    await key('Escape');
    const dialog = document.createElement('dialog');
    container.append(dialog);
    dialog.setAttribute('open', '');
    await key('ArrowLeft');
    assert.equal(thumb().title, 'collection-third');
    dialog.remove();
    await key('ArrowLeft');
    assert.equal(thumb().title, 'collection-loose');

    await act(async () => button('展览').click());
    assert.equal(thumb(), null);
    await act(async () => button('单张').click());
    assert.equal(thumb().title, 'collection-loose');
    await act(async () => button('返回收藏相簿').click());
    await act(async () => container.querySelector('.album-open').click());
    assert.equal(thumb().title, 'collection-active');
  });
  await scenario('search', mixed, async ({ container }) => {
    await act(async () => typeQuery(container, 'shared'));
    await act(async () => container.querySelector('[data-search-category="photos"]').click());
    assert.equal(container.querySelector('button[aria-label="单张"]'), null);
    assert.equal(container.querySelector('button[aria-label="展览"]').getAttribute('aria-pressed'), 'true');
  });
});

test('万张单张浏览只挂载窗口和焦点，手动滚动保留大图，远端仍可选择与右键', async () => {
  const photos = Array.from({ length: 10_000 }, (_, index) => photo('collection', `frame-${index}`));
  const input = {
    photos,
    groups,
    memberships: photos.map((item, position) => ({ groupId: 'collection-album', photoId: item.id, status: 'active', position })),
  };
  const menus = [];
  globalThis.captureAlbumTestMenu = (menu) => menus.push(menu);
  try {
    await scenario('collection', input, async ({ container, plays }) => {
      await act(async () => container.querySelector('.album-open').click());
      await act(async () => container.querySelector('button[aria-label="单张"]').click());
      const strip = container.querySelector('.album-filmstrip');
      const thumbnail = (index) => strip.querySelector(`button[data-photo-index="${index}"]`);
      const current = () => strip.querySelector('button[aria-current="true"]');
      const currentTitle = () => shownImage(container).alt;
      const scroll = (left) => act(async () => {
        strip.scrollLeft = left;
        strip.dispatchEvent(new Event('scroll'));
        await new Promise(resolve => window.requestAnimationFrame(resolve));
      });
      const key = (key) => act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
      const assertWindow = () => assert.ok(strip.querySelectorAll('button').length <= 20);
      assertWindow();
      assert.equal(current(), thumbnail(0));
      assert.equal(thumbnail(5000), null);

      await scroll(5000 * filmstripPitch);
      const far = thumbnail(5000);
      assert.ok(far);
      assert.equal(current(), thumbnail(0));
      assert.equal(currentTitle(), photos[0].title);
      await act(async () => far.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })));
      assert.equal(menus[0].scope, 'photo');
      assert.equal(menus[0].trigger, far);
      assert.equal(document.activeElement, far);
      assert.equal(current(), thumbnail(0));

      const end = photos.length * filmstripPitch - strip.clientWidth;
      await scroll(end);
      assertWindow();
      assert.ok(thumbnail(9999));
      assert.equal(thumbnail(5000), far, '虚拟窗口之外的菜单焦点仍可恢复');
      assert.equal(current(), thumbnail(0));
      await key('ArrowRight');
      assert.equal(current(), thumbnail(1));
      assert.equal(currentTitle(), photos[1].title);
      assert.equal(document.activeElement, current());
      assert.ok(strip.scrollLeft < filmstripPitch * 2);
      assert.equal(thumbnail(5000), null);

      await scroll(end);
      await act(async () => thumbnail(9999).click());
      assert.equal(current(), thumbnail(9999));
      assert.equal(currentTitle(), photos[9999].title);
      await key('ArrowRight');
      assert.equal(current(), thumbnail(9999));
      await key('ArrowLeft');
      assert.equal(current(), thumbnail(9998));
      assert.equal(document.activeElement, current());
      assertWindow();

      const selectionItem = (label) => [...menuFor(albumMore(container)).querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === label);
      await openAlbumMore(albumMore(container));
      await act(async () => selectionItem('全选').click());
      assertWindow();
      assert.match(current().getAttribute('aria-label'), /已选择/);
      const more = () => container.querySelector('[data-testid="selection-more"]');
      await act(async () => more().click());
      const play = menus.at(-1).actions.find((item) => item.id === 'play');
      assert.equal(play.text, '欣赏 · 10000 张');
      await act(async () => play.run());
      assert.deepEqual(plays[0], photos.map(({ id }) => id));
      await openAlbumMore(albumMore(container));
      await act(async () => selectionItem('取消全选').click());
      assert.doesNotMatch(current().getAttribute('aria-label'), /已选择/);
      assert.equal(more(), null);
    });
  } finally { delete globalThis.captureAlbumTestMenu; }
});

test('单张保留已显示照片至解码就绪，快速反向、舞台菜单和错误重定位跟随正确照片', async () => {
  const photos = ['first', 'second', 'third'].map(suffix => photo('collection', suffix));
  const input = { photos, groups, memberships: photos.map((item, position) => ({ groupId: 'collection-album', photoId: item.id, status: 'active', position })) };
  const menus = [];
  globalThis.captureAlbumTestMenu = (menu) => menus.push(menu);
  try {
    await scenario('collection', input, async ({ container, relinks, renderSnapshot }) => {
      await act(async () => container.querySelector('.album-open').click());
      await act(async () => container.querySelector('button[aria-label="单张"]').click());
      autoLoadStage = false;
      const stage = container.querySelector('.album-single-stage');
      const firstOriginal = shownImage(container);
      const thumb = () => container.querySelector('.album-filmstrip [aria-current="true"]');
      const status = () => container.querySelector('.album-single-view > [role="status"]').textContent;
      const key = (key) => act(async () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
      const menu = async (target = stage) => {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
        await act(async () => target.dispatchEvent(event));
        assert.equal(event.defaultPrevented, true);
      };
      await act(async () => thumb().focus());
      await key('ArrowRight');
      const stale = incomingImage(container);
      let completeStale;
      pendingDecodes.set(stale, new Promise(resolve => { completeStale = resolve; }));
      await act(async () => stale.dispatchEvent(new Event('load')));
      assert.equal(shownImage(container).alt, photos[0].title);
      assert.equal(thumb().title, photos[0].title);
      assert.match(status(), /1 \/ 3/);
      assert.equal(stage.querySelector('.photo-review-loading'), null);
      await menu();
      assert.equal(menus.at(-1).trigger, thumb());
      assert.equal(menus.at(-1).trigger.title, photos[0].title);

      await key('ArrowRight');
      assert.equal(incomingImage(container).alt, photos[2].title);
      await key('ArrowLeft');
      const target = incomingImage(container);
      assert.notEqual(target, stale);
      assert.equal(target.alt, photos[1].title);
      await act(async () => completeStale());
      assert.equal(shownImage(container).alt, photos[0].title);
      await act(async () => target.dispatchEvent(new Event('load')));
      assert.equal(shownImage(container), target, '交接直接复用已解码的展示节点');
      assert.equal(thumb().title, photos[1].title);
      assert.equal(document.activeElement, thumb());
      assert.match(status(), /2 \/ 3/);
      assert.equal(stage.querySelector('.photo-review-frame-outgoing img'), firstOriginal);
      const menuCount = menus.length;
      await menu();
      assert.equal(menus.length, menuCount, '旧图仍在淡出时，舞台不打开其他照片的菜单');
      await menu(thumb());
      assert.equal(menus.length, menuCount + 1, '淡出期间缩略图仍可打开菜单');
      assert.equal(menus.at(-1).trigger, thumb());
      assert.equal(menus.at(-1).trigger.title, photos[1].title);

      await key('ArrowLeft');
      assert.equal(shownImage(container), firstOriginal, '反向切回直接复用仍在淡出的已解码原图');
      assert.equal(incomingImage(container), null);
      assert.equal(stage.querySelector('.photo-review-frame-outgoing'), null);
      assert.equal(stage.querySelector('.photo-review-loading'), null);
      assert.equal(thumb().title, photos[0].title);
      assert.match(status(), /1 \/ 3/);
      await menu();
      assert.equal(menus.at(-1).trigger, thumb());
      assert.equal(menus.at(-1).trigger.title, photos[0].title);

      await key('ArrowRight');
      await act(async () => incomingImage(container).dispatchEvent(new Event('load')));
      assert.equal(stage.querySelector('.photo-review-frame-outgoing img'), firstOriginal);
      await renderSnapshot({ ...input, photos: [{ ...photos[0], originalUrl: '/relinked-first.jpg' }, ...photos.slice(1)] });
      await key('ArrowLeft');
      assert.equal(shownImage(container).alt, photos[1].title);
      assert.equal(incomingImage(container).getAttribute('src'), '/relinked-first.jpg', '地址变化时重新准备，不能复用旧原图');
      await act(async () => incomingImage(container).dispatchEvent(new Event('load')));
      assert.equal(shownImage(container).getAttribute('src'), '/relinked-first.jpg');

      await key('ArrowRight');
      await key('ArrowRight');
      await act(async () => incomingImage(container).dispatchEvent(new Event('error')));
      assert.equal(shownImage(container), null);
      assert.match(stage.textContent, /图片无法读取/);
      assert.equal(thumb().title, photos[2].title);
      await act(async () => stage.querySelector('.missing-photo button').click());
      assert.deepEqual(relinks, [photos[2].id]);
      await act(async () => incomingImage(container).dispatchEvent(new Event('load')));
      assert.equal(shownImage(container).alt, photos[2].title);
      assert.equal(stage.querySelector('.missing-photo'), null);
    });
  } finally {
    autoLoadStage = true;
    delete globalThis.captureAlbumTestMenu;
  }
});

function trackAnimations(t) {
  const animations = [];
  t.mock.method(window.Element.prototype, 'animate', function (frames, options) {
    const animation = { element: this, frames, options, scrollTop: this.closest('main')?.scrollTop, canceled: false, paused: false, plays: 0 };
    let finish;
    const finished = new Promise((resolve) => { finish = resolve; });
    const handle = {
      finished,
      pause: () => { animation.paused = true; },
      play: () => { animation.plays++; },
      cancel: () => { animation.canceled = true; finish(); },
    };
    animations.push(Object.assign(animation, { handle }));
    return handle;
  });
  return animations;
}

test('相簿进出时标题与内容同向滑入，恢复滚动后再开始，快速往返取消旧动画', async (t) => {
  const animations = trackAnimations(t);
  await scenario('collection', mixed, async ({ container, renderSnapshot }) => {
    const open = (id) => act(async () => container.querySelector(`.album-open[aria-label^="打开相簿 ${id}，"]`).click());
    const back = () => act(async () => container.querySelector('button[aria-label="返回收藏相簿"]').click());
    const assertSlide = (offset, scrollTop, selectors) => {
      const batch = animations.slice(-2);
      assert.deepEqual(batch.map(({ element }) => element), selectors.map((selector) => container.querySelector(selector)));
      for (const animation of batch) {
        assert.deepEqual(animation.frames, [{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }]);
        assert.equal(animation.options.duration, 240);
        assert.equal(animation.scrollTop, scrollTop);
      }
      return batch;
    };

    assert.deepEqual(animations, []);
    container.scrollTop = 240;
    await open('collection-album');
    const entering = assertSlide(20, 0, ['.album-detail-header', '.virtual-photo-wall, .album-single-view']);
    assert.equal(container.querySelector('.album-overview'), null);
    await renderSnapshot();
    assert.equal(animations.length, 2);

    await back();
    assert.ok(entering.every(({ canceled }) => canceled));
    assert.equal(container.querySelector('.album-detail-header'), null);
    const returning = assertSlide(-20, 240, ['.workspace-home-intro', '.album-overview']);

    await open('collection-empty');
    assert.ok(returning.every(({ canceled }) => canceled));
    assertSlide(20, 0, ['.album-detail-header', '.empty-state']);
    assert.match(container.querySelector('.empty-state').textContent, /相簿为空/);
    assert.equal(animations.length, 6);
  }, { withMain: true });
});

test('相簿内切换视图仍只淡入，重复点击当前视图不播放，返回取消淡入', async (t) => {
  let wallReveal;
  const animations = trackAnimations(t);
  globalThis.captureAlbumTestWallReveal = (callback) => { wallReveal = callback; };
  try {
    await scenario('collection', mixed, async ({ container, renderSnapshot }) => {
      const button = (label) => container.querySelector(`button[aria-label="${label}"]`);
      await act(async () => container.querySelector('.album-open').click());
      const entering = animations.slice();
      const target = button('展览').getAttribute('aria-pressed') === 'true' ? button('总览') : button('展览');
      await act(async () => target.click());
      assert.ok(entering.every(({ canceled }) => canceled));
      const first = wallReveal;
      const tile = container.querySelector('[data-photo-index]');
      const beforeWall = animations.length;
      await act(async () => { first([tile]); first([tile]); });
      assert.equal(animations.length, beforeWall + 1);
      const wall = animations.at(-1);
      assert.equal(wall.element, tile);
      assert.deepEqual(wall.frames, [{ opacity: .76 }, { opacity: 1 }]);
      assert.equal(wall.options.duration, 180);
      await renderSnapshot();
      assert.equal(animations.at(-1), wall);

      await act(async () => button('单张').click());
      assert.equal(wall.canceled, true);
      const single = animations.at(-1);
      assert.equal(single.element, container.querySelector('.album-single-view'));
      await act(async () => button('单张').click());
      assert.equal(animations.at(-1), single);
      assert.equal(single.canceled, false);
      await act(async () => button('返回收藏相簿').click());
      assert.equal(single.canceled, true);
      assert.equal(animations.at(-1).element, container.querySelector('.album-overview'));
    }, { withMain: true });
  } finally { delete globalThis.captureAlbumTestWallReveal; }
});

test('减少动态效果会停止相簿滑入，并跳过之后的过渡', async (t) => {
  const animations = trackAnimations(t);
  const preference = new window.EventTarget();
  preference.matches = false;
  const matchMedia = window.matchMedia;
  t.mock.method(window, 'matchMedia', (query) => query === '(prefers-reduced-motion: reduce)' ? preference : matchMedia.call(window, query));
  await scenario('work', mixed, async ({ container }) => {
    await act(async () => container.querySelector('.album-open').click());
    assert.equal(animations.length, 2);
    preference.matches = true;
    preference.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
    assert.ok(animations.every(({ canceled }) => canceled));

    await act(async () => container.querySelector('button[aria-label="返回作品相簿"]').click());
    assert.equal(animations.length, 2);
    assert.ok(container.querySelector('.album-overview'));
    assert.equal(container.querySelector('.album-detail-header'), null);
  }, { withMain: true });
});

test('相簿更多与列表排序在菜单定位前结束位移', async (t) => {
  const animations = trackAnimations(t);
  const measured = [];
  const measure = window.Element.prototype.getBoundingClientRect;
  t.mock.method(window.Element.prototype, 'getBoundingClientRect', function () {
    if (this.matches('button[aria-label="相簿更多操作"], button[aria-label^="相簿排序 ·"]')) {
      const animation = animations.findLast(({ element }) => element === this.closest('header'));
      measured.push(animation?.canceled);
    }
    return measure.call(this);
  });
  await scenario('collection', mixed, async ({ container }) => {
    await act(async () => container.querySelector('.album-open').click());
    await act(async () => container.querySelector('button[aria-label="相簿更多操作"]').click());
    assert.ok(document.querySelector('[role="menu"][aria-label="相簿操作"]'));
    await act(async () => container.querySelector('button[aria-label="返回收藏相簿"]').click());
    await act(async () => container.querySelector('button[aria-label^="相簿排序 ·"]').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    ));
    assert.ok(document.querySelector('[role="menu"][aria-label="相簿排序"]'));
    assert.ok(measured.length >= 2);
    assert.ok(measured.every(Boolean));
  }, { withMain: true });
});

test('搜索改词取消未就绪的视图过渡，改回原词也不补播', async (t) => {
  let wallReveal;
  const animate = t.mock.method(window.Element.prototype, 'animate');
  globalThis.captureAlbumTestWallReveal = (callback) => { wallReveal = callback; };
  try {
    await scenario('search', mixed, async ({ container }) => {
      await act(async () => container.querySelector('.search-group-heading .segmented [aria-pressed="false"]').click());
      const stale = wallReveal;
      assert.equal(typeof stale, 'function');
      await act(async () => typeQuery(container, 'collection'));
      assert.equal(wallReveal, undefined);
      await act(async () => typeQuery(container, 'shared'));
      assert.equal(wallReveal, undefined);
      await act(async () => stale([container.querySelector('[data-photo-index]')]));
      assert.equal(animate.mock.callCount(), 0);
    }, { session: { query: 'shared', category: 'photos', scrollTop: 0 } });
  } finally { delete globalThis.captureAlbumTestWallReveal; }
});
