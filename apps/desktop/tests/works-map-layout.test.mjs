import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../src/features/works-map/works-map-layout.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const {
  centerWorksMapView, createWorksMapFrame, fitWorksMapView, groupWorksMapPhotos, interpolateWorksMapLayout, layoutWorksMap, locateMapPhotos,
  maxWorksMapScale, minWorksMapScale, panWorksMapView, parseWorksMapCoordinate, projectWorksMapCoordinate,
  unprojectWorksMapPoint, worksMapDrawingBounds, worksMapGlobeBounds, worksMapVisibleCircle, zoomWorksMapView,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const photo = (id, lat, lon, width = 6000, height = 4000) =>
  ({ id, location: `${lat}, ${lon}`, width, height });
const region = (id, name = id, country = '中国') => ({ id, name, country });
const gpsRegions = resolve => ({ resolve, regionById: () => undefined, regionAnchor: () => undefined });
const individualRegions = photos => locateMapPhotos(photos).map(item =>
  ({ ...region(item.photo.id), representative: item, photos: [item] }));
const anchors = groups => groups.map(({ representative }) => representative.coordinate);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);
const right = rect => rect.x + rect.width;
const bottom = rect => rect.y + rect.height;
const inside = (point, rect) =>
  point.x >= rect.x && point.x <= right(rect) && point.y >= rect.y && point.y <= bottom(rect);

function intersection(a, b) {
  const rx = a.to.x - a.from.x;
  const ry = a.to.y - a.from.y;
  const sx = b.to.x - b.from.x;
  const sy = b.to.y - b.from.y;
  const ax = b.from.x - a.from.x;
  const ay = b.from.y - a.from.y;
  const determinant = rx * sy - ry * sx;
  if (Math.abs(determinant) < 1e-9) {
    if (Math.abs(ax * ry - ay * rx) >= 1e-9) return false;
    const t1 = (ax * rx + ay * ry) / (rx * rx + ry * ry);
    const t2 = t1 + (sx * rx + sy * ry) / (rx * rx + ry * ry);
    return Math.max(t1, t2) >= 0 && Math.min(t1, t2) <= 1;
  }
  const t = (ax * sy - ay * sx) / determinant;
  const u = (ax * ry - ay * rx) / determinant;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function lineHitsRectangle(line, rect) {
  if (inside(line.from, rect) || inside(line.to, rect)) return true;
  const corners = [rect, { x: right(rect), y: rect.y }, { x: right(rect), y: bottom(rect) }, { x: rect.x, y: bottom(rect) }];
  return corners.some((from, index) => intersection(line, { from, to: corners[(index + 1) % corners.length] }));
}

function distanceToLine(point, { from, to }) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const x = point.x - from.x;
  const y = point.y - from.y;
  const along = x * ux + y * uy;
  if (along < 0) return Math.hypot(x, y);
  if (along > length) return Math.hypot(point.x - to.x, point.y - to.y);
  return Math.abs(x * uy - y * ux);
}

test('只读取有效十进制坐标并按照片 ID 去重', () => {
  for (const location of ['', '北京, 上海', '39.9° N, 116.4° E', '39.9，116.4', '91, 0', '0, -180.001', 'NaN, 34', '1e1, 10', '40, 30, 20']) {
    assert.equal(parseWorksMapCoordinate(location), undefined, location);
  }
  assert.deepEqual(parseWorksMapCoordinate('  +39.901230, -116.40  '), { lat: 39.90123, lon: -116.4 });
  assert.deepEqual(parseWorksMapCoordinate('90, 180'), { lat: 90, lon: -180 });
  assert.deepEqual(parseWorksMapCoordinate('-90, -180'), { lat: -90, lon: -180 });
  assert.deepEqual(parseWorksMapCoordinate('-0, +0'), { lat: 0, lon: 0 });

  const items = [photo('same', 39.9, 116.4), photo('same', 20, 100), photo('missing', '', ''), photo('second', 22, 113)];
  const located = locateMapPhotos(items);
  assert.deepEqual(located.map(({ photo }) => photo.id), ['same', 'second']);
  assert.equal(located[0].photo, items[0]);
});

test('球面跨日期线连续，背面照片可转到正面，盘外无法反投影', () => {
  const frame = createWorksMapFrame(1248, 560);
  const { map } = frame;
  const items = locateMapPhotos([photo('west', 10, -179.8), photo('east', 10.2, 179.8)]);
  const view = fitWorksMapView(items.map(({ coordinate }) => coordinate), map);
  assert.ok(Math.abs(view.center.lon) > 179.9);
  const disk = worksMapGlobeBounds(view, map);
  assert.equal(disk.width, disk.height);
  assert.equal(unprojectWorksMapPoint(map, view, map), undefined);
  const acrossDateLine = items.map(({ coordinate }) => projectWorksMapCoordinate(coordinate, view, map));
  assert.ok(Math.abs(acrossDateLine[0].x - acrossDateLine[1].x) < 2);

  for (const { coordinate } of items) {
    const point = projectWorksMapCoordinate(coordinate, view, map);
    assert.ok(inside(point, disk));
    const roundTrip = unprojectWorksMapPoint(point, view, map);
    close(roundTrip.lat, coordinate.lat);
    close(roundTrip.lon, coordinate.lon);
  }

  const destinations = individualRegions([
    photo('asia', 39.91, 116.4), photo('america', -21.19, -64.74), photo('north', 90, 180), photo('south', -90, -180),
  ]);
  const faces = fitWorksMapView(anchors(destinations), map);
  assert.equal(faces.scale, minWorksMapScale(map));
  assert.ok(layoutWorksMap(destinations, frame, faces).markers.length < destinations.length);
  for (const target of destinations) {
    const centered = centerWorksMapView(faces, target.representative.coordinate);
    assert.ok(layoutWorksMap(destinations, frame, centered).markers.some(({ group }) => group.id === target.id));
    const point = projectWorksMapCoordinate(target.representative.coordinate, centered, map);
    close(point.x, map.x + map.width / 2);
    close(point.y, map.y + map.height / 2);
  }
});

test('游标缩放保留锚点，拖动跨日期线连续，缩放和平移受世界范围限制', () => {
  const { map } = createWorksMapFrame(1248, 560);
  const view = { center: { lat: 20, lon: 179.9 }, scale: minWorksMapScale(map) };
  const coordinate = { lat: 30.15, lon: -160.7 };
  const point = projectWorksMapCoordinate(coordinate, view, map);
  const zoomed = zoomWorksMapView(view, map, 2, point);
  const zoomedPoint = projectWorksMapCoordinate(coordinate, zoomed, map);
  close(zoomedPoint.x, point.x);
  close(zoomedPoint.y, point.y);
  const panned = panWorksMapView(view, -32, 19);
  const originalCenter = projectWorksMapCoordinate(view.center, view, map);
  const movedCenter = projectWorksMapCoordinate(view.center, panned, map);
  assert.ok(panned.center.lon < -160);
  assert.ok(movedCenter.x < originalCenter.x - 25);
  assert.ok(movedCenter.y > originalCenter.y + 15);
  assert.ok(panned.center.lat >= -90 && panned.center.lat <= 90);

  const min = zoomWorksMapView(view, map, .00001);
  assert.equal(min.scale, minWorksMapScale(map));
  assert.equal(zoomWorksMapView(min, map, .5), min);
  const max = zoomWorksMapView(view, map, 1000);
  assert.equal(max.scale, maxWorksMapScale(map));
  assert.equal(zoomWorksMapView(max, map, 2), max);
});

test('宽窄窗口首屏沿真实球缘，放大后外圈逐级扩张并裁切点位和引线起点', () => {
  for (const frame of [createWorksMapFrame(1248, 582), createWorksMapFrame(848, 350)]) {
    const { map } = frame;
    const overview = { center: { lat: 0, lon: 0 }, scale: minWorksMapScale(map) };
    const middle = zoomWorksMapView(overview, map, 1.5);
    const closer = zoomWorksMapView(middle, map, 1.5);
    const maximum = zoomWorksMapView(overview, map, 100);
    const initialCircle = worksMapVisibleCircle(overview, map);
    assert.equal(initialCircle.radius, overview.scale);
    assert.equal(worksMapDrawingBounds(overview, map), map);
    const radii = [overview, middle, closer, maximum].map(view => worksMapVisibleCircle(view, map).radius);
    assert.ok(radii.every((radius, index) => index === 0 || radius > radii[index - 1]));
    close(radii[3] - radii[0], frame.narrow ? 16 : 30);
    assert.deepEqual(worksMapDrawingBounds(middle, map), worksMapDrawingBounds(maximum, map));

    for (const view of [middle, closer, maximum]) {
      const { center, radius } = worksMapVisibleCircle(view, map);
      assert.deepEqual(center, initialCircle.center);
      assert.ok(center.y - radius >= 4);
      const drawing = worksMapDrawingBounds(view, map);
      assert.ok(inside({ x: center.x, y: center.y + radius }, drawing));
      const corner = { x: center.x + radius * .8, y: center.y + radius * .8 };
      const globe = worksMapGlobeBounds(view, map);
      const hidden = unprojectWorksMapPoint(corner, view, globe);
      assert.ok(inside(corner, map) && hidden);
      assert.equal(unprojectWorksMapPoint(corner, view, map), undefined);
      assert.equal(projectWorksMapCoordinate(hidden, view, map), undefined);
      assert.deepEqual(zoomWorksMapView(view, map, 1 / 1.5, corner).center, view.center);

      const edge = unprojectWorksMapPoint({ x: center.x, y: center.y + radius - 1 }, view, map);
      if (view === maximum) assert.ok(center.y + radius - 1 > bottom(map));
      const regions = individualRegions([
        photo('edge', edge.lat, edge.lon), photo('nearby', edge.lat + .1, edge.lon),
        photo('hidden', hidden.lat, hidden.lon),
      ]);
      const { markers, cards } = layoutWorksMap(regions, frame, view, 'hidden');
      assert.deepEqual(markers.map(({ group }) => group.id), ['edge', 'nearby']);
      assert.ok(cards.length > 0);
      for (const point of [...markers.flatMap(({ point, button }) => [point, button]), ...cards.map(({ line }) => line.from)]) {
        assert.ok(Math.hypot(point.x - center.x, point.y - center.y) <= radius);
      }
      assert.ok(cards.every(({ regionId }) => regionId !== 'hidden'));
      for (const { rect, side } of cards) {
        const clearance = side === 'bottom' ? rect.y - (center.y + radius)
          : side === 'left' ? center.x - radius - right(rect) : rect.x - (center.x + radius);
        assert.ok(clearance >= (frame.narrow ? 13 : 22) - 1e-7);
      }
    }
  }
});

test('京津与天山的展签在宽窄窗缩放期间连续移动，保持原比例和球缘净距', () => {
  const regions = individualRegions([
    photo('beijing', 39.918022, 116.390778, 960, 720),
    photo('xinjiang', 43.893463, 88.130705, 960, 640),
    photo('tianjin', 39.135411, 117.203479, 960, 639),
  ]);
  regions.forEach((group, index) => {
    group.photos = Array.from({ length: [12, 3, 2][index] }, (_, copy) => ({
      ...group.representative, photo: { ...group.representative.photo, id: `${group.id}-${copy}` },
    }));
  });
  for (const frame of [createWorksMapFrame(1248, 582), createWorksMapFrame(853, 359)]) {
    const initial = fitWorksMapView(anchors(regions), frame.map);
    const from = zoomWorksMapView(initial, frame.map, 1.5);
    const to = zoomWorksMapView(initial, frame.map, 2.25);
    const start = layoutWorksMap(regions, frame, from);
    const target = layoutWorksMap(regions, frame, to);
    for (const progress of [.1, .25, .5, .75, .9]) {
      const view = zoomWorksMapView(from, frame.map, 1 + (to.scale / from.scale - 1) * progress);
      const circle = worksMapVisibleCircle(view, frame.map);
      const current = layoutWorksMap(regions, frame, view);
      const result = interpolateWorksMapLayout(start, target, current, circle, progress);
      assert.equal(result.cards.length, 3);
      result.cards.forEach(({ rect, side, regionId, line, photo }, index) => {
        const previous = start.cards[index].rect;
        const next = target.cards[index].rect;
        close(rect.x, previous.x + (next.x - previous.x) * progress);
        close(rect.y, previous.y + (next.y - previous.y) * progress);
        close(rect.width / rect.height, photo.width / photo.height);
        assert.deepEqual(line.from, result.markers.find(({ group }) => group.id === regionId).button);
        const gap = side === 'bottom' ? rect.y - (circle.center.y + circle.radius)
          : side === 'left' ? circle.center.x - circle.radius - right(rect) : rect.x - (circle.center.x + circle.radius);
        assert.ok(gap >= (frame.narrow ? 13 : 22) - 1e-7);
      });
    }
  }
});

test('按行政区保留一组与固定代表照，缩放不会合并相邻省市或拆分同区照片', () => {
  const frame = createWorksMapFrame(1248, 520);
  const items = locateMapPhotos([
    photo('tianjin', 39.135, 117.203),
    photo('palace', 39.918, 116.391),
    photo('temple', 39.877, 116.406),
    photo('park', 39.99, 116.27),
    photo('ocean', 12, 165),
  ]);
  const groups = groupWorksMapPhotos(items, gpsRegions(({ lat, lon }) => lat > 35
    ? lon < 116.8 ? region('CN-BJ', '北京市') : region('CN-TJ', '天津市')
    : undefined));
  assert.deepEqual(groups.map(group => group.name), ['北京市', '天津市']);
  assert.deepEqual(groups[0].photos.map(({ photo }) => photo.id), ['palace', 'temple', 'park']);
  const overview = fitWorksMapView(anchors(groups), frame.map);
  const wide = layoutWorksMap(groups, frame, overview, 'CN-TJ');
  assert.equal(wide.markers.length, 2);
  assert.equal(wide.cards.length, 2);
  const [beijing, tianjin] = wide.markers;
  assert.ok(Math.hypot(beijing.point.x - tianjin.point.x, beijing.point.y - tianjin.point.y) < 11);
  assert.ok(Math.hypot(beijing.button.x - tianjin.button.x, beijing.button.y - tianjin.button.y) >= 30 - 1e-7);
  const card = wide.cards.find(({ regionId }) => regionId === 'CN-BJ');
  assert.equal(card.photo.id, 'palace');
  assert.deepEqual(card.line.from, beijing.button);
  assert.deepEqual(tianjin.point, projectWorksMapCoordinate(groups[1].representative.coordinate, overview, frame.map));
  assert.deepEqual(wide.cards.find(({ regionId }) => regionId === 'CN-TJ').line.from, tianjin.button);
  const closer = zoomWorksMapView(overview, frame.map, 16);
  const zoomed = layoutWorksMap(groups, frame, closer);
  assert.deepEqual(zoomed.markers.map(({ group }) => group), groups);
  assert.ok(Math.hypot(zoomed.markers[0].button.x - zoomed.markers[1].button.x,
    zoomed.markers[0].button.y - zoomed.markers[1].button.y) >= 30 - 1e-7);
});

test('京津与天山的宽窄总览保留海岸取景空间，同时三地都有独立展签', () => {
  const regions = individualRegions([
    photo('beijing', 39.918, 116.391), photo('tianjin', 39.135, 117.203), photo('xinjiang', 43.893, 88.131),
  ]);
  for (const frame of [createWorksMapFrame(1248, 582), createWorksMapFrame(848, 350)]) {
    const view = fitWorksMapView(anchors(regions), frame.map);
    assert.ok(view.center.lon > 95 && view.center.lon < 115 && view.center.lat > 35);
    const disk = worksMapGlobeBounds(view, frame.map);
    assert.ok(inside(disk, frame.map) && inside({ x: right(disk), y: bottom(disk) }, frame.map));
    if (!frame.narrow) assert.ok(disk.width >= 500 && disk.width <= 540);
    assert.ok(inside(projectWorksMapCoordinate({ lat: 35, lon: 128 }, view, frame.map), frame.map));
    assert.ok(inside(projectWorksMapCoordinate({ lat: 25, lon: 120 }, view, frame.map), frame.map));
    const layout = layoutWorksMap(regions, frame, view);
    assert.equal(layout.markers.length, 3);
    assert.equal(layout.cards.length, 3);
    if (!frame.narrow) assert.ok(layout.cards.every(({ rect }) => Math.max(rect.width, rect.height) >= 150));
  }
});

const locations = [
  ['west', 0, -120], ['east', 0, 120], ['north', 38, -5], ['south', -38, 5], ['interior', 10, 25],
  ['one', -20, 50], ['two', 22, 30], ['three', -15, -15], ['four', 21, -58], ['five', 8, 13],
  ['six', 14, 105], ['seven', -8, 78], ['eight', -28, -95], ['nine', 35, -98],
  ['ten', 27, 102], ['eleven', -26, -117], ['twelve', -20, -45], ['thirteen', 8, -90],
];
const ratios = [[6000, 4000], [4000, 6000], [4000, 4000], [10000, 1000], [1000, 10000]];

test('宽窗在球体两翼放原比例照片，窄窗沿底边排列，展签、引线互不碰撞', () => {
  const regions = individualRegions(locations.map(([id, lat, lon], index) => photo(id, lat, lon, ...ratios[index % ratios.length])));
  for (const [width, height] of [[1248, 582], [1218, 620], [940, 640], [848, 350], [570, 470]]) {
    const frame = createWorksMapFrame(width, height);
    const view = { center: { lat: 0, lon: 3 }, scale: minWorksMapScale(frame.map) };
    const globe = worksMapGlobeBounds(view, frame.map);
    const { cards, markers } = layoutWorksMap(regions, frame, view);
    assert.ok(cards.length >= 3 && cards.length <= (frame.narrow ? 4 : 6));
    assert.ok(markers.length > cards.length);
    assert.equal(new Set(cards.map(card => card.regionId)).size, cards.length);
    assert.equal(new Set(cards.map(card => card.photo.id)).size, cards.length);
    if (!frame.narrow) assert.deepEqual(new Set(cards.map(card => card.side)), new Set(['left', 'right']));

    for (const [index, card] of cards.entries()) {
      const { rect, captionRect, side, line } = card;
      const bounds = { x: captionRect.x, y: rect.y, width: captionRect.width, height: rect.height + captionRect.height };
      assert.ok(rect.x >= 0 && rect.y >= 0 && right(rect) <= width && bottom(captionRect) <= height);
      close(rect.width / rect.height, card.photo.width / card.photo.height);
      close(captionRect.y, bottom(rect));
      assert.ok(captionRect.x <= rect.x && right(captionRect) >= right(rect) - 1e-7);
      assert.deepEqual(line.from, markers.find(({ group }) => group.id === card.regionId).button);
      assert.ok(inside(line.from, frame.map));
      for (const marker of markers) {
        if (marker.group.id !== card.regionId) assert.ok(distanceToLine(marker.button, line) >= 11 - 1e-7);
      }
      if (frame.narrow) {
        assert.equal(side, 'bottom');
        assert.ok(bounds.y - bottom(globe) >= 20);
        assert.equal(line.to.y, rect.y);
        if (index > 0) assert.ok(cards[index - 1].rect.x < rect.x);
      } else {
        const gap = side === 'left' ? globe.x - right(bounds) : bounds.x - right(globe);
        assert.ok(gap >= 20);
      }
      for (const other of cards.slice(index + 1)) {
        const otherBounds = { x: other.captionRect.x, y: other.rect.y, width: other.captionRect.width, height: other.rect.height + other.captionRect.height };
        assert.ok(right(bounds) < otherBounds.x || right(otherBounds) < bounds.x ||
          bottom(bounds) < otherBounds.y || bottom(otherBounds) < bounds.y);
        assert.equal(intersection(line, other.line), false);
        assert.equal(lineHitsRectangle(line, otherBounds), false);
        assert.equal(lineHitsRectangle(other.line, bounds), false);
      }
    }
  }
});

test('展签引线为下方的其他点位让出可辨认的间距', () => {
  const frame = createWorksMapFrame(848, 315);
  const view = { center: { lat: 0, lon: 0 }, scale: minWorksMapScale(frame.map) };
  const regions = individualRegions([photo('upper', 40, 0), photo('lower', -21, 3)]);
  const { cards, markers } = layoutWorksMap(regions, frame, view, 'upper');
  assert.equal(markers.length, 2);
  const upper = cards.find(card => card.photo.id === 'upper');
  const lowerPoint = markers.find(({ group }) => group.id === 'lower').button;
  assert.ok(Math.abs(upper.line.to.x - upper.line.from.x) > 10);
  assert.ok(distanceToLine(lowerPoint, upper.line) >= 11 - 1e-7);
});

test('北京、河北、新疆同时展示时，展签引线避开其他地区的点位短线', () => {
  const frame = createWorksMapFrame(1248, 520);
  const regions = individualRegions([
    photo('beijing', 39.9042, 116.4074), photo('xinjiang', 43.8256, 87.6168), photo('hebei', 38.0428, 114.5149),
  ]);
  const view = fitWorksMapView(anchors(regions), frame.map);
  const { cards, markers } = layoutWorksMap(regions, frame, view);
  assert.equal(cards.length, 3);
  const stems = markers.filter(({ point, button }) => point !== button);
  assert.ok(stems.some(({ group }) => group.id === 'hebei'));
  for (const card of cards) {
    for (const { group, point, button } of stems) {
      if (group.id !== card.regionId) assert.equal(intersection(card.line, { from: point, to: button }), false);
    }
  }
});

test('数千张作品按地区逐张可达，未获展签的地区可点选获得固定代表照', () => {
  const frame = createWorksMapFrame(848, 315);
  const items = locateMapPhotos(
    Array.from({ length: 4096 }, (_, index) => {
      const site = index % 16;
      return photo(`site-${site}-${index}`, 30 + Math.floor(site / 4) * 8, 90 + (site % 4) * 8);
    }),
  );
  const groups = groupWorksMapPhotos(items, gpsRegions(({ lat, lon }) => region(`${lat}-${lon}`)));
  const view = fitWorksMapView(anchors(groups), frame.map);
  const { markers, cards } = layoutWorksMap(groups, frame, view);
  assert.equal(markers.length, 16);
  assert.equal(groups.reduce((total, group) => total + group.photos.length, 0), items.length);
  assert.ok(cards.length > 0 && cards.length <= 4);
  const { group: hidden } = markers.find(({ group }) => !cards.some(card => card.regionId === group.id));
  const closeView = centerWorksMapView(zoomWorksMapView(view, frame.map, 3.2), hidden.representative.coordinate);
  const selected = layoutWorksMap(groups, frame, closeView, hidden.id);
  assert.ok(selected.markers.some(({ group }) => group.id === hidden.id));
  assert.equal(selected.cards.find(card => card.regionId === hidden.id).photo.id, hidden.representative.photo.id);
});
