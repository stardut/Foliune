import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, openSync, closeSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { completeAsset, releaseVersion } from './prepare-release.mjs';
import { updaterArchive, updaterSignature, verifyUpdaterFiles } from './updater-release.mjs';

const updaterAssets = [updaterArchive, updaterSignature];
const releaseNotes = '## 安装\n\n下载下方 DMG，打开后将 Foliune 拖入 Applications。\n\n此安装包仅面向 Apple Silicon，采用 ad-hoc 签名，未经 Apple Developer ID 签名或公证；macOS 可能阻止首次打开。最低系统要求沿用应用配置，实际兼容系统仍需实机验证。';

function assetNamed(release, name) {
  return release.assets.find((asset) => asset.name === name);
}

async function assetDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

async function fillDraft({ release, dmgName, staged, github, digests }) {
  const dmg = assetNamed(release, dmgName);
  if (!completeAsset(dmg)) {
    if (dmg) await github.remove(dmg.id);
    await github.upload(release, dmgName, resolve(staged, dmgName));
  }
  if (!digests) return;

  const existing = updaterAssets.map((name) => assetNamed(release, name));
  if (existing.every(completeAsset)) return;
  // Keep a partial upload only if GitHub's digest identifies the exact staged bytes.
  // Remove stale members before uploading so an interruption cannot leave a mixed pair.
  const replacements = updaterAssets.filter((name, index) => (
    !completeAsset(existing[index]) || existing[index].digest !== digests.get(name)
  ));
  for (const name of replacements) {
    const asset = assetNamed(release, name);
    if (asset) await github.remove(asset.id);
  }
  for (const name of replacements) {
    await github.upload(release, name, resolve(staged, name));
  }
}

async function verifyPublishedAssets({ release, tag, dmgName, github, digests, publicKey }) {
  if (release.tag_name !== tag || release.prerelease !== false || !completeAsset(assetNamed(release, dmgName))) {
    throw new Error(`Release ${tag} has no complete stable Foliune DMG.`);
  }
  if (!digests) return;

  const assets = updaterAssets.map((name) => assetNamed(release, name));
  if (!assets.every(completeAsset)) throw new Error(`Release ${tag} has an incomplete updater asset pair.`);
  if (assets.every((asset) => asset.digest === digests.get(asset.name))) return;

  // A previous build can differ byte for byte. Verify the actual preserved pair.
  const temporary = await mkdtemp(resolve(tmpdir(), 'foliune-release-'));
  try {
    for (const asset of assets) await github.download(asset.id, resolve(temporary, asset.name));
    await verifyUpdaterFiles(temporary, tag, publicKey);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function publishRelease({ tag, updater, staged, publicKey, github }) {
  const dmgName = `Foliune_${releaseVersion(tag)}_aarch64.dmg`;
  const dmg = await stat(resolve(staged, dmgName));
  if (!dmg.isFile() || dmg.size === 0) throw new Error(`Expected a nonempty staged ${dmgName}.`);

  let digests;
  if (updater) {
    await verifyUpdaterFiles(staged, tag, publicKey);
    digests = new Map(await Promise.all(updaterAssets.map(async (name) => [name, await assetDigest(resolve(staged, name))])));
  }
  let release = await github.find(tag);
  release ??= await github.create(tag);
  if (release.tag_name !== tag || release.prerelease !== false) throw new Error(`Expected a stable GitHub Release for ${tag}.`);
  if (release.draft) {
    await fillDraft({ release, dmgName, staged, github, digests });
    release = await github.get(release.id);
  }
  await verifyPublishedAssets({ release, tag, dmgName, github, digests, publicKey });
  // Let GitHub choose the latest release by creation date and SemVer when tags finish out of order.
  if (release.draft) release = await github.publish(release.id, { makeLatest: 'legacy' });
  if (release.tag_name !== tag || release.draft !== false || release.prerelease !== false) throw new Error(`Release ${tag} is not public and stable.`);
  return release;
}

function gh(args, options = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
}

function githubReleaseClient(repository) {
  const base = `repos/${repository}/releases`;
  const get = (id) => JSON.parse(gh(['api', `${base}/${id}`]));
  return {
    find(tag) {
      const pages = JSON.parse(gh(['api', '--paginate', '--slurp', `${base}?per_page=100`]));
      return pages.flat().find((release) => release.tag_name === tag);
    },
    create(tag) {
      gh(['release', 'create', tag, '--repo', repository, '--draft', '--verify-tag',
        '--title', `Foliune ${tag}`, '--notes', releaseNotes, '--generate-notes']);
      return this.find(tag);
    },
    get,
    remove(id) {
      gh(['api', '--method', 'DELETE', `${base}/assets/${id}`]);
    },
    upload(release, name, path) {
      const url = new URL(release.upload_url.split('{')[0]);
      if (url.origin !== 'https://uploads.github.com' || url.pathname !== `/${base}/${release.id}/assets`) {
        throw new Error('Unexpected GitHub Release upload URL.');
      }
      url.searchParams.set('name', name);
      gh(['api', '--method', 'POST', url.href, '--header', 'Content-Type: application/octet-stream', '--input', path]);
    },
    download(id, path) {
      const fd = openSync(path, 'wx');
      try {
        gh(['api', '--header', 'Accept: application/octet-stream', `${base}/assets/${id}`], { stdio: ['ignore', fd, 'inherit'] });
      } finally {
        closeSync(fd);
      }
    },
    publish(id, { makeLatest }) {
      return JSON.parse(gh(['api', '--method', 'PATCH', `${base}/${id}`, '-F', 'draft=false', '-f', `make_latest=${makeLatest}`]));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { GITHUB_REPOSITORY, TAG_NAME, UPDATER_ENABLED, TAURI_UPDATER_PUBLIC_KEY } = process.env;
  const [staged] = process.argv.slice(2);
  if (!staged || !GITHUB_REPOSITORY) throw new Error('Expected a staged artifact directory and GITHUB_REPOSITORY.');
  if (UPDATER_ENABLED !== 'true' && UPDATER_ENABLED !== 'false') throw new Error('UPDATER_ENABLED must describe the tagged build.');
  await publishRelease({
    tag: TAG_NAME,
    updater: UPDATER_ENABLED === 'true',
    staged,
    publicKey: TAURI_UPDATER_PUBLIC_KEY,
    github: githubReleaseClient(GITHUB_REPOSITORY),
  });
  console.log(`Verified public GitHub Release ${TAG_NAME}.`);
}
