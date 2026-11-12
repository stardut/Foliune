import assert from 'node:assert/strict';
import test from 'node:test';
import { updaterConfig, verifyUpdaterSignature } from './updater-release.mjs';
import { signedFixture } from './updater-release.test-fixtures.mjs';

test('creates a release-only updater configuration with the fixed production endpoint', () => {
  const { publicKey } = signedFixture('0.7.0');
  assert.deepEqual(updaterConfig(` ${publicKey}\n`), {
    bundle: { createUpdaterArtifacts: true, macOS: { signingIdentity: '-' } },
    plugins: {
      updater: {
        pubkey: publicKey,
        endpoints: ['https://stardut.github.io/Foliune/updater.json'],
        requireSignedVersion: true,
      },
    },
  });
  assert.throws(() => updaterConfig(''), /TAURI_UPDATER_PUBLIC_KEY/);
  assert.throws(() => updaterConfig('not-a-key'), /encoding/);
});

test('verifies a version-bound archive and rejects another key, version, comment, or archive', async () => {
  const { archive, publicKey, signature } = signedFixture('0.7.0');
  const args = { tag: 'v0.7.0', publicKey, signature, archive: [archive] };
  assert.equal(await verifyUpdaterSignature(args), signature);
  await assert.rejects(verifyUpdaterSignature({ ...args, publicKey: signedFixture('0.7.0').publicKey }), /public key/);
  await assert.rejects(verifyUpdaterSignature({ ...args, tag: 'v0.7.1' }), /0\.7\.1/);
  await assert.rejects(verifyUpdaterSignature({ ...args, archive: [Buffer.from('different archive')] }), /archive failed/);
  const tampered = Buffer.from(signature, 'base64').toString('utf8').replace('version:0.7.0', 'version:0.7.1');
  await assert.rejects(verifyUpdaterSignature({ ...args, tag: 'v0.7.1', signature: Buffer.from(tampered).toString('base64') }), /trusted comment failed/);
});
