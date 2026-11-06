import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../src/features/exhibition-layout.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { exhibitionLayout, EXHIBITION_GAP } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const samples = [
  { width: 6000, height: 4000 }, { width: 4000, height: 6000 },
  { width: 4000, height: 4000 }, { width: 10000, height: 100 }, { width: 100, height: 10000 },
];
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);

test('单图按完整构图适配浏览边界，宽窄窗和矮窗不再强制满宽', () => {
  for (const width of [160, 280, 896, 1296, 1800]) for (const viewportHeight of [400, 600, 880, 1200]) for (const photo of samples) {
    const blocks = exhibitionLayout([photo], width, viewportHeight);
    assert.equal(blocks.length, 1);
    const block = blocks[0];
    assert.equal(block.start, 0);
    assert.equal(block.tiles.length, 1);
    const tile = block.tiles[0];
    assert.equal(tile.index, 0);
    assert.equal(tile.x, 0);
    assert.equal(tile.y, 0);
    assert.ok(tile.width > 0 && tile.width <= Math.min(width, 480));
    assert.ok(tile.height > 0 && tile.height <= Math.min(360, viewportHeight * .5) + 1e-7);
    close(tile.width / tile.height, photo.width / photo.height);
    close(block.height, tile.height);
    // At least one boundary is reached; the image has not been arbitrarily shrunk.
    assert.ok(Math.abs(tile.width - Math.min(width, 480)) < 1e-7 || Math.abs(tile.height - Math.min(360, viewportHeight * .5)) < 1e-7);
  }
});

test('常见单图尺寸稳定，窗口变宽不会持续放大', () => {
  assert.deepEqual(exhibitionLayout([samples[0]], 1296, 880)[0].tiles[0], { index: 0, x: 0, y: 0, width: 480, height: 320 });
  assert.deepEqual(exhibitionLayout([samples[1]], 1296, 880)[0].tiles[0], { index: 0, x: 0, y: 0, width: 240, height: 360 });
  assert.deepEqual(exhibitionLayout([samples[2]], 1296, 880)[0].tiles[0], { index: 0, x: 0, y: 0, width: 360, height: 360 });
  assert.deepEqual(exhibitionLayout([samples[0]], 1800, 880), exhibitionLayout([samples[0]], 896, 880));
  assert.deepEqual(exhibitionLayout([{ width: 0, height: 0 }], 1296, 880), exhibitionLayout([samples[2]], 1296, 880));
});

test('多图继续满宽拼贴，保持比例、每图一次、业务顺序和不重叠', () => {
  for (const count of [2, 4, 5, 7, 11]) for (const width of [280, 896, 1296]) {
    const photos = Array.from({ length: count }, (_, index) => samples[index % 3]);
    const blocks = exhibitionLayout(photos, width, 880);
    assert.deepEqual(blocks.flatMap(block => block.tiles.map(tile => tile.index)), photos.map((_, index) => index));
    for (const block of blocks) {
      close(Math.max(...block.tiles.map(tile => tile.x + tile.width)), width);
      close(Math.max(...block.tiles.map(tile => tile.y + tile.height)), block.height);
      block.tiles.forEach((tile, index) => {
        assert.ok(tile.x >= 0 && tile.y >= 0 && tile.width > 0 && tile.height > 0);
        assert.ok(tile.x + tile.width <= width + 1e-7 && tile.y + tile.height <= block.height + 1e-7);
        close(tile.width / tile.height, photos[tile.index].width / photos[tile.index].height);
        for (const other of block.tiles.slice(index + 1)) {
          assert.ok(tile.x + tile.width <= other.x + 1e-7 || other.x + other.width <= tile.x + 1e-7 || tile.y + tile.height <= other.y + 1e-7 || other.y + other.height <= tile.y + 1e-7);
        }
      });
    }
  }
  const squares = exhibitionLayout([samples[2], samples[2]], 1296, 880);
  assert.equal(squares.length, 1);
  close(squares[0].tiles[0].width, (1296 - EXHIBITION_GAP) / 2);
});

test('空输入及无效画布宽度仍返回空布局', () => {
  assert.deepEqual(exhibitionLayout([], 1296, 880), []);
  for (const width of [0, -1, NaN, Infinity]) assert.deepEqual(exhibitionLayout([samples[0]], width, 880), []);
});
