import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { Window } = require('happy-dom');
const window = new Window({ url: 'https://foliune.test' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'Element', 'Node', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? window : window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement: h, act, StrictMode } = require('react');
const { createRoot } = require('react-dom/client');
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  stdin: {
    contents: `export { useAppUpdate, rememberUpdateNotice } from './src/features/use-app-update';
      export { AppUpdateSettings } from './src/features/AppUpdateSettings';`,
    resolveDir: resolve('apps/desktop'),
  },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external', write: false, logLevel: 'silent',
  plugins: [{ name: 'app-update-ipc', setup(builder) {
    builder.onResolve({ filter: /\.\.\/lib\/(api|app-update-api)$/ }, ({ path }) => ({ path, namespace: 'mock-update-ipc' }));
    builder.onLoad({ filter: /.*/, namespace: 'mock-update-ipc' }, ({ path }) => ({
      contents: path.endsWith('/api') ? 'export const isDesktop = () => true;'
        : `export const appUpdateInfo = () => globalThis.appUpdateFixture.info();
           export const checkAppUpdate = () => globalThis.appUpdateFixture.check();
           export const downloadAppUpdate = (...args) => globalThis.appUpdateFixture.download(...args);
           export const installAppUpdate = (...args) => globalThis.appUpdateFixture.install(...args);`,
    }));
  } }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, module, module.exports);
const { useAppUpdate, rememberUpdateNotice, AppUpdateSettings } = module.exports;

async function scenario(fixture, run) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  globalThis.appUpdateFixture = fixture;
  const render = (installBlocked = false) => act(async () => root.render(h(StrictMode, null, h(Panel, { installBlocked }))));
  const button = (label) => [...container.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
  const click = (label) => act(async () => {
    assert(button(label), `应显示「${label}」`);
    button(label).click();
  });
  function Panel({ installBlocked }) {
    const update = useAppUpdate();
    return h(AppUpdateSettings, { update, installBlocked, onInstall: update.install });
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
    download: () => assert.fail('检查不应下载'),
    install: () => assert.fail('检查不应安装'),
  }, async ({ container, click, button }) => {
    assert.equal(checks, 1);
    assert.match(container.textContent, /当前版本 0\.1\.0/);
    assert.match(container.textContent, /已是最新版本/);
    await click('检查更新');
    assert.equal(checks, 2);
    assert.match(container.textContent, /新版本 0\.2\.0/);
    assert(button('下载更新'));
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

test('下载失败可重试，安装前可阻止重启，启动失败只重试启动', async () => {
  let download;
  let downloadCalls = 0;
  let installCalls = 0;
  let container;
  await scenario({
    info: async () => ({ currentVersion: '0.1.0', enabled: true }),
    check: async () => '0.2.0',
    download: (version, progress) => {
      assert.equal(version, '0.2.0');
      downloadCalls++;
      return new Promise((resolve, reject) => { download = { progress, resolve, reject }; });
    },
    install: async (version) => {
      assert.equal(version, '0.2.0');
      assert.match(container.textContent, /正在安装/);
      installCalls++;
      if (installCalls === 1) throw { stage: 'install', message: '系统未允许安装' };
      if (installCalls === 2) throw { stage: 'restart', message: '系统拒绝重新启动' };
    },
  }, async (view) => {
    container = view.container;
    const { click, button, render } = view;
    await click('下载更新');
    assert.equal(container.querySelector('progress').hasAttribute('value'), false);
    await act(async () => download.progress({ downloaded: 4, total: 10 }));
    assert.equal(container.querySelector('progress').value, 40);
    await act(async () => download.reject('更新包的签名验证失败'));
    assert.match(container.querySelector('[role="alert"]').textContent, /签名验证失败/);
    await click('重试下载');
    await act(async () => download.resolve());
    assert.equal(downloadCalls, 2);
    assert.equal(installCalls, 0);
    await render(true);
    assert.equal(button('安装并重启').disabled, true);
    await click('安装并重启');
    assert.equal(installCalls, 0);
    await render();
    await click('安装并重启');
    assert.match(container.querySelector('[role="alert"]').textContent, /系统未允许安装/);
    await click('安装并重启');
    assert.match(container.textContent, /0\.2\.0 已安装，等待重启/);
    assert.match(container.querySelector('[role="alert"]').textContent, /系统拒绝重新启动/);
    await click('重试重新启动');
    assert.equal(downloadCalls, 2);
    assert.equal(installCalls, 3);
  });
});

test('每个版本的启动提示仅记录一次', () => {
  localStorage.clear();
  assert.equal(rememberUpdateNotice('0.2.0'), true);
  assert.equal(rememberUpdateNotice('0.3.0'), true);
  assert.equal(rememberUpdateNotice('0.2.0'), false);
});
