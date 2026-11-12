import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { publishRelease } from './publish-release.mjs';
import { updaterArchive, updaterSignature } from './updater-release.mjs';
import { signedFixture } from './updater-release.test-fixtures.mjs';

const tag = 'v0.7.0';
const dmg = 'Foliune_0.7.0_aarch64.dmg';

function mockGitHub({ draft = true, initial = [], exists = true } = {}) {
  let nextId = 1;
  const files = new Map();
  const release = { id: 1, tag_name: tag, prerelease: false, draft, assets: [] };
  const calls = [];
  function add(name, bytes, state = 'uploaded') {
    const id = nextId++;
    const data = Buffer.from(bytes);
    files.set(id, data);
    release.assets.push({ id, name, state, size: data.length, digest: `sha256:${createHash('sha256').update(data).digest('hex')}` });
  }
  for (const args of initial) add(...args);
  const snapshot = () => structuredClone(release);
  return {
    calls,
    snapshot,
    async find() { return exists ? snapshot() : null; },
    async create() {
      calls.push('create');
      exists = true;
      return snapshot();
    },
    async get() { return snapshot(); },
    async remove(id) {
      calls.push(`remove ${release.assets.find((asset) => asset.id === id).name}`);
      release.assets = release.assets.filter((asset) => asset.id !== id);
    },
    async upload(_release, name, path) {
      calls.push(`upload ${name}`);
      add(name, await readFile(path));
    },
    async download(id, path) {
      calls.push(`download ${release.assets.find((asset) => asset.id === id).name}`);
      await writeFile(path, files.get(id));
    },
    async publish(_id, { makeLatest }) {
      assert.equal(makeLatest, 'legacy');
      calls.push('publish');
      release.draft = false;
      return snapshot();
    },
  };
}

async function stage(t, fixture) {
  const staged = await mkdtemp(join(tmpdir(), 'foliune-test-release-'));
  t.after(() => rm(staged, { recursive: true, force: true }));
  await writeFile(join(staged, dmg), 'verified DMG');
  if (fixture) {
    await writeFile(join(staged, updaterArchive), fixture.archive);
    await writeFile(join(staged, updaterSignature), fixture.signature);
  }
  return { staged, tag, publicKey: fixture?.publicKey, updater: Boolean(fixture) };
}

test('uploads all verified assets before publishing and leaves latest selection to GitHub SemVer', async (t) => {
  const args = await stage(t, signedFixture('0.7.0'));
  const github = mockGitHub({ exists: false });
  const release = await publishRelease({ ...args, github });
  assert.equal(release.draft, false);
  assert.deepEqual(github.calls, ['create', `upload ${dmg}`, `upload ${updaterArchive}`, `upload ${updaterSignature}`, 'publish']);
});

test('retries an interrupted draft from the same artifact, preserving its already uploaded archive', async (t) => {
  const args = await stage(t, signedFixture('0.7.0'));
  const github = mockGitHub({ exists: false });
  const upload = github.upload;
  github.upload = async (release, name, path) => {
    if (name === updaterSignature) throw new Error('interrupted upload');
    await upload(release, name, path);
  };
  await assert.rejects(publishRelease({ ...args, github }), /interrupted upload/);
  assert.equal(github.snapshot().draft, true);
  github.upload = upload;
  await publishRelease({ ...args, github });
  assert.deepEqual(github.calls, ['create', `upload ${dmg}`, `upload ${updaterArchive}`, `upload ${updaterSignature}`, 'publish']);
});

test('removes stale draft members before starting the new paired upload', async (t) => {
  const args = await stage(t, signedFixture('0.7.0'));
  const old = signedFixture('0.7.0', 'stale archive');
  for (const previous of [
    [[updaterArchive, old.archive]],
    [[updaterSignature, old.signature]],
    [[updaterSignature, '', 'starter']],
  ]) {
    const github = mockGitHub({ initial: [[dmg, 'preserved DMG'], ...previous] });
    await publishRelease({ ...args, github });
    assert.deepEqual(github.calls, [`remove ${previous[0][0]}`, `upload ${updaterArchive}`, `upload ${updaterSignature}`, 'publish']);
  }
});

test('preserves a complete public release and verifies the actual pair from its earlier build', async (t) => {
  const key = generateKeyPairSync('ed25519');
  const args = await stage(t, signedFixture('0.7.0', 'current archive', key));
  const old = signedFixture('0.7.0', 'previous archive', key);
  const github = mockGitHub({ draft: false, initial: [[dmg, 'previous DMG'], [updaterArchive, old.archive], [updaterSignature, old.signature]] });
  await publishRelease({ ...args, github });
  assert.deepEqual(github.calls, [`download ${updaterArchive}`, `download ${updaterSignature}`]);
});

test('leaves a draft unpublished when its already present assets do not form a valid pair', async (t) => {
  const key = generateKeyPairSync('ed25519');
  const fixture = signedFixture('0.7.0', 'current archive', key);
  const args = await stage(t, fixture);
  const github = mockGitHub({ initial: [[dmg, 'DMG'], [updaterArchive, 'different archive'], [updaterSignature, fixture.signature]] });
  await assert.rejects(publishRelease({ ...args, github }), /archive failed signature/);
  assert.equal(github.snapshot().draft, true);
  assert.deepEqual(github.calls, [`download ${updaterArchive}`, `download ${updaterSignature}`]);
});

test('leaves a public release with a partial updater pair untouched', async (t) => {
  const fixture = signedFixture('0.7.0');
  const args = await stage(t, fixture);
  const github = mockGitHub({ draft: false, initial: [[dmg, 'DMG'], [updaterArchive, fixture.archive]] });
  await assert.rejects(publishRelease({ ...args, github }), /incomplete updater asset pair/);
  assert.deepEqual(github.calls, []);
});

test('retains the DMG-only publication path for historical tags without requiring a key', async (t) => {
  const args = await stage(t);
  const github = mockGitHub({ exists: false });
  await publishRelease({ ...args, github });
  assert.deepEqual(github.calls, ['create', `upload ${dmg}`, 'publish']);
});
