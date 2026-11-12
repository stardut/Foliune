import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { allPages, compareVersions, deploymentDecision, githubGet, gitIsAncestor, lastSuccessfulDeployment, runDeploymentCheck } from './check-pages-deployment.mjs';

const oldSha = 'a'.repeat(40);
const sha = 'b'.repeat(40);
const newSha = 'c'.repeat(40);
const tag = (name, commit = sha) => ({ name, commit: { sha: commit } });
const pushed = (extra = {}) => ({ eventName: 'push', ref: 'refs/tags/0.5.1', sha, tags: [tag('0.5.1')], deployed: null, isAncestor: () => true, ...extra });
const manual = (extra = {}) => pushed({ eventName: 'workflow_dispatch', ref: 'refs/heads/main', mainSha: sha, ...extra });

test('accept stable tags with or without v and compare numerically without integer overflow', () => {
  for (const name of ['0.5.1', 'v0.5.1']) assert.equal(deploymentDecision(pushed({ ref: `refs/tags/${name}`, tags: [tag(name)] })).deploy, true);
  assert.equal(compareVersions('v0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', 'v1.0.0'), 0);
  assert.equal(compareVersions('9007199254740993.0.0', '9007199254740992.0.0'), 1);
  assert.equal(compareVersions('1.1.0', '1.2.0'), -1);
});

test('reject malformed tags and unsupported events or manual branches', () => {
  for (const name of ['0.5.1-rc.1', '01.5.1', '0.5.1+build', '0.5.1\n', '$(id)']) {
    assert.throws(() => deploymentDecision(pushed({ ref: `refs/tags/${name}` })));
  }
  for (const extra of [{ eventName: 'pull_request' }, { ref: 'refs/heads/main' }, { eventName: 'workflow_dispatch' }, { eventName: 'workflow_dispatch', ref: 'refs/heads/feature' }]) {
    assert.throws(() => deploymentDecision(pushed(extra)));
  }
});

test('skip older, deleted or retargeted tags, and ignore non-stable tags', () => {
  assert.equal(deploymentDecision(pushed({ tags: [tag('0.5.1'), tag('v0.6.0', newSha)] })).deploy, false);
  assert.equal(deploymentDecision(pushed({ tags: [] })).deploy, false);
  assert.equal(deploymentDecision(pushed({ tags: [tag('0.5.1', newSha)] })).deploy, false);
  assert.equal(deploymentDecision(pushed({ tags: [tag('0.5.1'), tag('99.0.0-rc.1'), tag('backup')] })).deploy, true);
});

test('same-version aliases must point to the same source', () => {
  assert.equal(deploymentDecision(pushed({ tags: [tag('0.5.1'), tag('v0.5.1')] })).deploy, true);
  assert.throws(() => deploymentDecision(pushed({ tags: [tag('0.5.1'), tag('v0.5.1', newSha)] })), /different commits/);
});

test('manual main runs must still be current and contain the latest stable source', () => {
  assert.equal(deploymentDecision(manual()).deploy, true);
  assert.equal(deploymentDecision(manual({ tags: [] })).deploy, true);
  assert.equal(deploymentDecision(manual({ mainSha: newSha })).deploy, false);
  assert.equal(deploymentDecision(manual({ isAncestor: () => false })).deploy, false);
});

test('last successful deployment protects both tag reruns and manual runs from content rollback', () => {
  const deployed = { ref: 'main', sha: newSha };
  assert.equal(deploymentDecision(pushed({ deployed, isAncestor: () => false })).deploy, false);
  assert.equal(deploymentDecision(manual({ deployed, isAncestor: (a) => a !== newSha })).deploy, false);
  assert.equal(deploymentDecision(pushed({ deployed: { ref: '0.5.0', sha: oldSha } })).deploy, true);
  assert.equal(deploymentDecision(pushed({ deployed: { ref: '0.5.1', sha } })).deploy, true);
});

test('deleting a newer tag cannot allow an older version over a successful deployment', () => {
  for (const ref of ['0.6.0', 'v0.6.0', 'refs/tags/v0.6.0']) {
    assert.equal(deploymentDecision(pushed({ deployed: { ref, sha } })).deploy, false);
  }
});

test('GitHub lists are paginated, including stable tags beyond the first page', async () => {
  const calls = [];
  const tags = await allPages(async (path) => {
    calls.push(path);
    return calls.length === 1 ? Array.from({ length: 100 }, (_, i) => tag(`backup-${i}`)) : [tag('0.6.0')];
  }, '/repos/owner/repo/tags');
  assert.equal(tags.length, 101);
  assert.equal(calls[1], '/repos/owner/repo/tags?per_page=100&page=2');
  assert.equal(deploymentDecision(pushed({ tags: [tag('0.5.1'), ...tags] })).deploy, false);
  await assert.rejects(() => allPages(async () => ({}), '/tags'), /Expected a GitHub list/);
});

test('failed/pending deployments and inactive status do not hide the previous success', async () => {
  const result = await lastSuccessfulDeployment(async (path) => {
    if (path.includes('/statuses')) {
      if (path.includes('/3/')) return [{ state: 'pending' }];
      if (path.includes('/2/')) return [{ state: 'failure' }];
      return [{ state: 'inactive' }, { state: 'success' }];
    }
    return [{ id: 3 }, { id: 2 }, { id: 1, ref: '0.5.0', sha: oldSha }];
  }, 'owner/repo');
  assert.equal(result.id, 1);
  assert.equal(await lastSuccessfulDeployment(async () => [], 'owner/repo'), null);
});

test('deployment and status pagination do not skip old successful deployments', async () => {
  const result = await lastSuccessfulDeployment(async (path) => {
    if (path.includes('/statuses')) {
      if (!path.includes('/1/')) return [];
      return path.endsWith('page=1') ? Array.from({ length: 100 }, () => ({ state: 'inactive' })) : [{ state: 'success' }];
    }
    return path.endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => ({ id: 200 - i })) : [{ id: 1, sha: oldSha }];
  }, 'owner/repo');
  assert.equal(result.id, 1);
  await assert.rejects(() => lastSuccessfulDeployment(async () => { throw new Error('403'); }, 'owner/repo'), /403/);
});

test('API failures fail closed and requests only read with the provided token', async () => {
  await assert.rejects(() => githubGet('/repos/owner/repo/tags', { token: 'test-token', fetchImpl: async () => ({ ok: false, status: 403 }) }), /deployment remains blocked/);
  const result = await githubGet('/repos/owner/repo/tags', { token: 'test-token', fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.github.com/repos/owner/repo/tags');
    assert.equal(init.headers.Authorization, 'Bearer test-token');
    assert.equal(init.method, undefined);
    return { ok: true, json: async () => [] };
  } });
  assert.deepEqual(result, []);
});

test('real Git ancestry accepts forward/equal commits and blocks rollback/divergence', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'foliune-pages-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Deployment Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(cwd, 'fixture'), 'base');
  git('add', 'fixture');
  git('commit', '--quiet', '-m', 'base');
  const first = git('rev-parse', 'HEAD');
  writeFileSync(join(cwd, 'fixture'), 'new');
  git('commit', '--quiet', '-am', 'new');
  const second = git('rev-parse', 'HEAD');
  assert.equal(gitIsAncestor(first, second, cwd), true);
  assert.equal(gitIsAncestor(second, second, cwd), true);
  assert.equal(gitIsAncestor(second, first, cwd), false);
  git('checkout', '--quiet', '--detach', first);
  writeFileSync(join(cwd, 'fixture'), 'other');
  git('commit', '--quiet', '-am', 'other');
  assert.equal(gitIsAncestor(second, git('rev-parse', 'HEAD'), cwd), false);
  assert.throws(() => gitIsAncestor(oldSha, second, cwd), /Full checkout history/);
  assert.throws(() => gitIsAncestor('--help', second, cwd), /full commit SHAs/);
});

test('workflow keeps exact source, shared queue, guarded deploy, and scoped permissions', () => {
  const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const releaseWorkflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const ciWorkflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /group: github-pages\s+cancel-in-progress: false/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.equal((workflow.match(/ref: \$\{\{ github.sha \}\}/g) ?? []).length, 2);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /deployments: read/);
  assert.match(workflow, /name: Prepare release download and updater metadata[\s\S]*?GITHUB_TOKEN: \$\{\{ github\.token \}\}[\s\S]*?TAURI_UPDATER_PUBLIC_KEY: \$\{\{ vars\.TAURI_UPDATER_PUBLIC_KEY \}\}[\s\S]*?run: node scripts\/prepare-site-release\.mjs/);
  assert.match(workflow, /name: Upload website[\s\S]*?path: site\//);
  assert.match(workflow, /if: steps.guard.outputs.deploy == 'true'/);
  assert.match(workflow, /path: site\//);
  assert.doesNotMatch(workflow, /contents: write|deployments: write/);
  assert.doesNotMatch(workflow + ciWorkflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(releaseWorkflow, /deploy-website:[\s\S]*?needs: publish[\s\S]*?uses: \.\/\.github\/workflows\/pages\.yml/);
  assert.match(releaseWorkflow, /Validate manual release source[\s\S]*?if: github\.event_name == 'workflow_dispatch'[\s\S]*?refs\/heads\/main/);
  assert.match(releaseWorkflow, /deploy-website:[\s\S]*?github\.event_name == 'workflow_dispatch'[\s\S]*?refs\/heads\/main[\s\S]*?uses: \.\/\.github\/workflows\/pages\.yml/);
  assert.match(ciWorkflow, /run: pnpm test:pages/);
});

test('rejected environment jobs fail instead of creating a false successful deployment', async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'foliune-pages-output-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = {
    GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'test-token',
    GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/0.5.1', GITHUB_SHA: sha,
    GITHUB_OUTPUT: join(cwd, 'output'), GITHUB_STEP_SUMMARY: join(cwd, 'summary'),
  };
  const exitCode = await runDeploymentCheck(env, async (url) => ({
    ok: true,
    json: async () => url.includes('/tags?') ? [tag('0.5.1'), tag('0.6.0', newSha)] : [],
  }));
  assert.equal(exitCode, 1);
  assert.equal(readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'deploy=false\n');
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, 'utf8'), /newer stable tag/);

  // An older rejected run may be newer in the deployment list, but its failed
  // status must not hide the actual live main deployment from a later tag rerun.
  const deployed = await lastSuccessfulDeployment(async (path) => {
    if (path.includes('/statuses')) return [{ state: path.includes('/2/') ? 'failure' : 'success' }];
    return [{ id: 2, sha: oldSha, ref: '0.4.0' }, { id: 1, sha: newSha, ref: 'main' }];
  }, 'owner/repo');
  assert.equal(deploymentDecision(pushed({ deployed, isAncestor: () => false })).deploy, false);
});

test('a later main deployment cannot erase a deleted higher release version watermark', async () => {
  const deployed = await lastSuccessfulDeployment(async (path) => {
    if (path.includes('/statuses')) return [{ state: 'success' }];
    return [
      { id: 3, ref: 'main', sha },
      { id: 2, ref: 'refs/tags/v0.6.0', sha: oldSha },
      { id: 1, ref: '0.5.0', sha: oldSha },
    ];
  }, 'owner/repo');
  assert.equal(deployed.sha, sha);
  assert.equal(deployed.highestVersion, 'refs/tags/v0.6.0'.replace('refs/tags/', ''));
  assert.equal(deploymentDecision(pushed({ deployed })).deploy, false);
  assert.equal(deploymentDecision(manual({ deployed })).deploy, true);
  assert.equal(deploymentDecision(pushed({ ref: 'refs/tags/0.7.0', tags: [tag('0.7.0')], deployed })).deploy, true);
});
