import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'Node', 'Event']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act, StrictMode } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const { outputFiles } = await build({
  stdin: {
    contents: `export { useCliInstall, useCliInstallNotice } from './src/features/use-cli-install';
      export { CliInstallSettings } from './src/features/CliInstallSettings';
      export { ToastProvider } from './src/components/ToastProvider';`,
    resolveDir: resolve('apps/desktop'),
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent',
  loader: { '.css': 'empty' },
  plugins: [{ name: 'cli-install-ipc', setup(builder) {
    builder.onResolve({ filter: /^\.\/api$/ }, ({ path }) => ({ path, namespace: 'mock-cli-ipc' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock-cli-ipc' }, () => ({ contents: 'export const call = (...args) => globalThis.cliInstallCall(...args);' }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports);
const { useCliInstall, useCliInstallNotice, CliInstallSettings, ToastProvider } = module.exports;
const example = '用 foliune-cli 找出标了『窗光』的照片，加入一个新相簿。';
const help = 'foliune-cli --help';

function assertInstalledSettings(container) {
  assert.equal(container.querySelector('h2').textContent, '命令行工具');
  assert.match(container.querySelector('[role="status"]').textContent, /已安装 · foliune-cli/);
  const samples = [...container.querySelectorAll('.settings-cli-copy')].map((element) => element.textContent);
  assert.deepEqual(samples, [example, help]);
}

async function scenario(call, run) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  globalThis.cliInstallCall = call;

  function Panel({ ready, settings, blocked }) {
    const cli = useCliInstall(ready);
    const canOffer = cli.state.type === 'available' && !settings;
    useCliInstallNotice(canOffer && !blocked, canOffer, () => { if (!blocked) void cli.start(true); });
    return h('main', { 'aria-busy': cli.state.type === 'installing' }, settings && h(CliInstallSettings, {
      cli, blocked, onInstall: () => void cli.start(false),
    }));
  }

  const render = ({ ready = true, settings = false, blocked = false } = {}) => act(async () => root.render(
    h(StrictMode, null, h(ToastProvider, null, h(Panel, { ready, settings, blocked }))),
  ));
  const click = (selector) => act(async () => {
    const element = document.querySelector(selector);
    assert(element, `找不到 ${selector}`);
    element.click();
  });
  try { await run({ container, render, click }); }
  finally {
    await act(async () => root.unmount());
    container.remove();
    delete globalThis.cliInstallCall;
  }
}

test('可用时等图库空闲再邀请，关闭和重启后不重复提示，设置仍可安装', async () => {
  localStorage.clear();
  let checks = 0;
  const call = async (command) => {
    assert.equal(command, 'cli_install_status', '没有点安装，不请求系统授权');
    checks++;
    return { status: 'available' };
  };
  await scenario(call, async ({ render, click }) => {
    await render({ ready: false });
    assert.equal(checks, 0);
    await render({ blocked: true });
    assert.equal(checks, 1);
    assert.equal(document.querySelector('.toast-action'), null);
    await render();
    assert.match(document.querySelector('.toast-message').textContent, /^让 AI 助手帮你整理图库/);
    assert.match(document.querySelector('.toast-description').textContent, /支持调用终端.*查找照片、整理相簿，编辑画册和拍摄策划/);
    assert.equal(document.querySelector('.toast-action').textContent, '安装命令行工具');
    assert.equal(document.querySelector('.toast-dismiss').textContent, '暂不安装');
    await click('.toast-dismiss');
    assert.equal(document.querySelector('.toast-action'), null);
  });
  await scenario(call, async ({ container, render }) => {
    await render();
    assert.equal(checks, 2);
    assert.equal(document.querySelector('.toast-action'), null);
    await render({ settings: true });
    assert.equal(container.querySelector('button').textContent, '安装');
    assert.match(container.querySelector('.settings-row p').textContent, /在终端.*照片、相簿、画册、拍摄策划和模特档案/);
  });
});

test('从启动通知点击后才授权，取消后可在设置重试安装', async () => {
  localStorage.clear();
  let installs = 0;
  let finish;
  await scenario(async (command) => {
    if (command === 'cli_install_status') return { status: 'available' };
    assert.equal(command, 'install_cli');
    assert.equal(document.querySelector('main').getAttribute('aria-busy'), 'true');
    installs++;
    if (installs === 2) return { status: 'installed' };
    return new Promise((resolve) => { finish = resolve; });
  }, async ({ container, render, click }) => {
    await render();
    assert.equal(installs, 0);
    await click('.toast-action');
    assert.equal(installs, 1);
    assert.equal(document.querySelector('.toast-action'), null);
    await act(async () => finish({ status: 'cancelled' }));
    assert.match(document.querySelector('.toast-viewport').textContent, /已取消安装/);
    await render({ settings: true });
    assert.match(container.textContent, /已取消安装/);
    await click('main button');
    assert.equal(installs, 2);
    assertInstalledSettings(container);
    assert.equal(container.querySelector('button'), null);
    assert.equal(document.activeElement, container.querySelector('[role="status"]'));
  });
});

test('从启动提示安装成功后展示示例，关闭提示后仍可在设置查看', async () => {
  localStorage.clear();
  await scenario(async (command) => {
    if (command === 'cli_install_status') return { status: 'available' };
    assert.equal(command, 'install_cli');
    return { status: 'installed' };
  }, async ({ container, render, click }) => {
    await render();
    await click('.toast-action');
    const success = document.querySelector('.toast-success');
    assert.equal(success.querySelector('.toast-message > span').textContent, '命令行工具已安装');
    const description = success.querySelector('.toast-description').textContent;
    assert(description.includes(example));
    assert(description.includes(help));
    await click('.toast-success .toast-close');
    assert.equal(document.querySelector('.toast-viewport'), null);
    await render({ settings: true });
    assertInstalledSettings(container);
  });
});

test('命令名冲突时不调用安装，重新检查后可安装，失败可重试', async () => {
  localStorage.clear();
  let checks = 0;
  let installs = 0;
  await scenario(async (command) => {
    if (command === 'cli_install_status') return { status: ++checks === 1 ? 'conflict' : 'available' };
    assert.equal(command, 'install_cli');
    if (++installs === 1) throw new Error('系统未允许安装');
    return { status: 'installed' };
  }, async ({ container, render, click }) => {
    await render();
    assert.equal(document.querySelector('.toast-action'), null);
    await render({ settings: true });
    assert.match(container.textContent, /\/usr\/local\/bin\/foliune-cli 已被占用/);
    assert.equal(container.querySelector('button').textContent, '重新检查');
    await click('main button');
    assert.equal(checks, 2);
    assert.equal(installs, 0);
    assert.equal(container.querySelector('button').textContent, '安装');
    await render({ settings: true, blocked: true });
    await click('main button');
    assert.equal(installs, 0);
    await render({ settings: true });
    await click('main button');
    assert.match(container.querySelector('[role="alert"]').textContent, /系统未允许安装/);
    assert.equal(container.querySelector('button').textContent, '重试安装');
    await click('main button');
    assert.equal(installs, 2);
    assert.equal(container.querySelector('[role="alert"]'), null);
    assertInstalledSettings(container);
  });
});

test('重新打开应用时已安装的工具在设置保留示例', async () => {
  localStorage.clear();
  await scenario(async (command) => {
    assert.equal(command, 'cli_install_status');
    return { status: 'installed' };
  }, async ({ container, render }) => {
    await render({ settings: true });
    assertInstalledSettings(container);
    assert.equal(document.querySelector('.toast-viewport'), null);
  });
});

test('不可安装的应用既不邀请，也不显示设置入口', async () => {
  localStorage.clear();
  await scenario(async (command) => {
    assert.equal(command, 'cli_install_status');
    return { status: 'unavailable' };
  }, async ({ container, render }) => {
    await render();
    assert.equal(document.querySelector('.toast-action'), null);
    await render({ settings: true });
    assert.equal(container.querySelector('section'), null);
  });
});
