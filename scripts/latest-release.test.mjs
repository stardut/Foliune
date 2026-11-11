import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../site/latest-release.js', import.meta.url), 'utf8');
const releasesPage = 'https://github.com/stardut/Foliune/releases';
const fallbackUrl = `${releasesPage}/latest`;
const manifest = {
  tag: '0.7.0',
  downloadUrl: `${releasesPage}/download/0.7.0/Foliune_0.7.0_aarch64.dmg`,
};

async function runPageScript(responseFor) {
  const elements = {
    'release-download': { href: fallbackUrl },
    'release-download-label': { dataset: { downloadLabel: 'Download DMG' }, textContent: 'Download on GitHub' },
    'release-tag': { textContent: '' },
    'release-version': { hidden: true },
    'release-notes': { href: fallbackUrl, hidden: true },
  };
  const requests = [];
  const document = { getElementById: (id) => elements[id] };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    return responseFor(url, options);
  };

  runInNewContext(source, { document, fetch });
  await new Promise((resolve) => setImmediate(resolve));
  return { elements, requests };
}

test('uses the same-origin release manifest to mount the latest DMG URL', async () => {
  const { elements, requests } = await runPageScript(async (url) => (
    url === 'latest-release.json'
      ? { ok: true, json: async () => manifest }
      : { ok: false, status: 403 }
  ));

  assert.equal(elements['release-download'].href, manifest.downloadUrl);
  assert.equal(elements['release-tag'].textContent, '0.7.0');
  assert.equal(elements['release-version'].hidden, false);
  assert.equal(elements['release-notes'].href, `${releasesPage}/tag/0.7.0`);
  assert.deepEqual(requests.map(({ url }) => url), ['latest-release.json']);
});

test('keeps the releases page available when the manifest cannot be read', async () => {
  const { elements } = await runPageScript(async () => ({ ok: false, status: 404 }));

  assert.equal(elements['release-download'].href, fallbackUrl);
  assert.equal(elements['release-version'].hidden, true);
  assert.equal(elements['release-notes'].hidden, true);
});

test('does not mount a URL that does not match the stable tag', async () => {
  const { elements } = await runPageScript(async () => ({
    ok: true,
    json: async () => ({ ...manifest, downloadUrl: 'https://example.com/other.dmg' }),
  }));

  assert.equal(elements['release-download'].href, fallbackUrl);
  assert.equal(elements['release-version'].hidden, true);
  assert.equal(elements['release-notes'].hidden, true);
});
