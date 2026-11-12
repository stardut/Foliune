import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchSiteReleaseManifests, latestReleaseManifest } from './prepare-site-release.mjs';
import { updaterArchive, updaterSignature } from './updater-release.mjs';
import { signedFixture } from './updater-release.test-fixtures.mjs';

const asset = {
  name: 'Foliune_0.7.0_aarch64.dmg',
  state: 'uploaded',
  size: 1024,
  browser_download_url: 'https://github.com/stardut/Foliune/releases/download/0.7.0/Foliune_0.7.0_aarch64.dmg',
};
const release = { draft: false, prerelease: false, tag_name: '0.7.0', assets: [asset] };
const repository = 'stardut/Foliune';
const token = 'workflow-token';
const latestUrl = `https://api.github.com/repos/${repository}/releases/latest`;

function updaterAsset(name) {
  return { ...asset, name, browser_download_url: `https://github.com/${repository}/releases/download/${release.tag_name}/${name}` };
}

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

test('reads the latest release with the workflow token and emits valid no-update JSON for an old DMG-only release', async () => {
  let request;
  const result = await fetchSiteReleaseManifests({
    repository,
    token,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => release };
    },
  });

  assert.deepEqual(result, {
    latestRelease: { tag: '0.7.0', downloadUrl: asset.browser_download_url },
    updater: { version: '0.0.0', platforms: {} },
  });
  assert.equal(request.url, latestUrl);
  assert.equal(request.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.options.headers.Accept, 'application/vnd.github+json');
});

test('generates both manifests from the same stable release and verifies the actual downloaded assets', async () => {
  const signed = signedFixture('0.7.0');
  const archiveAsset = updaterAsset(updaterArchive);
  const signatureAsset = updaterAsset(updaterSignature);
  const requests = [];
  const result = await fetchSiteReleaseManifests({
    repository, token, publicKey: signed.publicKey,
    fetchImpl: async (url, options) => {
      requests.push(url);
      if (url === latestUrl) return Response.json({ ...release, assets: [asset, archiveAsset, signatureAsset] });
      assert.equal(options.headers, undefined);
      if (url === signatureAsset.browser_download_url) return new Response(signed.signature);
      assert.equal(url, archiveAsset.browser_download_url);
      return new Response(signed.archive);
    },
  });
  assert.deepEqual(requests, [latestUrl, signatureAsset.browser_download_url, archiveAsset.browser_download_url]);
  assert.deepEqual(result, {
    latestRelease: { tag: '0.7.0', downloadUrl: asset.browser_download_url },
    updater: { version: '0.7.0', platforms: { 'darwin-aarch64': { url: archiveAsset.browser_download_url, signature: signed.signature } } },
  });
});

test('rejects a partial pair or an asset URL that does not match the same stable release', async () => {
  const archive = updaterAsset(updaterArchive);
  const signature = updaterAsset(updaterSignature);
  for (const assets of [
    [asset, archive],
    [asset, signature],
    [asset, archive, { ...signature, size: 0 }],
    [asset, { ...archive, browser_download_url: archive.browser_download_url.replace('0.7.0', '0.6.0') }, signature],
  ]) {
    await assert.rejects(fetchSiteReleaseManifests({
      repository, token,
      fetchImpl: async (url) => {
        assert.equal(url, latestUrl);
        return Response.json({ ...release, assets });
      },
    }), /has no complete Foliune\.app/);
  }
});

test('rejects a downloaded archive with a mismatched signature', async () => {
  const signed = signedFixture('0.7.0');
  const archive = updaterAsset(updaterArchive);
  const signature = updaterAsset(updaterSignature);
  await assert.rejects(fetchSiteReleaseManifests({
    repository, token, publicKey: signed.publicKey,
    fetchImpl: async (url) => {
      if (url === latestUrl) return Response.json({ ...release, assets: [asset, archive, signature] });
      return new Response(url === signature.browser_download_url ? signed.signature : 'different archive');
    },
  }), /archive failed signature/);
});

test('fails the Pages package instead of silently publishing stale release metadata', async () => {
  await assert.rejects(() => fetchSiteReleaseManifests({
    repository,
    token,
    fetchImpl: async () => ({ ok: false, status: 403 }),
  }), /HTTP 403/);
});
