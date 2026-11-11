import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchLatestReleaseManifest, latestReleaseManifest } from './prepare-site-release.mjs';

const asset = {
  name: 'Foliune_0.7.0_aarch64.dmg',
  state: 'uploaded',
  size: 1024,
  browser_download_url: 'https://github.com/stardut/Foliune/releases/download/0.7.0/Foliune_0.7.0_aarch64.dmg',
};
const release = { draft: false, prerelease: false, tag_name: '0.7.0', assets: [asset] };

test('builds a manifest only from a published stable release with its complete DMG', () => {
  assert.deepEqual(latestReleaseManifest(release), {
    tag: '0.7.0',
    downloadUrl: asset.browser_download_url,
  });
  assert.deepEqual(latestReleaseManifest({
    ...release,
    tag_name: 'v0.7.0',
    assets: [{ ...asset, name: 'Foliune_0.7.0_aarch64.dmg', browser_download_url: 'https://github.com/stardut/Foliune/releases/download/v0.7.0/Foliune_0.7.0_aarch64.dmg' }],
  }), {
    tag: 'v0.7.0',
    downloadUrl: 'https://github.com/stardut/Foliune/releases/download/v0.7.0/Foliune_0.7.0_aarch64.dmg',
  });
});

test('rejects drafts, prereleases, malformed versions, and incomplete or mismatched DMGs', () => {
  for (const invalid of [
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, tag_name: '0.7.0-rc.1' },
    { ...release, assets: [] },
    { ...release, assets: [{ ...asset, state: 'new' }] },
    { ...release, assets: [{ ...asset, size: 0 }] },
    { ...release, assets: [{ ...asset, browser_download_url: 'https://example.com/Foliune.dmg' }] },
  ]) assert.throws(() => latestReleaseManifest(invalid));
});

test('reads the latest release with the workflow token', async () => {
  let request;
  const result = await fetchLatestReleaseManifest({
    repository: 'stardut/Foliune',
    token: 'workflow-token',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => release };
    },
  });

  assert.deepEqual(result, { tag: '0.7.0', downloadUrl: asset.browser_download_url });
  assert.equal(request.url, 'https://api.github.com/repos/stardut/Foliune/releases/latest');
  assert.equal(request.options.headers.Authorization, 'Bearer workflow-token');
  assert.equal(request.options.headers.Accept, 'application/vnd.github+json');
});

test('fails the Pages package instead of silently publishing stale release metadata', async () => {
  await assert.rejects(() => fetchLatestReleaseManifest({
    repository: 'stardut/Foliune',
    token: 'workflow-token',
    fetchImpl: async () => ({ ok: false, status: 403 }),
  }), /HTTP 403/);
});
