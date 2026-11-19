import './fixtures/chinese-interface.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window();
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'document' ? window.document : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: { contents: "export { useWorksMapRegionCoverMenu } from './use-works-map-region-cover-menu'; export { WorksMapThumbnail } from './WorksMapThumbnail';", resolveDir: resolve('apps/desktop/src/features/works-map') },
  external: ['../use-context-menu'], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent',
});
let current;
const fakeRequire = name => name === '../use-context-menu' ? {
  useContextMenu: (scope, context, onError) => async (actions, at, trigger) => current.menus.push({ scope, context, onError, actions, at, trigger }),
} : require(name);
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(fakeRequire, module, module.exports);
const { useWorksMapRegionCoverMenu, WorksMapThumbnail } = module.exports;
const photos = ['first', 'second'].map(id => ({ id, title: id, originalName: `${id}.jpg`, width: 6000, height: 4000, originalPath: '', thumbnailPath: '' }));
const group = { id: 'province', photos: photos.map(photo => ({ photo })), photosById: new Map(photos.map(photo => [photo.id, photo])) };

async function scenario(run) {
  const state = current = { menus: [], saves: [], feedback: [], open: [] };
  const container = document.createElement('main'); document.body.append(container);
  const root = createRoot(container);
  let props = { selected: group, busy: false, reviewOpen: false, regionCovers: {},
    onSetCover: async (...args) => { state.saves.push(args); }, onFeedback: (...args) => state.feedback.push(args) };
  function Probe() {
    const showMenu = useWorksMapRegionCoverMenu(props);
    return h(WorksMapThumbnail, { photo: photos[1], onMenu: showMenu, onOpen: trigger => state.open.push(trigger) });
  }
  const render = patch => act(async () => { props = { ...props, ...patch }; root.render(h(Probe)); });
  const dispatch = async (type, options = {}) => {
    const button = container.querySelector('button');
    button.getBoundingClientRect = () => ({ left: 20, bottom: 80 });
    const event = type === 'keydown' ? new KeyboardEvent(type, { bubbles: true, cancelable: true, ...options })
      : new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 31, clientY: 52, ...options });
    await act(async () => button.dispatchEvent(event));
    return event;
  };
  const choose = async index => {
    const action = state.menus.at(-1).actions[index];
    assert.equal(action.disabled, false); assert.equal(action.allowed(), true);
    await act(async () => action.run());
  };
  try { await render({}); await run({ state, container, render, dispatch, choose }); }
  finally { await act(async () => root.unmount()); container.remove(); }
}

test('照片带右键针对该单张；普通点击继续查看，不改变照片样式和画幅', async () => {
  await scenario(async ({ state, container, dispatch, choose }) => {
    assert.equal((await dispatch('contextmenu')).defaultPrevented, true);
    assert.deepEqual(state.menus[0].at, { x: 31, y: 52, source: 'mouse' });
    assert.equal(state.menus[0].trigger, container.querySelector('button'));
    assert.deepEqual(state.menus[0].actions.map(({ text, disabled }) => [text, disabled]), [['设为地区封面', false], ['恢复自动封面', true]]);
    assert.deepEqual(state.open, []);
    await choose(0);
    assert.deepEqual(state.saves, [['province', 'second']]);
    assert.equal(container.querySelector('button').style.aspectRatio, '1.5 / 1');
    await dispatch('click'); assert.equal(state.open.length, 1);
  });
});

test('菜单键及 Shift+F10 使用原生定位入口，非菜单按键不拦截', async () => {
  await scenario(async ({ state, dispatch }) => {
    for (const key of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) {
      assert.equal((await dispatch('keydown', key)).defaultPrevented, true);
      assert.deepEqual(state.menus.at(-1).at, { x: 32, y: 80, source: 'position' });
    }
    for (const key of [{ key: 'F10' }, { key: 'Enter' }, { key: 'ArrowRight' }]) assert.equal((await dispatch('keydown', key)).defaultPrevented, false);
    assert.equal(state.menus.length, 2);
  });
});

test('当前自选封面菜单内可读、禁止重复保存；恢复自动只清当前地区', async () => {
  await scenario(async ({ state, render, dispatch, choose }) => {
    await render({ regionCovers: { province: 'second', city: 'first' } });
    await dispatch('contextmenu');
    assert.equal(state.menus[0].actions[0].text, '设为地区封面（当前封面）');
    assert.equal(state.menus[0].actions[0].disabled, true);
    await choose(1);
    assert.deepEqual(state.saves, [['province', null]]);
  });
});

test('打开菜单后选组、有效照片、忙碌或大图上下文变化，旧操作失效', async () => {
  await scenario(async ({ state, render, dispatch }) => {
    for (const patch of [
      { selected: { ...group, id: 'city' } },
      { selected: { ...group, photosById: new Map() } },
      { busy: true }, { reviewOpen: true },
    ]) {
      await render({ selected: group, busy: false, reviewOpen: false });
      await dispatch('contextmenu');
      const action = state.menus.at(-1).actions[0];
      assert.equal(action.allowed(), true);
      await render(patch);
      assert.equal(action.allowed(), false);
    }
    assert.deepEqual(state.saves, []);
  });
});

test('保存期间阻止重复写入，失败显示实际错误并允许重试', async () => {
  await scenario(async ({ state, render, dispatch, choose }) => {
    let reject;
    await render({ onSetCover: (...args) => {
      state.saves.push(args);
      return new Promise((_, fail) => { reject = fail; });
    } });
    await dispatch('contextmenu'); await choose(0);
    await dispatch('contextmenu');
    assert.equal(state.menus.at(-1).actions[0].disabled, true);
    await act(async () => reject(new Error('图库只读')));
    assert.deepEqual(state.feedback, [['图库只读', true]]);
    await dispatch('contextmenu');
    assert.equal(state.menus.at(-1).actions[0].disabled, false);
    assert.deepEqual(state.saves, [['province', 'second']]);
  });
});

test('App 单项回流合并最新映射并保持全部照片关系引用，清除不影响其他地区', () => {
  const ts = require('typescript');
  const source = readFileSync(resolve('apps/desktop/src/App.tsx'), 'utf8');
  const parsed = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'updateWorksMapRegionCover') initializer = node.initializer.getText(parsed);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(initializer);
  const compiled = ts.transpileModule(`const update = ${initializer};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let view = { snapshot: { photos: photos, groups: [group], memberships: [], hiddenPhotoIds: ['hidden'], worksMapRegionCovers: { city: 'first' } }, pendingCommits: [{}], observedPhotos: ['known'] };
  const original = view;
  const update = new Function('useCallback', 'setLibraryView', `${compiled}; return update;`)(fn => fn, fn => { view = fn(view); });
  update('province', 'second');
  assert.deepEqual(view.snapshot.worksMapRegionCovers, { city: 'first', province: 'second' });
  for (const key of ['photos', 'groups', 'memberships', 'hiddenPhotoIds']) assert.equal(view.snapshot[key], original.snapshot[key]);
  assert.equal(view.pendingCommits, original.pendingCommits);
  assert.equal(view.observedPhotos, original.observedPhotos);
  update('province', null);
  assert.deepEqual(view.snapshot.worksMapRegionCovers, { city: 'first' });
});
