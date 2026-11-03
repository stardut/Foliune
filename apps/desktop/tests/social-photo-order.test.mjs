import assert from 'node:assert/strict';
import test from 'node:test';
import { movePhotoId, socialGridTarget, socialGridColumns } from '../src/features/social/social-photo-order.ts';

function grid(count, columns, { left = 20, top = 80 } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    left: left + index % columns * 109, top: top + Math.floor(index / columns) * 109,
    width: 100, height: 100,
  }));
}
const ids = Array.from({ length: 10 }, (_, index) => `photo-${index + 1}`);
function drop(source, x, y, cells = grid(10, 3)) {
  return movePhotoId(ids, source, socialGridTarget(cells, x, y));
}

test('same-row move 2 → 3 inserts without exchanging the other photos', () => {
  assert.deepEqual(drop('photo-2', 288, 130), ['photo-1', 'photo-3', 'photo-2', ...ids.slice(3)]);
});
test('cross-row move 1 → 5 preserves other IDs and their relative order', () => {
  assert.deepEqual(drop('photo-1', 179, 239), ['photo-2', 'photo-3', 'photo-4', 'photo-5', 'photo-1', ...ids.slice(5)]);
});
test('partial last-row move 10 → 2 uses the destination slot index', () => {
  assert.deepEqual(drop('photo-10', 179, 130), ['photo-1', 'photo-10', ...ids.slice(1, 9)]);
});
test('empty area to the right of the last row drops at the end', () => {
  assert.deepEqual(drop('photo-2', 320, 457), ['photo-1', ...ids.slice(2), 'photo-2']);
});
test('the right of the previous full row remains in that row, even above a partial row', () => {
  assert.equal(socialGridTarget(grid(10, 3), 320, 348), 8);
});
test('stationary pointer remains stable across repeated reordered renders', () => {
  const cells = grid(10, 3);
  let order = ids;
  for (let frame = 0; frame < 60; frame++) order = movePhotoId(order, 'photo-1', socialGridTarget(cells, 179, 239));
  assert.deepEqual(order, ['photo-2', 'photo-3', 'photo-4', 'photo-5', 'photo-1', ...ids.slice(5)]);
});
test('four-column grid, scrolled coordinates, and column count use live geometry', () => {
  const cells = grid(10, 4, { left: 350, top: -260 });
  assert.equal(socialGridColumns(cells), 4);
  assert.equal(socialGridTarget(cells, 727, -101), 7);
  assert.equal(socialGridTarget(cells, 727, 8), 9);
  assert.equal(socialGridTarget([], 0, 0), -1);
  assert.equal(socialGridColumns(grid(1, 3)), 1);
});
test('invalid insertions preserve all IDs', () => {
  assert.deepEqual(movePhotoId(ids, 'absent', 2), ids);
  assert.deepEqual(movePhotoId(ids, 'photo-1', -1), ids);
  assert.deepEqual(movePhotoId(ids, 'photo-1', ids.length), ids);
});
