const releasePages = 'https://github.com/stardut/Foliune/releases';
const releaseTag = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

async function updateLatestRelease() {
  const response = await fetch('latest-release.json', { cache: 'no-cache' });
  if (!response.ok) return;

  const { tag, downloadUrl } = await response.json();
  if (typeof tag !== 'string' || tag.trim() !== tag || !releaseTag.test(tag)) return;

  const assetName = `Foliune_${tag.replace(/^v/, '')}_aarch64.dmg`;
  if (downloadUrl !== `${releasePages}/download/${tag}/${assetName}`) return;

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
