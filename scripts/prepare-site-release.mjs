import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const stableTag = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function latestReleaseManifest(release) {
  const tag = release?.tag_name;
  if (release?.draft !== false || release?.prerelease !== false || typeof tag !== 'string' || tag.trim() !== tag || !stableTag.test(tag) || !Array.isArray(release.assets)) {
    throw new Error('GitHub latest release is not a published stable version.');
  }

  const assetName = `Foliune_${tag.replace(/^v/, '')}_aarch64.dmg`;
  const downloadUrl = `https://github.com/stardut/Foliune/releases/download/${tag}/${assetName}`;
  const hasDownload = release.assets.some((asset) => (
    asset?.name === assetName
    && asset.state === 'uploaded'
    && Number.isFinite(asset.size)
    && asset.size > 0
    && asset.browser_download_url === downloadUrl
  ));
  if (!hasDownload) throw new Error(`GitHub latest release ${tag} has no complete Foliune DMG.`);

  return { tag, downloadUrl };
}

export async function fetchLatestReleaseManifest({ repository, token, fetchImpl = fetch }) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !token) {
    throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required.');
  }

  const response = await fetchImpl(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw new Error(`Could not read latest GitHub Release (HTTP ${response.status}).`);
  return latestReleaseManifest(await response.json());
}

async function main() {
  const manifest = await fetchLatestReleaseManifest({
    repository: process.env.GITHUB_REPOSITORY,
    token: process.env.GITHUB_TOKEN,
  });
  await writeFile(new URL('../site/latest-release.json', import.meta.url), `${JSON.stringify(manifest)}\n`);
  console.log(`Prepared website download metadata for ${manifest.tag}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
