import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { modelViewReducer, overviewSampleLayout, overviewSamples } from '../src/features/models/model-workspace-state.ts';

const model = {
  id: 'model', name: '林禾', gender: '女', city: '上海', birthday: '', contact: 'hello@example.test',
  tags: ['自然', '电影感'], tagOptions: ['自然', '电影感', '复古'], notes: '窗边自然光\n保留停顿',
  heightCm: 172, bustCm: 86, waistCm: 62, hipsCm: 90,
  photoIds: ['one', 'two', 'three', 'four'], coverPhotoId: 'three', createdAt: '', updatedAt: '',
};
const home = { page: 'home' };

test('档案从列表进入只读详情，显式编辑后取消返回原详情', () => {
  const detail = modelViewReducer(home, { type: 'open', model });
  assert.equal(detail.page, 'detail');
  const editor = modelViewReducer(detail, { type: 'edit' });
  assert.equal(editor.page, 'edit');
  assert.deepEqual(modelViewReducer(editor, { type: 'back' }), detail);
  assert.deepEqual(modelViewReducer(detail, { type: 'back' }), home);
});

test('普通保存与保存并离开共用 saved 事件，详情持有服务端最新档案', () => {
  const editor = modelViewReducer({ page: 'detail', model }, { type: 'edit' });
  const saved = { ...model, name: '更新后的姓名', photoIds: ['four', 'one'] };
  const detail = modelViewReducer(editor, { type: 'saved', model: saved });
  assert.equal(detail.page, 'detail');
  assert.equal(detail.model, saved);
  assert.equal(modelViewReducer(detail, { type: 'edit' }).model, saved);
});

test('新建取消回列表，保存进入新详情，删除回列表', () => {
  const editor = modelViewReducer(home, { type: 'new' });
  assert.deepEqual(editor, { page: 'edit' });
  assert.deepEqual(modelViewReducer(editor, { type: 'back' }), home);
  const detail = modelViewReducer(editor, { type: 'saved', model });
  assert.deepEqual(detail, { page: 'detail', model });
  assert.deepEqual(modelViewReducer({ page: 'edit', model }, { type: 'deleted' }), home);
});

test('首页优先同方向三张，封面不改变同组样片的业务顺序', () => {
  const photos = new Map(model.photoIds.map(id => [id, { id, width: id === 'one' ? 1200 : 800, height: 1000 }]));
  assert.deepEqual(overviewSamples(model, photos).map(photo => photo.id), ['two', 'three', 'four']);
  assert.deepEqual(model.photoIds, ['one', 'two', 'three', 'four']);
  photos.delete('one');
  assert.deepEqual(overviewSamples(model, photos).map(photo => photo.id), ['two', 'three', 'four']);
  assert.deepEqual(overviewSamples({ ...model, coverPhotoId: 'outside' }, photos).map(photo => photo.id), ['two', 'three', 'four']);
  assert.deepEqual(overviewSamples({ ...model, photoIds: [] }, photos), []);
});

test('两个方向都足三张时参考有效封面的方向，方图归横组', () => {
  const photoIds = ['p1', 'l1', 'p2', 'square', 'p3', 'l3'];
  const photos = new Map(photoIds.map(id => [id, { id, width: id.startsWith('p') ? 600 : id === 'square' ? 1000 : 1500, height: 1000 }]));
  const profile = { ...model, photoIds, coverPhotoId: 'l3' };
  assert.deepEqual(overviewSamples(profile, photos).map(photo => photo.id), ['l1', 'square', 'l3']);
  assert.deepEqual(overviewSamples({ ...profile, coverPhotoId: 'p3' }, photos).map(photo => photo.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(overviewSamples({ ...profile, coverPhotoId: 'outside' }, photos).map(photo => photo.id), ['p1', 'p2', 'p3']);
  assert.deepEqual(profile.photoIds, photoIds);
});

test('同方向不足时仅前三张样片分竖左横右，组内保持顺序且忽略缺失重复记录', () => {
  const photos = new Map([
    ['l1', { id: 'l1', width: 1500, height: 1000 }], ['p1', { id: 'p1', width: 600, height: 1000 }],
    ['l2', { id: 'l2', width: 1600, height: 1000 }], ['p2', { id: 'p2', width: 700, height: 1000 }],
    ['outside', { id: 'outside', width: 600, height: 1000 }],
  ]);
  const profile = { ...model, photoIds: ['missing', 'l1', 'p1', 'l1', 'l2', 'p2'], coverPhotoId: 'outside' };
  assert.deepEqual(overviewSamples(profile, photos).map(photo => photo.id), ['p1', 'l1', 'l2']);
  assert.deepEqual(overviewSamples({ ...profile, photoIds: ['missing', 'l1'] }, photos).map(photo => photo.id), ['l1']);
});

test('样片按共同高度完整适配实际宽度，混合分组留白且无半张或横向溢出', () => {
  const sets = [
    [{ width: 600, height: 1000 }, { width: 700, height: 1000 }, { width: 800, height: 1000 }],
    [{ width: 1500, height: 1000 }, { width: 1000, height: 1000 }, { width: 2400, height: 1000 }],
    [{ width: 600, height: 1000 }, { width: 1500, height: 1000 }, { width: 10000, height: 1000 }],
  ];
  for (const samples of sets) for (const width of [0, 8, 220, 420, 1040]) {
    const layout = overviewSampleLayout(samples, width);
    assert(layout.height >= 0 && layout.height <= 120);
    const mixed = samples.some(photo => photo.width < photo.height) && samples.some(photo => photo.width >= photo.height);
    const spaces = (samples.length - 1) * layout.gap + (mixed ? layout.groupGap - layout.gap : 0);
    assert(layout.widths.reduce((sum, value) => sum + value, spaces) <= width + 1e-8);
    layout.widths.forEach((value, index) => assert(Math.abs(value - layout.height * samples[index].width / samples[index].height) < 1e-8));
    if (mixed && width > 0) assert(layout.groupGap > layout.gap);
  }
  assert.deepEqual(overviewSampleLayout([], 500), { height: 0, gap: 0, groupGap: 0, widths: [] });
});

const require = createRequire(resolve('apps/desktop/package.json'));
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const compiled = await build({ entryPoints: [resolve('apps/desktop/src/features/models/ModelDetail.tsx')], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent', loader: { '.css': 'empty' } });
const module = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require });
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const photo = id => ({ id, title: `样片${id}`, originalName: `${id}.jpg`, width: 800, height: 1200, originalUrl: `https://example.test/${id}.jpg`, thumbnailUrl: `https://example.test/${id}-thumb.jpg`, originalAvailable: true, thumbnailAvailable: true });
const overviewCompiled = await build({ entryPoints: [resolve('apps/desktop/src/features/models/ModelOverviewRow.tsx')], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent' });
const overviewModule = { exports: {} };
vm.runInNewContext(overviewCompiled.outputFiles[0].text, { module: overviewModule, exports: overviewModule.exports, require });
function overview(profile, photos = model.photoIds.map(photo)) {
  return renderToStaticMarkup(createElement(overviewModule.exports.ModelOverviewRow, { model: profile, photos: new Map(photos.map(item => [item.id, item])), onOpen() {} }));
}

test('首页真实行组件整行可进入详情，信息在左、分组样片在右且首屏默认可见', () => {
  const html = overview(model);
  assert.equal((html.match(/<button\b/g) || []).length, 2);
  assert(html.includes('aria-label="删除林禾的档案"'));
  assert(!html.includes('aria-haspopup="menu"'));
  assert(!/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*<button\b/.test(html));
  assert(html.includes('aria-label="查看林禾的档案"'));
  assert(html.indexOf('model-overview-info') < html.indexOf('model-overview-samples'));
  assert(html.includes('女 · 上海'));
  assert(html.includes('title="林禾"'));
  assert(html.includes('title="女 · 上海"'));
  assert(html.includes('title="自然"'));
  assert(!html.includes('model-overview-count'));
  assert(!html.includes('张样片'));
  assert.equal((html.match(/<img\b/g) || []).length, 3);
  assert(html.includes('aspect-ratio:800/1200'));
  assert(html.includes('height:120px'));
  assert(!/opacity:0|visibility:hidden/.test(html));
});

test('无样片与有样片复用同一行容器，缺失样片记录和未添加样片区分', () => {
  const empty = overview({ ...model, photoIds: [] }, []);
  assert(empty.includes('class="model-overview-row"'));
  assert(empty.includes('暂无样片'));
  assert(!empty.includes('model-overview-groups'));
  const missing = overview({ ...model, photoIds: ['missing'] }, []);
  assert(missing.includes('样片记录缺失'));
  assert(!missing.includes('<img'));
});

function detail(profile, photos = model.photoIds.map(photo)) {
  return renderToStaticMarkup(createElement(module.exports.ModelDetail, { model: profile, photos, onBack() {}, onEdit() {} }));
}

test('真实详情组件先展示已填资料，再展示全部有序样片，没有编辑控件或历史身体字段', () => {
  const html = detail(model);
  assert(html.includes('编辑档案'));
  assert(html.includes('返回模特'));
  assert(html.includes('hello@example.test'));
  assert(html.includes('窗边自然光\n保留停顿'));
  assert(!html.includes('<h2'));
  assert(html.includes('model-profile-card'));
  assert(html.includes('aria-label="删除档案"'));
  assert(html.indexOf('aria-label="基本资料"') < html.indexOf('aria-label="全部样片"'));
  assert(html.indexOf('窗边自然光\n保留停顿') < html.indexOf('model-detail-samples'));
  assert(!html.includes('生日'));
  assert(!html.includes('172'));
  assert(!html.includes('复古'));
  assert(!/<(?:input|textarea|select)\b/.test(html));
  assert(!/移除样片|设为封面|向前移动|从图库选择|导入/.test(html));
  const positions = model.photoIds.map(id => html.indexOf(`查看 样片${id}`));
  assert(positions.every(position => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test('详情空资料不显示资料区，缺失记录明确显示且不静默跳过', () => {
  const empty = { ...model, gender: '', city: '', birthday: '', contact: '', tags: [], notes: '  ', photoIds: [] };
  const html = detail(empty, []);
  assert(html.includes('还没有样片'));
  assert(!html.includes('基本资料'));
  const missing = detail({ ...empty, photoIds: ['missing'] }, []);
  assert(missing.includes('样片记录缺失'));
  assert(/disabled=""[^>]*aria-label="第 1 张样片记录缺失"/.test(missing));
});

test('详情长资料保持完整内容并位于样片之前，不裁掉标签、联系方式或备注', () => {
  const notes = '完整备注\n'.repeat(200);
  const contact = 'contact'.repeat(60);
  const tags = Array.from({ length: 50 }, (_, index) => `风格${index}`);
  const html = detail({ ...model, birthday: '1996-04-23', contact, tags, notes });
  assert(html.includes('1996-04-23'));
  assert(html.includes(contact));
  assert(html.includes(notes));
  assert(tags.every(tag => html.includes(`>${tag}</span>`)));
  assert(html.indexOf(notes) < html.indexOf('aria-label="全部样片"'));
});

const workspaceCompiled = await build({ entryPoints: [resolve('apps/desktop/src/features/models/ModelWorkspace.tsx')], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent', loader: { '.css': 'empty' } });

test('列表和详情共用删除确认，取消不请求，失败保留目标，忙时不能重复删除或关闭，成功只删除指定档案', async () => {
  let active, finishDelete, rejectDelete;
  const removed = [], busyStates = [], dirtyStates = [];
  const other = { ...model, id: 'other', name: '另一位' };
  const jsx = (type, props) => ({ type, props });
  const flat = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(flat)];
  const text = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : [node.props?.children].flat(Infinity).map(text).join('');
  const react = {
    createContext() { return {}; },
    useState(value) { const h = active, index = h.cursor++; if (!(index in h.cells)) h.cells[index] = typeof value === 'function' ? value() : value; return [h.cells[index], next => { h.cells[index] = typeof next === 'function' ? next(h.cells[index]) : next; }]; },
    useReducer(reducer, value) { const [state, update] = react.useState(value); return [state, action => update(old => reducer(old, action))]; },
    useRef(value) { const h = active, index = h.cursor++; return h.cells[index] ??= { current: value }; },
    useMemo(fn) { active.cursor++; return fn(); },
    useEffect(fn, deps) { const h = active, index = h.effectCursor++, old = h.effects[index]; if (!old || deps.some((value, i) => value !== old.deps[i])) h.pending.push({ index, fn, deps }); },
    useLayoutEffect(fn, deps) { react.useEffect(fn, deps); },
  };
  const exports = { exports: {} };
  vm.runInNewContext(workspaceCompiled.outputFiles[0].text, { module: exports, exports: exports.exports, HTMLElement: { prototype: {} }, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-dom') return { createPortal: node => node };
    if (name === 'lucide-react') return new Proxy({}, { get: (_, key) => key });
    if (name === 'motion/react') return { motion: new Proxy({}, { get: (_, key) => key }) };
    if (name === '@tauri-apps/api/core') return { isTauri: () => true, invoke: async (command, args) => {
      if (command === 'models_list') return [model, other];
      if (command === 'models_delete') { removed.push(args.id); return new Promise((resolve, reject) => { finishDelete = resolve; rejectDelete = reject; }); }
      throw Error(`Unexpected IPC ${command}`);
    } };
    return require(name);
  } });
  const h = { cells: [], effects: [], pending: [], cursor: 0, effectCursor: 0 };
  const props = { photos: [], onSnapshot() {}, onDirtyChange: value => dirtyStates.push(value), onBusyChange: value => busyStates.push(value) };
  let tree;
  function render() {
    h.cursor = 0; h.effectCursor = 0; h.pending = []; active = h;
    tree = exports.exports.ModelWorkspace(props);
    for (const effect of h.pending) { h.effects[effect.index]?.cleanup?.(); h.effects[effect.index] = { ...effect, cleanup: effect.fn() }; }
    return tree;
  }
  const pump = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const rows = () => flat(tree).filter(node => node.type?.name === 'ModelOverviewRow');
  function deleteIcon(row) {
    const previous = active;
    active = { cells: [], effects: [], pending: [], cursor: 0, effectCursor: 0 };
    const rendered = row.type(row.props);
    active = previous;
    assert(!rendered.props.onContextMenu);
    return flat(rendered).find(node => node.type === 'button' && node.props.className.includes('model-overview-delete'));
  }
  const modal = () => flat(tree).find(node => node.props?.title === '删除模特档案？');
  const confirm = () => flat(modal()).find(node => node.type === 'button' && ['删除档案', '删除中…'].includes(text(node)));
  const cancel = () => flat(modal()).find(node => node.type === 'button' && text(node) === '取消');
  render(); await pump(); render();
  assert.equal(rows().length, 2);
  const firstDelete = deleteIcon(rows()[0]);
  assert.equal(firstDelete.props['aria-label'], '删除林禾的档案');
  firstDelete.props.onClick(); render();
  assert(modal()); assert(text(modal()).includes('将删除“林禾”的资料与样片关联，图库照片和原件保留。'));
  assert.equal(removed.length, 0, 'Opening confirmation does not delete');
  cancel().props.onClick(); render(); assert(!modal()); assert.equal(removed.length, 0);
  deleteIcon(rows()[1]).props.onClick(); render();
  const button = confirm(); button.props.onClick(); button.props.onClick(); render();
  assert.deepEqual(removed, ['other']); assert(confirm().props.disabled); assert(cancel().props.disabled);
  modal().props.onClose(); render(); assert(modal(), 'Cannot close a pending deletion');
  assert.equal(busyStates.at(-1), true); assert.equal(dirtyStates.at(-1), true);
  rejectDelete(Error('删除失败测试')); await pump(); render();
  assert(modal()); assert(text(modal()).includes('另一位')); assert(text(modal()).includes('删除失败测试')); assert.equal(rows().length, 2);
  assert.equal(busyStates.at(-1), false); assert.equal(dirtyStates.at(-1), false);
  confirm().props.onClick(); finishDelete(); await pump(); render();
  assert(!modal()); assert.equal(rows().length, 1); assert.equal(rows()[0].props.model.id, 'model');
  rows()[0].props.onOpen(); render();
  const detail = flat(tree).find(node => node.type?.name === 'ModelDetail'); detail.props.onDelete(); render();
  assert(modal()); cancel().props.onClick(); render(); assert(flat(tree).some(node => node.type?.name === 'ModelDetail'));
  flat(tree).find(node => node.type?.name === 'ModelDetail').props.onDelete(); render();
  confirm().props.onClick(); finishDelete(); await pump(); render();
  assert(!modal()); assert.equal(rows().length, 0); assert(flat(tree).some(node => node.props?.title === '建立第一份模特档案'));
  assert.deepEqual(removed, ['other', 'other', 'model']);
  for (const effect of h.effects) effect?.cleanup?.();
});
