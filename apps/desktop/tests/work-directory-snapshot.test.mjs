import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({
  entryPoints: [resolve('apps/desktop/src/features/work-directory-snapshot.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent',
});
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { recordDirectoryCommit, replaceLibrarySnapshot } = module.exports;

const group = (id, createdAt) => ({ id, name: id, createdAt });
const photo = (id, importedAt) => ({ id, title: id, importedAt });
const member = (groupId, photoId, position, status = 'active') => ({ groupId, photoId, position, status });
const viewOf = (snapshot) => ({ snapshot, pendingCommits: [], observedPhotos: [] });
const original = photo('old', '2026-11-05T00:00:00Z');
const existing = group('existing', original.importedAt);
const newPhotos = ['a', 'b'].map((id) => photo(id, '2026-11-05T00:00:01Z'));
const old = { photos: [original], groups: [existing], memberships: [member(existing.id, original.id, 0)] };
const commit = {
  libraryId: 'default', jobId: 'sync',
  album: { ...existing, name: '提交时的名称' }, createdAlbum: false,
  photos: newPhotos.toReversed(), memberships: newPhotos.map((item, i) => member(existing.id, item.id, i + 1)),
};

test('早于同步提交读取的保存结果保留用户编辑，同时补齐照片和相簿关系', () => {
  const edited = { ...original, title: '编辑后的照片' };
  const renamed = { ...existing, name: '编辑后的相簿' };
  let view = recordDirectoryCommit(viewOf(old), commit);
  view = replaceLibrarySnapshot(view, { ...old, photos: [edited], groups: [renamed] });
  assert.deepEqual(view.snapshot.photos, [...newPhotos, edited], '照片顺序和数据库一致');
  assert.deepEqual(view.snapshot.groups, [renamed]);
  assert.deepEqual(view.snapshot.memberships, [...old.memberships, ...commit.memberships]);
  assert.equal(recordDirectoryCommit(view, commit), view, '重复提交不会增加照片或关系');
});

test('观察到同步记录后，迟到的旧结果与重复事件不会覆盖新编辑或恢复已删除的相簿', () => {
  const album = group('new-album', '2026-11-05T00:00:01Z');
  const manual = group('manual', '2026-11-05T00:00:02Z');
  const newCommit = {
    ...commit, album, createdAlbum: true,
    memberships: newPhotos.map((item, i) => member(album.id, item.id, i)),
  };
  const beforeSync = { ...old, groups: [existing, manual] };
  let view = recordDirectoryCommit(viewOf(beforeSync), newCommit);
  assert.deepEqual(view.snapshot.groups, [existing, album, manual], '相簿按创建时间显示');
  const current = { ...beforeSync, photos: [newPhotos[0], { ...newPhotos[1], title: '已编辑' }, original] };
  view = replaceLibrarySnapshot(view, current);
  assert.equal(replaceLibrarySnapshot(view, beforeSync), view, '迟到的旧快照不能丢掉同步成果');
  assert.equal(recordDirectoryCommit(view, newCommit), view, '重复提交不能恢复已删除的相簿');
  assert.equal(recordDirectoryCommit(viewOf(current), newCommit).snapshot, current, '成功事件晚于已包含同步照片的快照时无需添加');
});

test('删除同步相簿后隐藏无引用照片，迟到的快照或同步事件无法使其重现', () => {
  const synced = recordDirectoryCommit(viewOf(old), commit);
  const observed = replaceLibrarySnapshot(synced, synced.snapshot);
  const deleted = { photos: [original], groups: [], memberships: [], hiddenPhotoIds: newPhotos.map((photo) => photo.id) };
  for (const view of [synced, observed, viewOf(synced.snapshot)]) {
    const next = replaceLibrarySnapshot(view, deleted);
    assert.deepEqual(next.snapshot, deleted);
    assert.equal(recordDirectoryCommit(next, commit), next);
    assert.equal(replaceLibrarySnapshot(next, synced.snapshot), next);
  }
});
