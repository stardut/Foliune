import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { completeAsset, releaseVersion } from './prepare-release.mjs';
import { updaterArchive, updaterSignature, verifyUpdaterSignature } from './updater-release.mjs';

function publicReleaseAsset(release, name) {
  const url = `https://github.com/stardut/Foliune/releases/download/${release.tag_name}/${name}`;
  const asset = release.assets.find((item) => item?.name === name);
  if (!completeAsset(asset) || asset.browser_download_url !== url) {
    throw new Error(`GitHub latest release ${release.tag_name} has no complete ${name}.`);
  }
  return asset;
}

export function latestReleaseManifest(release) {
  const tag = release?.tag_name;
  if (release?.draft !== false || release?.prerelease !== false || !Array.isArray(release.assets)) {
    throw new Error('GitHub latest release is not a published stable version.');
  }
  const version = releaseVersion(tag);
  const dmg = publicReleaseAsset(release, `Foliune_${version}_aarch64.dmg`);
  return { tag, downloadUrl: dmg.browser_download_url };
}

async function downloadAsset(asset, fetchImpl) {
  // Public asset downloads may redirect to GitHub's CDN. The workflow token is only for the API.
  const response = await fetchImpl(asset.browser_download_url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Could not download ${asset.name} (HTTP ${response.status}).`);
  return response;
}

async function updaterManifest(release, publicKey, fetchImpl) {
  if (!release.assets.some((asset) => [updaterArchive, updaterSignature].includes(asset?.name))) {
    // Pages serves static JSON with HTTP 200. No shipped client is older than 0.0.0.
    return { version: '0.0.0', platforms: {} };
  }
  const archive = publicReleaseAsset(release, updaterArchive);
  const signature = publicReleaseAsset(release, updaterSignature);
  const signatureResponse = await downloadAsset(signature, fetchImpl);
  const signatureValue = await verifyUpdaterSignature({
    tag: release.tag_name,
    publicKey,
    signature: await signatureResponse.text(),
    archive: {
      async *[Symbol.asyncIterator]() {
        const response = await downloadAsset(archive, fetchImpl);
        yield* response.body;
      },
    },
  });
  return {
    version: releaseVersion(release.tag_name),
    platforms: { 'darwin-aarch64': { url: archive.browser_download_url, signature: signatureValue } },
  };
}

export async function fetchSiteReleaseManifests({ repository, token, publicKey, fetchImpl = fetch }) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !token) {
    throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required.');
  }

  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not read latest GitHub Release (HTTP ${response.status}).`);
  const release = await response.json();
  const latestRelease = latestReleaseManifest(release);
  return { latestRelease, updater: await updaterManifest(release, publicKey, fetchImpl) };
}

async function main() {
  const { latestRelease, updater } = await fetchSiteReleaseManifests({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
    publicKey: process.env.TAURI_UPDATER_PUBLIC_KEY,
  });
  await Promise.all([
    writeFile(new URL('../site/latest-release.json', import.meta.url), `${JSON.stringify(latestRelease)}\n`),
    writeFile(new URL('../site/updater.json', import.meta.url), `${JSON.stringify(updater)}\n`),
  ]);
  console.log(`Prepared website release metadata for ${latestRelease.tag}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
