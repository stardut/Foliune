import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { releaseVersion } from './prepare-release.mjs';

export function compareVersions(left, right) {
  const a = releaseVersion(left).split('.').map(BigInt);
  const b = releaseVersion(right).split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function stableVersion(tag) {
  try { return releaseVersion(tag); } catch { return null; }
}

export function deploymentDecision({ eventName, ref, sha, mainSha, tags, deployed, isAncestor }) {
  const manual = eventName === 'workflow_dispatch' && ref === 'refs/heads/main';
  const tagged = eventName === 'push' && ref.startsWith('refs/tags/');
  if (!manual && !tagged) throw new Error('Only a version tag push or a manual main run can deploy.');
  const tag = tagged ? ref.slice('refs/tags/'.length) : null;
  if (tagged) releaseVersion(tag);
  const stableTags = tags.filter((item) => stableVersion(item.name) !== null);
  const latest = stableTags.reduce((best, item) => !best || compareVersions(item.name, best.name) > 0 ? item : best, null);
  const skip = (reason) => ({ deploy: false, reason });

  if (tagged) {
    const current = stableTags.find((item) => item.name === tag);
    if (!current || current.commit.sha !== sha) return skip('The pushed tag was deleted or moved; this run is stale.');
    if (latest && compareVersions(tag, latest.name) < 0) return skip(`A newer stable tag (${latest.name}) exists.`);
  } else if (mainSha !== sha) {
    return skip('main has moved since this manual run was requested; start a new run on main.');
  }

  if (latest) {
    const aliases = stableTags.filter((item) => compareVersions(item.name, latest.name) === 0);
    if (new Set(aliases.map((item) => item.commit.sha)).size > 1) {
      throw new Error('Tags with the same stable version point to different commits; resolve the ambiguity first.');
    }
    if (manual && !isAncestor(latest.commit.sha, sha)) {
      return skip(`main does not contain the latest stable tag (${latest.name}).`);
    }
  }

  if (deployed) {
    const previousTag = deployed.highestVersion ?? deployed.ref.replace(/^refs\/tags\//, '');
    if (tagged && stableVersion(previousTag) !== null && compareVersions(tag, previousTag) < 0) {
      return skip(`The website has already deployed a newer version (${previousTag}).`);
    }
    if (!isAncestor(deployed.sha, sha)) {
      return skip('This source does not contain the last successful website deployment; refusing a rollback.');
    }
  }
  return { deploy: true, reason: `Deploying ${tag ?? 'main'} at ${sha}.` };
}

export async function githubGet(path, { token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  const response = await fetchImpl(`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} while reading ${path}; deployment remains blocked.`);
  return response.json();
}

export async function allPages(get, path) {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await get(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error(`Expected a GitHub list for ${path}.`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

export async function lastSuccessfulDeployment(get, repository) {
  const base = `/repos/${repository}`;
  let latest = null;
  let highestVersion = null;
  // Failed, pending and inactive deployments must not hide the last successful
  // source. Scan all successes as well: a later main deployment must not erase
  // the version watermark when somebody deletes an already deployed tag.
  for (let page = 1; ; page++) {
    const deployments = await get(`${base}/deployments?environment=github-pages&per_page=100&page=${page}`);
    if (!Array.isArray(deployments)) throw new Error('Expected a GitHub deployment list.');
    for (const deployment of deployments) {
      const statuses = await allPages(get, `${base}/deployments/${deployment.id}/statuses`);
      if (!statuses.some((status) => status.state === 'success')) continue;
      latest ??= deployment;
      const version = deployment.ref?.replace(/^refs\/tags\//, '');
      if (stableVersion(version) !== null && (!highestVersion || compareVersions(version, highestVersion) > 0)) {
        highestVersion = version;
      }
    }
    if (deployments.length < 100) return latest ? { ...latest, highestVersion } : null;
  }
}

export function gitIsAncestor(older, newer, cwd = process.cwd()) {
  // Never interpret API-provided commit identifiers as command-line options.
  if (![older, newer].every((sha) => /^[a-f0-9]{40}$/i.test(sha))) throw new Error('Expected full commit SHAs.');
  const result = spawnSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd, encoding: 'utf8' });
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new Error('Could not compare website commits. Full checkout history must include the previous deployment.');
  }
  return result.status === 0;
}

export async function checkDeployment(env = process.env, fetchImpl = fetch) {
  const { GITHUB_REPOSITORY: repository, GITHUB_TOKEN: token, GITHUB_EVENT_NAME: eventName, GITHUB_REF: ref, GITHUB_SHA: sha } = env;
  if (!repository || !token || !ref || !sha) throw new Error('Missing required GitHub deployment context.');
  const get = (path) => githubGet(path, { token, apiUrl: env.GITHUB_API_URL, fetchImpl });
  const base = `/repos/${repository}`;
  const tags = await allPages(get, `${base}/tags`);
  const mainSha = eventName === 'workflow_dispatch' ? (await get(`${base}/commits/main`)).sha : null;
  const deployed = await lastSuccessfulDeployment(get, repository);
  return deploymentDecision({ eventName, ref, sha, mainSha, tags, deployed, isAncestor: gitIsAncestor });
}

export async function runDeploymentCheck(env = process.env, fetchImpl = fetch) {
  const result = await checkDeployment(env, fetchImpl);
  console.log(result.reason);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `deploy=${result.deploy}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `## Website deployment\n\n${result.reason}\n`);
  // A successful environment job creates a successful GitHub deployment even
  // when deploy-pages was skipped. Rejections MUST fail the job, or they would
  // replace the last real website deployment used by the next run's guard.
  return result.deploy ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runDeploymentCheck();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
