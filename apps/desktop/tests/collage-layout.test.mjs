import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLAGE_MAX_EDGE, COLLAGE_MAX_PIXELS, collageLayout, collageReferenceLayout, collageOutputProblem, collageProblem, cropFor, initialCollage, movePhoto, recordHistory, redoHistory, resizeCollage, undoHistory } from '../src/features/collage/collage-layout.ts';

function photo(id, width, height) { return { id, width, height, originalAvailable: true }; }
const photos = [photo('landscape', 6000, 4000), photo('portrait', 4000, 6000), photo('square', 4800, 4800), photo('wide', 9000, 2000), photo('tall', 2000, 9000)];
test('default output preserves original detail instead of shrinking to the preview width or smallest source', () => {
  const sources = [photo('large', 6000, 4000), photo('small', 800, 1200)];
  for (const mode of ['adaptive', 'grid', 'long']) {
    const state = { ...initialCollage(sources.map((source) => source.id)), mode };
    const layout = collageLayout(state, sources);
    for (const item of layout.items) {
      const source = sources.find((source) => source.id === item.photoId);
      const crop = cropFor(state, item.photoId);
      const sampling = (crop.fit === 'cover' ? Math.max(item.width / source.width, item.height / source.height) * crop.zoom : Math.min(item.width / source.width, item.height / source.height));
      assert.ok(sampling >= 1, `${mode}/${item.photoId}: original sampling scale ${sampling}, output ${layout.width}×${layout.height}`);
    }
  }
});
test('zoomed cover preserves the visible source pixels without requiring the cropped-away pixels', () => {
  const sources = [photo('a', 6000, 4000), photo('b', 6000, 4000)];
  const state = { ...initialCollage(['a', 'b']), mode: 'grid', crops: { a: { fit: 'cover', offsetX: .1, offsetY: .9, zoom: 2 }, b: { fit: 'cover', offsetX: .5, offsetY: .5, zoom: 2 } } };
  const layout = collageLayout(state, sources);
  for (const item of layout.items) assert.ok(Math.max(item.width / 6000, item.height / 4000) * 2 >= 1, `visible crop was downsampled to ${item.width}×${item.height}`);
  assert.ok(layout.width < 6000, 'zoom should size for the visible crop, not the entire source');
});
function overlaps(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
function check(layout, ids) {
  assert.deepEqual(layout.items.map((item) => item.photoId), ids);
  assert.ok(Number.isInteger(layout.width) && Number.isInteger(layout.height));

  layout.items.forEach((a, index) => {
    assert.ok([a.x, a.y, a.width, a.height].every(Number.isInteger));
    assert.ok(a.x >= 0 && a.y >= 0 && a.width > 0 && a.height > 0 && a.x + a.width <= layout.width && a.y + a.height <= layout.height);
    layout.items.slice(index + 1).forEach((b) => assert.equal(overlaps(a, b), false, `${a.photoId} overlaps ${b.photoId}`));
  });
}
for (const mode of ['adaptive', 'grid', 'long']) for (const frame of ['auto', '1:1', '4:3', '3:4', '3:2', '2:3']) {
  test(`${mode}/${frame} retains order, integer bounds, unique coverage and no overlaps`, () => {
    const state = { ...initialCollage(photos.map((p) => p.id)), mode, frame };
    const layout = collageLayout(state, photos); check(layout, state.photoIds);
    assert.equal(collageProblem(state, photos, layout), '');
    if (mode !== 'grid') for (const item of layout.items) {
      const source = photos.find((p) => p.id === item.photoId);
      // One-pixel boundary rounding is the only permitted geometry deviation;
      // contain rendering itself always preserves the source ratio exactly.
      assert.ok(Math.abs(item.width - item.height * source.width / source.height) <= 4);
      assert.equal(cropFor(state, item.photoId).fit, 'contain');
    }
  });
}
test('grid crops remain local to each stable ID and are inactive in complete-image modes', () => {
  const state = { ...initialCollage(['a', 'b']), mode: 'grid', crops: { a: { fit: 'cover', offsetX: .2, offsetY: .8, zoom: 2 }, b: { fit: 'contain', offsetX: .5, offsetY: .5, zoom: 1 } } };
  assert.equal(cropFor(state, 'a').zoom, 2);
  assert.equal(cropFor(state, 'b').fit, 'contain');
  assert.equal(cropFor({ ...state, mode: 'long' }, 'a').fit, 'contain');
  assert.equal(cropFor({ ...state, mode: 'adaptive' }, 'a').zoom, 1);
});
test('100-photo output preserves detail and reports unsupported sizes without silently reducing resolution', () => {
  const sources = Array.from({ length: 100 }, (_, i) => photo(`p${i}`, i % 2 ? 800 : 1200, i % 2 ? 1200 : 800));
  for (const mode of ['adaptive', 'grid', 'long']) {
    const state = { ...initialCollage(sources.map((p) => p.id)), mode };
    const layout = collageLayout(state, sources); check(layout, state.photoIds);
    for (const item of layout.items) {
      const source = sources.find((p) => p.id === item.photoId);
      const factor = mode === 'grid' ? Math.max(item.width / source.width, item.height / source.height) : Math.min(item.width / source.width, item.height / source.height);
      assert.ok(factor >= .999);
    }
    const unsupported = layout.width > COLLAGE_MAX_EDGE || layout.height > COLLAGE_MAX_EDGE || layout.width * layout.height > COLLAGE_MAX_PIXELS;
    assert.equal(!!collageOutputProblem(layout), unsupported);
  }
});
test('extreme ratios report unsupported native dimensions instead of silently reducing detail', () => {
  const sources = [photo('wide', 10000, 10), photo('tall', 10, 10000)];
  const state = { ...initialCollage(sources.map((p) => p.id)), mode: 'long', frame: '1:1' };
  const layout = collageLayout(state, sources);
  assert.match(collageOutputProblem(layout), /32,768/);
  assert.ok(layout.width > COLLAGE_MAX_EDGE || layout.height > COLLAGE_MAX_EDGE || layout.width * layout.height > COLLAGE_MAX_PIXELS);
});
test('integer output retains every source density across mixed ratios, frames and local crops', () => {
  let seed = 20261102;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let sample = 0; sample < 120; sample++) {
    const sources = Array.from({ length: 2 + Math.floor(random() * 10) }, (_, index) => photo(String(index), 200 + Math.floor(random() * 8800), 200 + Math.floor(random() * 8800)));
    const state = { ...initialCollage(sources.map((p) => p.id)), mode: ['adaptive', 'grid', 'long'][sample % 3], frame: ['auto', '1:1', '4:3', '3:4', '3:2', '2:3'][sample % 6], crops: Object.fromEntries(sources.map((p) => [p.id, { fit: random() < .3 ? 'contain' : 'cover', offsetX: random(), offsetY: random(), zoom: 1 + random() * 7 }])) };
    const reference = collageReferenceLayout(state, sources);
    assert.equal(reference.width, 2400, 'preview geometry is independent of source resolution');
    const layout = collageLayout(state, sources);
    check(layout, state.photoIds);
    for (const item of layout.items) {
      const source = sources.find((p) => p.id === item.photoId);
      const crop = cropFor(state, item.photoId);
      const sampling = crop.fit === 'cover' ? Math.max(item.width / source.width, item.height / source.height) * crop.zoom : Math.min(item.width / source.width, item.height / source.height);
      assert.ok(sampling >= 1, `sample ${sample}/${item.photoId}: ${sampling}`);
    }
  }
});
test('source missing, too few, too many and absent IDs are explicit errors', () => {
  for (const state of [initialCollage(['landscape']), initialCollage(['landscape', 'missing']), initialCollage(Array.from({ length: 101 }, (_, i) => String(i)))]) assert.notEqual(collageProblem(state, photos, collageLayout(state, photos)), '');
  const missing = photos.map((p) => ({ ...p, originalAvailable: p.id !== 'portrait' }));
  const state = initialCollage(['landscape', 'portrait']); assert.match(collageProblem(state, missing, collageLayout(state, missing)), /原图/);
});
test('locked output sizing scales boundaries together without overlap or reordering', () => {
  const state = initialCollage(photos.map((p) => p.id));
  const layout = collageLayout(state, photos);
  for (const edge of [800, 2400, 6000]) {
    const output = resizeCollage(layout, edge); check(output, state.photoIds);
    assert.equal(Math.max(output.width, output.height), edge);
    assert.ok(Math.abs(output.width / output.height - layout.width / layout.height) < .003);
  }
});
test('insertion sorting preserves every ID and keeps unaffected relative order', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(movePhoto(ids, 'a', 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(movePhoto(ids, 'd', 0), ['d', 'a', 'b', 'c']);
  assert.equal(movePhoto(ids, 'missing', 1), ids);
  assert.equal(movePhoto(ids, 'a', -1), ids);
  assert.equal(movePhoto(ids, 'a', 4), ids);
});
test('undo/redo restore order, layout and crop together; branching clears future', () => {
  const first = initialCollage(['a', 'b']);
  let history = { past: [], present: first, future: [] };
  history = recordHistory(history, { ...first, mode: 'grid', crops: { a: { fit: 'cover', zoom: 2, offsetX: .1, offsetY: .9 } } });
  const edited = history.present;
  history = recordHistory(history, { ...edited, photoIds: ['b', 'a'] });
  history = undoHistory(history); assert.deepEqual(history.present, edited);
  history = undoHistory(history); assert.deepEqual(history.present, first);
  history = redoHistory(history); assert.deepEqual(history.present, edited);
  history = recordHistory(history, { ...edited, background: '#191919' }); assert.equal(history.future.length, 0);
  assert.equal(recordHistory(history, history.present), history);
});
