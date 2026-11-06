import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`;
const geometrySource = readFileSync(new URL('../src/features/exhibition-layout.ts', import.meta.url), 'utf8');
const geometryUrl = moduleUrl(geometrySource);
const { exhibitionLayout } = await import(geometryUrl);
const wallSource = readFileSync(new URL('../src/features/photo-wall-layout.ts', import.meta.url), 'utf8').replace("'./exhibition-layout'", JSON.stringify(geometryUrl));
const wallUrl = moduleUrl(wallSource);
const { photoWallLayout, photoWallLayoutBatches, visibleWallRange } = await import(wallUrl);
const { sortAlbumPhotos, workPhotoSections } = await import(moduleUrl(readFileSync(new URL('../src/features/library-photo-order.ts', import.meta.url), 'utf8')));
const photos = (count) => Array.from({ length: count }, (_, index) => ({ width: [6000, 4000, 4000][index % 3], height: [4000, 6000, 4000][index % 3] }));

function verifyUnits(wall, count) {
  assert.deepEqual(wall.units.flatMap((unit) => unit.tiles.map((tile) => tile.index)), Array.from({ length: count }, (_, index) => index));
  for (let index = 0; index < wall.units.length; index++) {
    const unit = wall.units[index];
    assert.ok(unit.height > 0 && Number.isFinite(unit.height));
    if (index) assert.ok(unit.top >= wall.units[index - 1].top + wall.units[index - 1].height - 1e-7);
  }
  const last = wall.units.at(-1);
  assert.equal(wall.height, last ? last.top + last.height : 0);
}

test('65张相簿是同一完整布局，尾部照片不被60张边界截断', () => {
  for (const layout of ['exhibition', 'grid']) for (const width of [280, 896, 1296]) {
    const input = photos(65);
    const options = { sections: [{ photos: input }], layout, width, viewportHeight: 880, bleed: 24 };
    const [batch, ...later] = photoWallLayoutBatches(options);
    assert.equal(batch.complete, true);
    assert.deepEqual(later, []);
    const wall = photoWallLayout(options);
    verifyUnits(wall, 65);
    const [start, end] = visibleWallRange(wall.units, Math.max(0, wall.height - 700), 700, 900);
    assert.ok(wall.units.slice(start, end).flatMap((unit) => unit.tiles).some((tile) => tile.index === 64));
    if (layout === 'exhibition') {
      const expected = exhibitionLayout(input, width + 48, 880);
      assert.deepEqual(wall.units.map((unit) => unit.tiles), expected.map((block) => block.tiles));
      for (const unit of wall.units) for (const tile of unit.tiles) {
        assert.ok(Math.abs(tile.width / tile.height - input[tile.index].width / input[tile.index].height) < 1e-7);
      }
    }
  }
});

test('展览先发布精确首段，均衡追加坐标，尾图与作品标题完整可达', () => {
  const input = photos(161).map((photo, index) => ({ width: photo.width + index * 17, height: photo.height + index * 31 }));
  const single = { width: 4000, height: 6000 };
  const sections = [{ heading: '长组', photos: input }, { heading: '空组', photos: [] }, { heading: '末张', photos: [single] }];
  for (const width of [896, 1296]) {
    const options = { sections, layout: 'exhibition', width, viewportHeight: 880, bleed: 24 };
    const batches = photoWallLayoutBatches(options);
    const { value: first } = batches.next();
    const firstLayout = structuredClone(first);
    verifyUnits(first, 32);
    assert.equal(first.complete, false);
    assert.ok(first.height > options.viewportHeight);
    const rest = [...batches];
    assert.deepEqual(first, firstLayout);
    assert.deepEqual(rest.map((batch) => batch.complete), [false, true]);
    const wall = { units: [first, ...rest].flatMap((batch) => batch.units), height: rest.at(-1).height };
    assert.deepEqual(wall, photoWallLayout(options));
    verifyUnits(wall, 162);
    assert.deepEqual(wall.units.filter((unit) => unit.heading !== undefined).map((unit) => unit.heading), ['长组', '末张']);
    const collage = wall.units.slice(1, -2);
    const expected = [[0, 32], [32, 97], [97, 161]].flatMap(([start, end]) =>
      exhibitionLayout(input.slice(start, end), width + 48, 880).map((block) =>
        block.tiles.map((tile) => ({ ...tile, index: tile.index + start }))));
    assert.deepEqual(collage.map((unit) => unit.tiles), expected);
    for (let index = 1; index < collage.length; index++) {
      const previous = collage[index - 1];
      assert.ok(Math.abs(collage[index].top - (previous.top + previous.height) - 4) < 1e-7);
    }
    const last = wall.units.at(-1);
    assert.deepEqual(last.tiles[0], { index: 161, x: 0, y: 0, width: 240, height: 360 });
    assert.equal(last.left, 0);
    const range = visibleWallRange(wall.units, wall.height - 880, 880, 0);
    assert.equal(wall.units.slice(...range).at(-1), last);
  }
});

test('多小组按真实组边界发布进度，组间距不因消息分批而变化', () => {
  const sections = Array.from({ length: 180 }, (_, index) => ({ heading: String(index), photos: photos(1) }));
  const options = { sections, layout: 'exhibition', width: 896, viewportHeight: 880, bleed: 24 };
  const batches = [...photoWallLayoutBatches(options)];
  assert.deepEqual(batches.map(({ units, complete }) => [units.length / 2, complete]), [[32, false], [96, false], [52, true]]);
  const wall = photoWallLayout(options);
  verifyUnits(wall, 180);
  assert.equal(wall.units[64].top, batches[0].height + 48);
  assert.equal(wall.units[256].top, batches[1].height + 48);
});

test('展览 Worker 会在后续几何失败前发送可用首段，并保留明确错误', async () => {
  const source = readFileSync(new URL('../src/features/photo-wall.worker.ts', import.meta.url), 'utf8').replace("'./photo-wall-layout'", JSON.stringify(wallUrl));
  const responses = [];
  const badTail = Array.from({ length: 130 }, () => ({ width: Number.MAX_VALUE, height: Number.MIN_VALUE }));
  const previousSelf = globalThis.self;
  globalThis.self = { postMessage: (message) => responses.push(structuredClone(message)) };
  try {
    await import(moduleUrl(source));
    globalThis.self.onmessage({ data: { sections: [{ photos: [...photos(32), ...badTail] }], layout: 'exhibition', width: 896, viewportHeight: 880, bleed: 24 } });
  } finally {
    if (previousSelf === undefined) delete globalThis.self;
    else globalThis.self = previousSelf;
  }
  assert.equal(responses.length, 2);
  assert.equal(responses[0].complete, false);
  verifyUnits(responses[0], 32);
  assert.match(responses[1].error, /无法按照片比例生成展览布局/);
});

test('单图与每个作品分组保留原有观看尺寸，全部分组共用连续坐标', () => {
  const sections = [{ heading: '竖图', photos: [{ width: 4000, height: 6000 }] }, { heading: '空组', photos: [] }, { heading: '其他', photos: photos(7) }];
  const wall = photoWallLayout({ sections, layout: 'exhibition', width: 896, viewportHeight: 880, bleed: 24 });
  verifyUnits(wall, 8);
  assert.deepEqual(wall.units.filter((unit) => unit.heading !== undefined).map((unit) => unit.heading), ['竖图', '其他']);
  assert.equal(wall.units[1].left, 0);
  assert.deepEqual(wall.units[1].tiles[0], { index: 0, x: 0, y: 0, width: 240, height: 360 });
  assert.equal(wall.units[3].left, -24);
});

test('仅两张照片的相簿在同一组内按浏览尺寸并排，窄窗等比收缩', () => {
  const input = [{ width: 1000, height: 3000 }, { width: 3800, height: 3600 }];
  const options = { sections: [{ heading: '地点', photos: input }], layout: 'exhibition', viewportHeight: 880, bleed: 24, compactAlbumPair: true };
  const wide = photoWallLayout({ ...options, width: 896 });
  const [heading, pair] = wide.units;
  assert.equal(heading.heading, '地点');
  assert.deepEqual(pair.tiles.map(({ width }) => width), [120, 380]);
  assert.deepEqual(photoWallLayout({ ...options, width: 1296 }), wide);
  for (const width of [280, 896, 1296]) for (const viewportHeight of [540, 880]) {
    const wall = photoWallLayout({ ...options, width, viewportHeight });
    verifyUnits(wall, 2);
    const unit = wall.units[1];
    const [first, second] = unit.tiles;
    assert.equal(unit.left, 0);
    assert.equal(first.x, 0);
    assert.equal(first.y, 0);
    assert.equal(second.y, 0);
    assert.equal(second.x - first.width, 4);
    assert.ok(second.x + second.width <= width + 1e-7);
    assert.equal(unit.height, Math.max(first.height, second.height));
    for (const [index, tile] of unit.tiles.entries()) {
      assert.ok(tile.width <= 480 && tile.height <= Math.min(360, viewportHeight / 2) + 1e-7);
      assert.ok(Math.abs(tile.width / tile.height - input[index].width / input[index].height) < 1e-7);
    }
    assert.ok(Math.abs(first.width / second.width - 120 / 380) < 1e-7);
  }
  const panoramic = photoWallLayout({ ...options, width: 896, sections: [{ photos: [{ width: 10000, height: 100 }, input[1]] }] });
  assert.deepEqual(panoramic.units[0].tiles.map(({ width }) => width), [480, 380]);
});

test('双图限制保留不同分组、三张以上相簿、总览和默认双图展览的原布局', () => {
  const options = { layout: 'exhibition', width: 896, viewportHeight: 880, bleed: 24 };
  const pair = [{ photos: photos(2) }];
  const defaultPair = photoWallLayout({ ...options, sections: pair });
  assert.equal(defaultPair.units[0].left, -24);
  assert.deepEqual(defaultPair.units.map((unit) => unit.tiles), exhibitionLayout(pair[0].photos, 944, 880).map((block) => block.tiles));
  const splitPair = [{ heading: '甲', photos: photos(1) }, { heading: '乙', photos: photos(1) }];
  for (const [layout, sections] of [['exhibition', splitPair], ['exhibition', [{ heading: '甲', photos: photos(2) }, splitPair[1]]], ['grid', pair]]) {
    const input = { ...options, layout, sections };
    assert.deepEqual(photoWallLayout({ ...input, compactAlbumPair: true }), photoWallLayout(input));
  }
});

test('二分虚拟窗口与逐项相交一致，正反向、首尾和越界不漏项', () => {
  const wall = photoWallLayout({ sections: [{ photos: photos(1000) }], layout: 'grid', width: 896, viewportHeight: 880, bleed: 24 });
  for (const height of [360, 700, 1000]) for (const overscan of [0, 900, 1500]) {
    for (let top = -1000; top < wall.height + 2000; top += 317) {
      const expected = wall.units.filter((unit) => unit.top + unit.height >= top - overscan && unit.top <= top + height + overscan);
      const [start, end] = visibleWallRange(wall.units, top, height, overscan);
      assert.deepEqual(wall.units.slice(start, end), expected);
    }
  }
  assert.deepEqual(visibleWallRange([], 0, 800, 900), [0, 0]);
});

test('上千作品分组或一万张总览只需挂载视口附近单位，总高度不随滚动变化', () => {
  for (const sections of [Array.from({ length: 2000 }, (_, index) => ({ heading: `作品 ${index}`, photos: photos(1) })), [{ photos: photos(10000) }]]) {
    const wall = photoWallLayout({ sections, layout: 'grid', width: 896, viewportHeight: 880, bleed: 24 });
    verifyUnits(wall, sections.reduce((count, section) => count + section.photos.length, 0));
    const initialHeight = wall.height;
    for (const top of [0, wall.height / 2, wall.height - 700, wall.height / 4]) {
      const [start, end] = visibleWallRange(wall.units, top, 700, 1050);
      const mountedPhotos = wall.units.slice(start, end).reduce((count, unit) => count + unit.tiles.length, 0);
      assert.ok(mountedPhotos > 0 && mountedPhotos < 100, `mounted ${mountedPhotos}`);
      assert.equal(wall.height, initialHeight);
    }
  }
});

test('作品分组跨越旧分页边界仍只出现一次，墙面与预览使用相同全量顺序', () => {
  const input = Array.from({ length: 125 }, (_, index) => ({ id: `photo-${index}`, importedAt: `2026-11-${String(28 - (index % 20)).padStart(2, '0')}T12:00:00Z`, capturedAt: '', location: index % 3 ? '上海' : '杭州', project: index % 2 ? '项目甲' : '项目乙' }));
  for (const view of ['location', 'project']) {
    const sections = workPhotoSections(input, view);
    const ordered = sections.flatMap(([, items]) => items);
    assert.equal(ordered.length, 125);
    assert.equal(new Set(ordered.map((photo) => photo.id)).size, 125);
    assert.equal(new Set(sections.map(([heading]) => heading)).size, sections.length);
    for (const [, items] of sections) assert.deepEqual(items, [...items].sort((a, b) => b.importedAt.localeCompare(a.importedAt)));
  }
});

test('仅保存拍摄日期的照片仍按本地日历跨月连续排序', () => {
  const previous = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const input = [
      { id: 'august', capturedAt: '2025-08-01', importedAt: '2026-11-06T04:00:00Z' },
      { id: 'july', capturedAt: '2025-07-31T23:30:00', importedAt: '2026-11-06T04:00:00Z' },
    ];
    assert.deepEqual(sortAlbumPhotos(input, 'time-asc').map(({ id }) => id), ['july', 'august']);
    assert.deepEqual(sortAlbumPhotos(input, 'time-desc').map(({ id }) => id), ['august', 'july']);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('候选缓存回收不改变既有展览几何、分块与评分结果', async () => {
  const previous = geometrySource.replace(/    \/\/ The next start can only reach five photos ahead\.[\s\S]*?spans\.delete\(`\$\{start \+ MAX_BLOCK_PHOTOS - 1\}:\$\{count\}`\);\n/, '');
  assert.notEqual(previous, geometrySource);
  const { exhibitionLayout: originalLayout } = await import(moduleUrl(previous));
  for (const count of [1, 2, 7, 11, 36, 65]) for (const width of [280, 896, 1296]) {
    const input = photos(count).map((photo, index) => ({ width: photo.width + index * 17, height: photo.height + index * 31 }));
    assert.deepEqual(exhibitionLayout(input, width, 880), originalLayout(input, width, 880));
  }
});
