import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window();
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'document' ? window.document : window[key] });
}
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({ entryPoints: [resolve('apps/desktop/src/lib/context-menu-policy.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { installContextMenuPolicy } = module.exports;

function scenario(html, run) {
  document.body.innerHTML = html;
  const calls = [];
  const remove = installContextMenuPolicy(document, (...args) => calls.push(args));
  const dispatch = (selector, type = 'contextmenu', options = {}) => {
    const target = document.querySelector(selector);
    const EventClass = type === 'keydown' ? KeyboardEvent : MouseEvent;
    const event = new EventClass(type, { bubbles: true, cancelable: true, clientX: 40, clientY: 60, ...options });
    target.dispatchEvent(event);
    return event;
  };
  try { run({ calls, dispatch, remove }); }
  finally { remove(); document.body.innerHTML = ''; }
}

test('空白、无业务操作的图片、链接和已选正文不打开网页菜单', () => {
  scenario('<main><img><a href="https://example.com">来源</a><p>摄影文字</p><button>操作</button><input type="range"><input type="checkbox"></main>', ({ calls, dispatch }) => {
    const range = document.createRange(); range.selectNodeContents(document.querySelector('p'));
    window.getSelection().addRange(range);
    for (const selector of ['main', 'img', 'a', 'p', 'button', '[type=range]', '[type=checkbox]']) assert.equal(dispatch(selector).defaultPrevented, true);
    assert.deepEqual(calls, []);
  });
});

test('文本、数字和密码输入及只读文字区只请求相应的原生编辑菜单', () => {
  scenario('<input id="title"><input id="secret" type="password"><input id="amount" type="number"><textarea id="note"></textarea><input id="readonly" readonly><textarea id="readnote" readonly></textarea>', ({ calls, dispatch }) => {
    for (const id of ['title', 'secret', 'amount', 'note', 'readonly', 'readnote']) {
      assert.equal(dispatch(`#${id}`).defaultPrevented, true);
      assert.deepEqual(calls.at(-1), [id.startsWith('read') ? 'copy' : 'edit', { x: 40, y: 60 }, document.getElementById(id)]);
    }
  });
});

test('禁用文本控件不弹菜单，富文本遵守最近一层可编辑边界', () => {
  scenario('<input disabled><textarea disabled></textarea><div contenteditable="true"><span id="editable">标题</span><span contenteditable="false" id="fixed">固定文字</span></div><div contenteditable="plaintext-only" id="plain">段落</div>', ({ calls, dispatch }) => {
    for (const selector of ['input', 'textarea', '#fixed']) dispatch(selector);
    assert.equal(calls.length, 0);
    dispatch('#editable');
    assert.equal(calls[0][2], document.querySelector('[contenteditable=true]'));
    dispatch('#plain');
    assert.equal(calls[1][2], document.getElementById('plain'));
  });
});

test('已有业务菜单优先且不会因全局处理改变菜单对象', () => {
  scenario('<div id="business"><img></div><input>', ({ calls, dispatch }) => {
    let business = 0;
    document.querySelector('#business').addEventListener('contextmenu', event => { business++; event.preventDefault(); event.stopPropagation(); });
    assert.equal(dispatch('img').defaultPrevented, true);
    document.querySelector('input').addEventListener('contextmenu', event => event.preventDefault());
    dispatch('input');
    assert.equal(business, 1);
    assert.deepEqual(calls, []);
  });
});

test('键盘菜单遵从业务处理，常规编辑和快捷键不受影响，卸载后无残留', () => {
  scenario('<input><button>相簿</button>', ({ calls, dispatch, remove }) => {
    document.querySelector('input').getBoundingClientRect = () => ({ left: 20, bottom: 80 });
    for (const options of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) assert.equal(dispatch('input', 'keydown', options).defaultPrevented, true);
    assert.deepEqual(calls[0], ['edit', { x: 32, y: 80 }, document.querySelector('input')]);
    for (const options of [{ key: 'F10' }, { key: 'c', metaKey: true }, { key: 'v', ctrlKey: true }, { key: 'z', metaKey: true }, { key: 'a' }]) assert.equal(dispatch('input', 'keydown', options).defaultPrevented, false);
    let business = 0;
    document.querySelector('button').addEventListener('keydown', event => { event.preventDefault(); business++; });
    dispatch('button', 'keydown', { key: 'ContextMenu' });
    assert.equal(business, 1); assert.equal(calls.length, 2);
    remove();
    assert.equal(dispatch('input').defaultPrevented, false);
    assert.equal(dispatch('input', 'keydown', { key: 'ContextMenu' }).defaultPrevented, false);
    assert.equal(calls.length, 2);
  });
});
