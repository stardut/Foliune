import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareRelease, releaseVersion } from './prepare-release.mjs';

const files = {
  'package.json': '{"name":"foliune","version":"0.1.0","packageManager":"pnpm@10.19.0"}\n',
  'apps/desktop/package.json': '{"name":"@foliune/desktop","version":"0.1.0","dependencies":{"react":"^19.0.0"}}\n',
  'apps/desktop/src-tauri/tauri.conf.json': '{"version":"0.1.0","bundle":{"macOS":{"minimumSystemVersion":"11.0"}}}\n',
  'apps/desktop/src-tauri/Cargo.toml': '[package]\nname = "foliune"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = "1"\n',
  'apps/desktop/src-tauri/Cargo.lock': 'version = 4\n\n[[package]]\nname = "before"\nversion = "1.0.0"\n\n[[package]]\nname = "foliune"\nversion = "0.1.0"\ndependencies = ["before"]\n\n[[package]]\nname = "after"\nversion = "2.0.0"\n',
  'pnpm-lock.yaml': "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  apps/desktop: {}\n",
};

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'foliune-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'apps/desktop/src-tauri'), { recursive: true });
  for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
  return root;
}

test('只接受稳定 SemVer tag，拒绝前导零、预发布、空白和 shell 注入', () => {
  for (const tag of ['0.0.0', '1.2.3', 'v12.0.45']) assert.equal(releaseVersion(tag), tag.replace(/^v/, ''));
  for (const tag of [undefined, '', 'v01.2.3', '1.02.3', '1.2.03', '1.2', '1.2.3-rc.1', '1.2.3+meta', '1.2.3\n', ' 1.2.3', 'v1.2.3; echo x', '$(id)', 123]) {
    assert.throws(() => releaseVersion(tag));
  }
});

test('同步五处版本，保留依赖、系统要求和 pnpm 锁文件；可重复运行', (t) => {
  const root = fixture(t);
  assert.equal(prepareRelease(root, 'v1.23.4'), '1.23.4');
  for (const path of ['package.json', 'apps/desktop/package.json', 'apps/desktop/src-tauri/tauri.conf.json']) {
    const actual = JSON.parse(readFileSync(join(root, path), 'utf8'));
    assert.deepEqual(actual, { ...JSON.parse(files[path]), version: '1.23.4' });
  }
  for (const path of ['apps/desktop/src-tauri/Cargo.toml', 'apps/desktop/src-tauri/Cargo.lock']) {
    assert.equal(readFileSync(join(root, path), 'utf8'), files[path].replace('version = "0.1.0"', 'version = "1.23.4"'));
  }
  assert.equal(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'), files['pnpm-lock.yaml']);
  const first = Object.keys(files).map((path) => readFileSync(join(root, path), 'utf8'));
  prepareRelease(root, '1.23.4');
  assert.deepEqual(Object.keys(files).map((path) => readFileSync(join(root, path), 'utf8')), first);
});

test('缺失或重复应用 package 时失败，避免误改第三方版本或部分写入', (t) => {
  for (const mutation of ['missing-package', 'missing-version', 'duplicate-package']) {
    const root = fixture(t);
    const lockPath = join(root, 'apps/desktop/src-tauri/Cargo.lock');
    const lock = files['apps/desktop/src-tauri/Cargo.lock'];
    const invalid = mutation === 'missing-package' ? lock.replace('name = "foliune"', 'name = "other"')
      : mutation === 'missing-version' ? lock.replace('version = "0.1.0"\n', '')
        : `${lock}\n[[package]]\nname = "foliune"\nversion = "9.0.0"\n`;
    writeFileSync(lockPath, invalid);
    assert.throws(() => prepareRelease(root, '1.2.3'));
    for (const [path, content] of Object.entries(files)) {
      assert.equal(readFileSync(join(root, path), 'utf8'), path.endsWith('Cargo.lock') ? invalid : content);
    }
  }
});

test('非法 tag 在任何文件读写前失败', (t) => {
  const root = fixture(t);
  assert.throws(() => prepareRelease('/not-a-release-checkout', 'v1.2.3-rc.1'), /发布 tag/);
  assert.throws(() => prepareRelease(root, '1.2.3\n'), /发布 tag/);
  for (const [path, content] of Object.entries(files)) assert.equal(readFileSync(join(root, path), 'utf8'), content);
});
