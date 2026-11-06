import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : key === 'document' ? window.document : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({ entryPoints: [resolve('apps/desktop/src/features/AiConnectionForm.tsx')], bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { AiConnectionForm } = module.exports;
async function scenario(props, run) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const enter = async (selector, value) => {
    const input = container.querySelector(selector);
    await act(async () => {
      const prototype = input.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    });
  };
  const submit = async () => act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  try {
    await act(async () => root.render(h(AiConnectionForm, { settings: { connection: { provider: 'openai', model: 'saved-model', vision: true, hasKey: true } }, disabled: false, onRemove: async () => {}, ...props })));
    await run({ container, enter, submit });
  } finally { await act(async () => root.unmount()); container.remove(); }
}

test('切换提供方清除输入的Key，并只允许当前已保存提供方留空', async () => {
  const saves = [];
  await scenario({ onSave: async input => saves.push(input) }, async ({ container, enter, submit }) => {
    assert.equal(container.querySelector('input[type=password]').required, false);
    await enter('input[type=password]', 'must-not-cross-providers');
    await enter('select', 'deepseek');
    assert.equal(container.querySelector('input[type=password]').value, '');
    assert.equal(container.querySelector('input[type=password]').required, true);
    assert.equal(container.querySelector('input:not([type])').value, 'deepseek-flash');
    await enter('input[type=password]', 'deepseek-key'); await submit();
    assert.deepEqual(saves, [{ provider: 'deepseek', model: 'deepseek-flash', vision: true, apiKey: 'deepseek-key' }]);
    assert.equal(container.querySelector('input[type=password]').value, '');
    await enter('select', 'openai');
    assert.equal(container.querySelector('input:not([type])').value, 'saved-model');
    assert.equal(container.querySelector('input[type=password]').required, false);
  });
});

test('保存未完成时禁用表单，失败明确显示且保留输入以便重试', async () => {
  let reject;
  const pending = new Promise((_, fail) => { reject = fail; });
  await scenario({ onSave: () => pending }, async ({ container, enter, submit }) => {
    await enter('input[type=password]', 'retry-key'); await submit();
    assert.equal(container.querySelector('form').getAttribute('aria-busy'), 'true');
    for (const field of container.querySelectorAll('input, select, button')) assert.equal(field.disabled, true);
    await act(async () => reject(new Error('保存系统凭据失败')));
    assert.match(container.querySelector('[role=alert]').textContent, /保存系统凭据失败/);
    assert.equal(container.querySelector('input[type=password]').value, 'retry-key');
    assert.equal(container.querySelector('select').disabled, false);
  });
});

test('仅选择当前已保存提供方时显示移除，避免操作对象混淆', async () => {
  const removes = [];
  await scenario({ onSave: async () => {}, onRemove: async provider => removes.push(provider) }, async ({ container, enter }) => {
    await enter('select', 'anthropic');
    assert.equal([...container.querySelectorAll('button')].some(button => button.textContent === '移除接入与 Key'), false);
    await enter('select', 'openai');
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '移除接入与 Key').click());
    assert.deepEqual(removes, ['openai']);
  });
});
