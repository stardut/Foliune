const latestReleaseApi = 'https://api.github.com/repos/stardut/Foliune/releases/latest';
const releasePages = 'https://github.com/stardut/Foliune/releases';
const releaseTag = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function updateLatestRelease() {
  const response = await fetch(latestReleaseApi, { cache: 'no-cache' });
  if (!response.ok) return;

  const { draft, prerelease, tag_name: tag, assets } = await response.json();
  if (draft || prerelease || typeof tag !== 'string' || tag.trim() !== tag || !releaseTag.test(tag) || !Array.isArray(assets)) return;

  const assetName = `Foliune_${tag.replace(/^v/, '')}_aarch64.dmg`;
  const downloadUrl = `${releasePages}/download/${tag}/${assetName}`;
  const hasDownload = assets.some(({ name, state, size, browser_download_url: url }) => (
    name === assetName
    && state === 'uploaded'
    && size > 0
    && url === downloadUrl
  ));
  if (!hasDownload) return;

  const notes = document.getElementById('release-notes');
  const label = document.getElementById('release-download-label');
  document.getElementById('release-download').href = downloadUrl;
  label.textContent = label.dataset.downloadLabel;
  document.getElementById('release-tag').textContent = tag;
  document.getElementById('release-version').hidden = false;
  notes.href = `${releasePages}/tag/${tag}`;
  notes.hidden = false;
}

updateLatestRelease().catch(() => {
  // Keep the GitHub link already available in the page.
});
