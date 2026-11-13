import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLDialogElement', 'Element', 'Node', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
const { createElement: h, act, StrictMode } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: {
    contents: `export { useAppUpdate, rememberUpdateNotice } from './src/features/use-app-update';
      export { AppUpdateSettings } from './src/features/AppUpdateSettings';
      export { AppUpdateDialog } from './src/features/AppUpdateDialog';`,
    resolveDir: resolve('apps/desktop'),
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent',
  plugins: [{ name: 'app-update-ipc', setup(builder) {
    builder.onResolve({ filter: /\.\.\/lib\/(api|app-update-api)$/ }, ({ path }) => ({ path, namespace: 'mock-update-ipc' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock-update-ipc' }, ({ path }) => ({
      contents: path.endsWith('/api') ? 'export const isDesktop = () => true;'
        : `export const appUpdateInfo = () => globalThis.appUpdateFixture.info();
           export const checkAppUpdate = () => globalThis.appUpdateFixture.check();
           export const installAppUpdate = (...args) => globalThis.appUpdateFixture.install(...args);`,
    }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { useAppUpdate, rememberUpdateNotice, AppUpdateSettings, AppUpdateDialog } = module.exports;

async function scenario(fixture, run) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  globalThis.appUpdateFixture = fixture;
  const render = (updateBlocked = false) => act(async () => root.render(h(StrictMode, null, h(Panel, { updateBlocked }))));
  const button = (label) => [...container.querySelectorAll('dialog button'), ...container.querySelectorAll('button')]
    .find((item) => item.textContent.trim() === label);
  const click = (label) => act(async () => {
    assert(button(label), `应显示「${label}」`);
    button(label).click();
  });
  function Panel({ updateBlocked }) {
    const update = useAppUpdate();
    return h('main', null, h(AppUpdateSettings, { update, updateBlocked, onUpdate: update.start }),
      update.dialogOpen && h(AppUpdateDialog, { status: update.status, retryBlocked: updateBlocked, onRetry: update.start, onClose: update.closeDialog }));
  }
  try {
    await render();
    await run({ container, button, click, render });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    delete globalThis.appUpdateFixture;
  }
}

test('启动检查一次，设置页仍可手动检查，检查不开始下载', async () => {
  let checks = 0;
  let versions = [null, '0.2.0'];
  await scenario({
    info: async () => ({ currentVersion: '0.1.0', enabled: true }),
    check: async () => { checks++; return versions.shift(); },
    install: () => assert.fail('检查不应开始更新'),
  }, async ({ container, click, button }) => {
    assert.equal(checks, 1);
    assert.match(container.textContent, /当前版本 0\.1\.0/);
    assert.match(container.textContent, /已是最新版本/);
    await click('检查更新');
    assert.equal(checks, 2);
    assert.match(container.textContent, /新版本 0\.2\.0/);
    assert(button('立即更新'));
  });
});

test('未配置更新时保留版本显示，跳过联网', async () => {
  await scenario({
    info: async () => ({ currentVersion: '0.1.0', enabled: false }),
    check: () => assert.fail('未配置时不应联网'),
  }, async ({ container }) => {
    assert.match(container.textContent, /当前版本 0\.1\.0/);
    assert.equal(container.querySelector('button'), null);
  });
});

test('一次点击直达完整更新，模态在下载、验签、安装和重启中保持打开', async () => {
  let operation;
  let calls = 0;
  let container;
  await scenario({
    info: async () => ({ currentVersion: '0.1.0', enabled: true }),
    check: async () => '0.2.0',
    install: (version, progress) => {
      assert.equal(version, '0.2.0');
      assert(container.querySelector('dialog[open]'), '原生更新开始前模态已经打开');
      calls++;
      return new Promise((resolve, reject) => { operation = { progress, resolve, reject }; });
    },
  }, async (view) => {
    container = view.container;
    const { click, button, render } = view;
    await render(true);
    assert.equal(button('立即更新').getAttribute('aria-disabled'), 'true');
    await click('立即更新');
    assert.equal(calls, 0);
    await render();
    await click('立即更新');
    const dialog = container.querySelector('dialog');
    assert.match(dialog.textContent, /正在下载更新/);
    assert.equal(dialog.querySelector('[role="progressbar"]').hasAttribute('aria-valuenow'), false);
    assert.equal(dialog.querySelector('button'), null);
    assert.equal(dialog.dispatchEvent(new Event('cancel', { bubbles: true, cancelable: true })), false);
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.equal(dialog.open, true);
    await click('正在更新…');
    assert.equal(calls, 1);
    await act(async () => operation.progress({ stage: 'downloading', downloaded: 4, total: 10 }));
    assert.equal(dialog.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'), '40');
    for (const [stage, copy] of [['verifying', /正在验证/], ['installing', /正在安装/], ['restarting', /正在重启/]]) {
      await act(async () => operation.progress({ stage }));
      assert.equal(container.querySelector('dialog'), dialog);
      assert.match(dialog.textContent, copy);
      assert.equal(dialog.querySelector('button'), null);
    }
    await act(async () => operation.resolve());
    assert.equal(container.querySelector('dialog[open]'), dialog);
    assert.equal(calls, 1);
  });
});

test('失败留在同一个模态，下载、安装和重启可按阶段重试', async () => {
  let operation;
  let calls = 0;
  let container;
  await scenario({
    info: async () => ({ currentVersion: '0.1.0', enabled: true }),
    check: async () => '0.2.0',
    install: (version, progress) => {
      assert.equal(version, '0.2.0');
      calls++;
      return new Promise((resolve, reject) => { operation = { progress, resolve, reject }; });
    },
  }, async (view) => {
    container = view.container;
    const { click, button, render } = view;
    await click('立即更新');
    const dialog = container.querySelector('dialog');
    await act(async () => operation.reject({ stage: 'download', message: '更新包的签名验证失败' }));
    assert.match(dialog.querySelector('[role="alert"]').textContent, /签名验证失败/);
    assert.equal(document.activeElement, button('关闭'));
    await render(true);
    assert.equal(button('重试下载').disabled, true);
    await click('重试下载');
    assert.equal(calls, 1);
    await render();
    await click('重试下载');
    assert.equal(container.querySelector('dialog'), dialog);
    await act(async () => operation.reject({ stage: 'install', message: '系统未允许安装' }));
    assert.match(dialog.querySelector('[role="alert"]').textContent, /系统未允许安装/);
    await click('重试安装');
    assert.match(dialog.textContent, /正在安装/);
    assert.equal(dialog.querySelector('[role="progressbar"]'), null);
    await act(async () => operation.reject({ stage: 'restart', message: '系统拒绝重新启动' }));
    assert.match(dialog.textContent, /更新已安装/);
    assert.match(dialog.querySelector('[role="alert"]').textContent, /系统拒绝重新启动/);
    await click('关闭');
    assert.equal(container.querySelector('dialog'), null);
    assert.equal(document.activeElement, button('重试启动'));
    await click('重试启动');
    assert.match(container.querySelector('dialog').textContent, /正在重启/);
    assert.equal(calls, 4);
  });
});

test('已知可用版本时重新检查失败，仍可更新该版本', async () => {
  let checks = 0;
  await scenario({
    info: async () => ({ currentVersion: '0.1.0', enabled: true }),
    check: async () => { if (++checks === 1) return '0.2.0'; throw '暂时无法检查更新'; },
    install: () => new Promise(() => {}),
  }, async ({ container, click, button }) => {
    await click('检查更新');
    assert.match(container.querySelector('[role="alert"]').textContent, /暂时无法检查更新/);
    assert(button('立即更新'));
    await click('立即更新');
    assert(container.querySelector('dialog[open]'));
  });
});

test('每个版本的启动提示仅记录一次', () => {
  localStorage.clear();
  assert.equal(rememberUpdateNotice('0.2.0'), true);
  assert.equal(rememberUpdateNotice('0.3.0'), true);
  assert.equal(rememberUpdateNotice('0.2.0'), false);
});
