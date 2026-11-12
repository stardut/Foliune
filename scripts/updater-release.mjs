import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseVersion } from './prepare-release.mjs';

export const updaterArchive = 'Foliune.app.tar.gz';
export const updaterSignature = `${updaterArchive}.sig`;

function decodeBase64(value) {
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.toString('base64') !== value) throw new Error('Invalid updater base64 encoding.');
  return bytes;
}

function decodePublicKey(publicKey) {
  if (!publicKey?.trim()) throw new Error('TAURI_UPDATER_PUBLIC_KEY is required.');
  const [comment, payload, ...extra] = decodeBase64(publicKey.trim()).toString('utf8').trimEnd().split('\n');
  if (!comment.startsWith('untrusted comment: ') || !payload || extra.length) throw new Error('Invalid Tauri updater public key.');
  const bytes = decodeBase64(payload);
  if (bytes.length !== 42 || bytes.toString('ascii', 0, 2) !== 'Ed') throw new Error('Invalid Minisign public key.');
  return bytes;
}

export function updaterConfig(publicKey) {
  decodePublicKey(publicKey);
  return {
    bundle: { createUpdaterArtifacts: true, macOS: { signingIdentity: '-' } },
    plugins: {
      updater: {
        pubkey: publicKey.trim(),
        endpoints: ['https://stardut.github.io/Foliune/updater.json'],
        requireSignedVersion: true,
      },
    },
  };
}

// Tauri wraps the Minisign signature box in base64. Modern Minisign signs a
// BLAKE2b-512 digest and separately signs the raw signature plus trusted comment.
export async function verifyUpdaterSignature({ tag, publicKey, signature, archive }) {
  const version = releaseVersion(tag);
  const publicKeyBytes = decodePublicKey(publicKey);
  const value = signature.trim();
  const [comment, payload, trusted, global, ...extra] = decodeBase64(value).toString('utf8').trimEnd().split('\n');
  const trustedPrefix = 'trusted comment: ';
  if (!comment.startsWith('untrusted comment: ') || !payload || !trusted?.startsWith(trustedPrefix) || !global || extra.length) {
    throw new Error('Invalid Tauri updater signature.');
  }
  const bytes = decodeBase64(payload);
  const globalSignature = decodeBase64(global);
  if (bytes.length !== 74 || bytes.toString('ascii', 0, 2) !== 'ED' || globalSignature.length !== 64) {
    throw new Error('Invalid Minisign updater signature.');
  }
  if (!bytes.subarray(2, 10).equals(publicKeyBytes.subarray(2, 10))) {
    throw new Error('Updater signature does not match the configured public key.');
  }

  const key = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: publicKeyBytes.subarray(10).toString('base64url') },
    format: 'jwk',
  });
  const trustedComment = trusted.slice(trustedPrefix.length);
  const rawSignature = bytes.subarray(10);
  if (!verify(null, Buffer.concat([rawSignature, Buffer.from(trustedComment)]), key, globalSignature)) {
    throw new Error('Updater signature trusted comment failed verification.');
  }
  const fields = trustedComment.split('\t');
  if (fields.find((field) => field.startsWith('version:')) !== `version:${version}` ||
      fields.find((field) => field.startsWith('file:')) !== `file:${updaterArchive}`) {
    throw new Error(`Updater signature does not describe ${updaterArchive} for ${version}.`);
  }

  const digest = createHash('blake2b512');
  for await (const chunk of archive) digest.update(chunk);
  if (!verify(null, digest.digest(), key, rawSignature)) throw new Error('Updater archive failed signature verification.');
  return value;
}

export async function verifyUpdaterFiles(directory, tag, publicKey) {
  return verifyUpdaterSignature({
    tag,
    publicKey,
    signature: await readFile(resolve(directory, updaterSignature), 'utf8'),
    archive: {
      async *[Symbol.asyncIterator]() {
        yield* createReadStream(resolve(directory, updaterArchive));
      },
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, path] = process.argv.slice(2);
  const { TAG_NAME, TAURI_UPDATER_PUBLIC_KEY } = process.env;
  if (command === 'config' && path) {
    await writeFile(path, `${JSON.stringify(updaterConfig(TAURI_UPDATER_PUBLIC_KEY))}\n`);
  } else if (command === 'verify' && path) {
    await verifyUpdaterFiles(path, TAG_NAME, TAURI_UPDATER_PUBLIC_KEY);
    console.log(`Verified ${updaterArchive} for ${TAG_NAME}.`);
  } else {
    throw new Error('Usage: updater-release.mjs config <file> | verify <directory>');
  }
}
