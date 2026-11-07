import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(resolve('apps/desktop/package.json'));
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const bundle = await build({ entryPoints: ['apps/desktop/src/features/album-cover.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
const { albumCoverStageStyle, shiftAlbumCover, zoomAlbumCover, resetAlbumCover } = module.exports;
const frame = { width: 600, height: 400 };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≈ ${expected}`);
const center = (cover, photo) => {
  const scale = Math.max(frame.width / photo.width, frame.height / photo.height) * cover.zoom;
  return [(frame.width / 2 + (photo.width * scale - frame.width) * cover.offsetX) / scale,
    (frame.height / 2 + (photo.height * scale - frame.height) * cover.offsetY) / scale];
};

for (const photo of [{ width: 1800, height: 900 }, { width: 900, height: 1800 }, { width: 1200, height: 1200 }]) {
  test(`${photo.width}×${photo.height} 拖动边界、缩放中心及往返`, () => {
    const initial = { ...resetAlbumCover('test'), offsetX: .63, offsetY: .32, zoom: 1.5 };
    const before = center(initial, photo);
    const enlarged = zoomAlbumCover(initial, photo, 2.6);
    center(enlarged, photo).forEach((value, index) => near(value, before[index]));
    const restored = zoomAlbumCover(enlarged, photo, 1.5);
    near(restored.offsetX, initial.offsetX);
    near(restored.offsetY, initial.offsetY);
    const moved = shiftAlbumCover(enlarged, photo, frame, 1e6, -1e6);
    assert.equal(moved.offsetX, 0);
    assert.equal(moved.offsetY, 1);
    const minimum = zoomAlbumCover(moved, photo, -100);
    assert.equal(minimum.zoom, 1);
    assert.ok(minimum.offsetX >= 0 && minimum.offsetX <= 1);
    assert.ok(minimum.offsetY >= 0 && minimum.offsetY <= 1);
    const scale = Math.max(frame.width / photo.width, frame.height / photo.height);
    assert.ok(photo.width * scale >= frame.width && photo.height * scale >= frame.height);
    assert.equal(zoomAlbumCover(initial, photo, 100).zoom, 3);
  });
}

test('最小铺满时无溢出的轴居中，舞台保留框外原图而不改变比例', () => {
  const cover = resetAlbumCover('portrait');
  assert.deepEqual(cover, { photoId: 'portrait', offsetX: .5, offsetY: .5, zoom: 1 });
  const portrait = { width: 100, height: 150 };
  assert.equal(shiftAlbumCover(cover, portrait, frame, 100, 0).offsetX, .5);
  const style = albumCoverStageStyle(cover, portrait);
  assert.equal(style['--album-stage-width'], '100%');
  assert.equal(style['--album-stage-height'], '225%');
  assert.equal(style['--album-stage-top'], '-62.5%');
  const zoomed = zoomAlbumCover(cover, portrait, 2);
  const returned = zoomAlbumCover(zoomed, portrait, 1);
  assert.equal(returned.offsetX, .5);
  assert.equal(returned.offsetY, .5);
});
