import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) {
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
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const provider = () => container.querySelector('[role="combobox"]');
  const list = () => document.getElementById(provider().getAttribute('aria-controls') ?? '');
  const open = () => act(async () => provider().click());
  const choose = async (name) => {
    await open();
    await act(async () => [...list().querySelectorAll('[role="option"]')].find((option) => option.textContent === name).click());
  };
  const press = (key) => act(async () => provider().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  const submit = async () => act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  try {
    await act(async () => root.render(h(AiConnectionForm, { settings: { connection: { provider: 'openai', model: 'saved-model', vision: true, hasKey: true } }, disabled: false, onRemove: async () => {}, ...props })));
    await run({ container, enter, submit, provider, list, open, choose, press });
  } finally { await act(async () => root.unmount()); container.remove(); }
}

test('切换提供方清除输入的Key，并只允许当前已保存提供方留空', async () => {
  const saves = [];
  await scenario({ onSave: async input => saves.push(input) }, async ({ container, enter, submit, choose }) => {
    assert.equal(container.querySelector('input[type=password]').required, false);
    await enter('input[type=password]', 'must-not-cross-providers');
    await choose('DeepSeek');
    assert.equal(container.querySelector('input[type=password]').value, '');
    assert.equal(container.querySelector('input[type=password]').required, true);
    assert.equal(container.querySelector('input:not([type])').value, 'deepseek-flash');
    await enter('input[type=password]', 'deepseek-key'); await submit();
    assert.deepEqual(saves, [{ provider: 'deepseek', model: 'deepseek-flash', vision: true, apiKey: 'deepseek-key' }]);
    assert.equal(container.querySelector('input[type=password]').value, '');
    await choose('OpenAI');
    assert.equal(container.querySelector('input:not([type])').value, 'saved-model');
    assert.equal(container.querySelector('input[type=password]').required, false);
  });
});

test('保存未完成时禁用表单，失败明确显示且保留输入以便重试', async () => {
  let reject;
  const pending = new Promise((_, fail) => { reject = fail; });
  await scenario({ onSave: () => pending }, async ({ container, enter, submit, provider }) => {
    await enter('input[type=password]', 'retry-key'); await submit();
    assert.equal(container.querySelector('form').getAttribute('aria-busy'), 'true');
    for (const field of container.querySelectorAll('input, button')) assert.equal(field.disabled, true);
    await act(async () => reject(new Error('保存系统凭据失败')));
    assert.match(container.querySelector('[role=alert]').textContent, /保存系统凭据失败/);
    assert.equal(container.querySelector('input[type=password]').value, 'retry-key');
    assert.equal(provider().disabled, false);
  });
});

test('仅选择当前已保存提供方时显示移除，避免操作对象混淆', async () => {
  const removes = [];
  await scenario({ onSave: async () => {}, onRemove: async provider => removes.push(provider) }, async ({ container, choose }) => {
    await choose('Claude');
    assert.equal([...container.querySelectorAll('button')].some(button => button.textContent === '移除接入与 Key'), false);
    await choose('OpenAI');
    await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '移除接入与 Key').click());
    assert.deepEqual(removes, ['openai']);
  });
});

test('提供方键盘搜索和方向键只移动活动项，Escape 取消，Enter 确认', async () => {
  await scenario({ onSave: async () => assert.fail('选项确认不提交表单') }, async ({ provider, list, open, press }) => {
    const active = () => document.getElementById(provider().getAttribute('aria-activedescendant'));
    await open();
    await press('d');
    assert.equal(active().textContent, 'DeepSeek');
    assert(active().hasAttribute('data-active'));
    assert.equal(list().querySelector('[aria-selected="true"]').textContent, 'OpenAI');
    await press('Escape');
    assert.equal(list(), null);
    assert.equal(document.activeElement, provider());
    assert.equal(provider().textContent, 'OpenAI');
    await press('ArrowDown');
    await press('ArrowDown');
    assert.equal(active().textContent, 'Claude');
    await press('Enter');
    assert.equal(list(), null);
    assert.equal(provider().textContent, 'Claude');
  });
});
