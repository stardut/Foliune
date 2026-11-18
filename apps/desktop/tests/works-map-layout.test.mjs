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
  maxWorksMapScale, minWorksMapScale, panWorksMapView, parseWorksMapCoordinate, previewWorksMapCard, projectWorksMapCoordinate, selectWorksMapRegions,
  unprojectWorksMapPoint, worksMapDrawingBounds, worksMapGlobeBounds, worksMapVisibleCircle, zoomWorksMapView,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const photo = (id, lat, lon, width = 6000, height = 4000) =>
  ({ id, location: `${lat}, ${lon}`, width, height });
const region = (id, name = id, country = '中国') => ({ id, name, country });
const gpsRegions = resolve => ({ resolve, regionById: () => undefined, regionAnchor: () => undefined });
const individualRegions = photos => locateMapPhotos(photos).map(item =>
  ({ ...region(item.photo.id), representative: item, photos: [item] }));
const anchors = groups => groups.map(({ representative }) => representative.coordinate);
const chinaSites = [
  ['zhejiang', 29.8, 120.5],
  ['sichuan', 30.5, 102.8],
  ['hangzhou', 30.2741, 120.1551, 'zhejiang'],
  ['ningbo', 29.8683, 121.544, 'zhejiang'],
  ['chengdu', 30.5723, 104.0665, 'sichuan'],
  ['aba', 31.8998, 102.2247, 'sichuan'],
  ['fujian', 26.07, 119.3],
  ['anhui', 31.82, 117.23],
  ['yunnan', 25.04, 102.72],
  ['hunan', 28.23, 112.94],
];
const chinaRegions = chinaSites.map(([id, lat, lon, parentId]) => ({ ...region(id), lat, lon, parentId }));
const chinaCatalog = {
  resolve: ({ lat, lon }) => chinaRegions.find(site => site.lat === lat && site.lon === lon),
  regionById: id => chinaRegions.find(site => site.id === id),
  regionAnchor: id => {
    const { lat, lon } = chinaRegions.find(site => site.id === id);
    return { lat: lat + .1, lon };
  },
};
const cityPhotos = chinaSites.filter(([, , , parentId]) => parentId)
  .map(([id, lat, lon], index) => photo(id, lat, lon, ...(index % 2 ? [4000, 6000] : [6000, 4000])));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} ≠ ${expected}`);
const right = rect => rect.x + rect.width;
const bottom = rect => rect.y + rect.height;
const distanceToRect = (point, rect) => Math.hypot(
  Math.max(0, rect.x - point.x, point.x - right(rect)),
  Math.max(0, rect.y - point.y, point.y - bottom(rect)),
);
const overlap = (a, b) => Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));
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
  assert.equal(max.scale, min.scale * 8);
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
      const { markers, cards } = layoutWorksMap(regions, frame, view);
      assert.deepEqual(markers.map(({ group }) => group.id), ['edge', 'nearby']);
      assert.ok(cards.length > 0);
      for (const point of [...markers.map(({ point }) => point), ...cards.map(({ line }) => line.from)]) {
        assert.ok(Math.hypot(point.x - center.x, point.y - center.y) <= radius);
      }
      assert.ok(cards.every(({ regionId }) => regionId !== 'hidden'));
      for (const { rect } of cards) assert.ok(distanceToRect(center, rect) - radius >= (frame.narrow ? 13 : 22) - 1e-7);
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
    let previous = start;
    for (const progress of [.1, .25, .5, .75, .9]) {
      const view = zoomWorksMapView(from, frame.map, 1 + (to.scale / from.scale - 1) * progress);
      const circle = worksMapVisibleCircle(view, frame.map);
      const result = interpolateWorksMapLayout(start, target, regions, frame, view, progress);
      assert.equal(result.cards.length, 3);
      result.cards.forEach(({ rect, regionId, line, photo }) => {
        const last = previous.cards.find(card => card.regionId === regionId).rect;
        assert.ok(Math.hypot(rect.x - last.x, rect.y - last.y) < 25);
        close(rect.width / rect.height, photo.width / photo.height);
        assert.deepEqual(line.from, result.markers.find(({ group }) => group.id === regionId).point);
        const gap = distanceToRect(circle.center, rect) - circle.radius;
        assert.ok(gap >= (frame.narrow ? 13 : 22) - 1e-7);
      });
      previous = result;
    }
  }
});

test('缩放中的一张封面换边时，共同的同侧封面仍独立插值', () => {
  const frame = createWorksMapFrame(1248, 582);
  const groups = individualRegions([photo('west', 20, 10), photo('east', 20, 30)]);
  const view = fitWorksMapView(anchors(groups), frame.map);
  const start = layoutWorksMap(groups, frame, view);
  const west = start.cards.find(card => card.side === 'left');
  const east = start.cards.find(card => card.side === 'right');
  const target = { ...start, cards: [
    { ...west, rect: { ...west.rect, x: west.rect.x - 16 }, captionRect: { ...west.captionRect, x: west.captionRect.x - 16 } },
    { ...east, side: 'left' },
  ] };
  const midway = interpolateWorksMapLayout(start, target, groups, frame, view, .5);
  close(midway.cards.find(card => card.regionId === west.regionId).rect.x, west.rect.x - 8);
  assert.deepEqual(midway.cards.find(card => card.regionId === east.regionId), east);
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
  const wide = layoutWorksMap(groups, frame, overview);
  assert.equal(wide.markers.length, 2);
  assert.equal(wide.cards.length, 2);
  const [beijing, tianjin] = wide.markers;
  assert.ok(Math.hypot(beijing.point.x - tianjin.point.x, beijing.point.y - tianjin.point.y) < 11);
  const card = wide.cards.find(({ regionId }) => regionId === 'CN-BJ');
  assert.equal(card.photo.id, 'palace');
  assert.deepEqual(card.line.from, beijing.point);
  assert.deepEqual(tianjin.point, projectWorksMapCoordinate(groups[1].representative.coordinate, overview, frame.map));
  assert.deepEqual(wide.cards.find(({ regionId }) => regionId === 'CN-TJ').line.from, tianjin.point);
  const closer = zoomWorksMapView(overview, frame.map, 16);
  const zoomed = layoutWorksMap(groups, frame, closer);
  assert.deepEqual(zoomed.markers.map(({ group }) => group), groups);
  for (const { group, point } of zoomed.markers) {
    assert.deepEqual(point, projectWorksMapCoordinate(group.representative.coordinate, closer, frame.map));
  }
});

test('省份少时可同时展开两省，照片和展签各出现一次，点位用真实 GPS', () => {
  const frame = createWorksMapFrame(1248, 582);
  const overview = groupWorksMapPhotos(locateMapPhotos([...cityPhotos, cityPhotos[0]]), chinaCatalog);
  assert.deepEqual(overview.map(({ id }) => id), ['sichuan', 'zhejiang']);
  const view = fitWorksMapView(anchors(overview), frame.map);
  const { groups } = selectWorksMapRegions(overview, frame, view);
  const { markers, cards } = layoutWorksMap(groups, frame, view);
  assert.deepEqual(groups.map(({ id }) => id), ['aba', 'chengdu', 'hangzhou', 'ningbo']);
  assert.deepEqual(new Set(cards.map(({ regionId }) => regionId)), new Set(groups.map(({ id }) => id)));
  assert.deepEqual(groups.flatMap(({ photos }) => photos.map(({ photo }) => photo.id)).sort(), groups.map(({ id }) => id));
  for (const { group, point } of markers) {
    assert.deepEqual(point, projectWorksMapCoordinate(parseWorksMapCoordinate(group.representative.photo.location), view, frame.map));
  }
});

test('杭州、温州、成都和凉山的混合画幅在宽窗同时展开，四条引线各自直连', () => {
  const samples = [
    ['hangzhou', 'zhejiang', 30.2741, 120.1551, 720, 5],
    ['wenzhou', 'zhejiang', 27.9943, 120.6994, 1280, 4],
    ['chengdu', 'sichuan', 30.5728, 104.0668, 720, 4],
    ['liangshan', 'sichuan', 27.8945, 102.2630, 720, 4],
  ];
  const cities = individualRegions(samples.map(([id, , lat, lon, height]) => photo(id, lat, lon, 960, height)))
    .map((group, index) => ({ ...group, parentId: samples[index][1], photos: Array(samples[index][5]).fill(group.photos[0]) }));
  const overview = ['sichuan', 'zhejiang'].map(id => {
    const whenExpanded = cities.filter(({ parentId }) => parentId === id);
    return { ...region(id), representative: whenExpanded[0].representative, photos: whenExpanded.flatMap(({ photos }) => photos), whenExpanded };
  });

  for (const width of [1212, 1248, 1280]) {
    const frame = createWorksMapFrame(width, 582);
    const view = fitWorksMapView(anchors(overview), frame.map);
    const { groups } = selectWorksMapRegions(overview, frame, view);
    const { cards, markers } = layoutWorksMap(groups, frame, view);
    const expected = new Set(cities.map(({ id }) => id));
    assert.deepEqual(new Set(groups.map(({ id }) => id)), expected);
    assert.deepEqual(new Set(cards.map(({ regionId }) => regionId)), expected);
    for (const [index, { regionId, line, photo, rect }] of cards.entries()) {
      assert.deepEqual(line.from, markers.find(({ group }) => group.id === regionId).point);
      close(rect.width / rect.height, photo.width / photo.height);
      for (const other of cards.slice(index + 1)) assert.equal(intersection(line, other.line), false);
    }
  }
});

test('省市展开与窗口封面空间独立，单个 GPS 城市在近处展开', () => {
  const extraProvinces = chinaSites.slice(-4).map(([id, lat, lon]) => photo(id, lat, lon));
  const overview = groupWorksMapPhotos(locateMapPhotos([...cityPhotos, ...extraProvinces]), chinaCatalog);
  const expected = ['aba', 'anhui', 'chengdu', 'fujian', 'hangzhou', 'hunan', 'ningbo', 'yunnan'];
  for (const frame of [createWorksMapFrame(1248, 582), createWorksMapFrame(848, 350), createWorksMapFrame(580, 100)]) {
    const view = fitWorksMapView(anchors(overview), frame.map);
    const { groups, menuOnly } = selectWorksMapRegions(overview, frame, view);
    assert.deepEqual(groups.map(group => group.id), expected);
    assert.deepEqual(menuOnly, []);
    const { cards } = layoutWorksMap(groups, frame, view);
    if (frame.map.height < 100) assert.equal(cards.length, 0);
  }

  const wide = createWorksMapFrame(1248, 582);
  const singleCity = groupWorksMapPhotos(locateMapPhotos(cityPhotos.slice(0, 1)), chinaCatalog);
  const view = fitWorksMapView(anchors(singleCity), wide.map);
  assert.deepEqual(selectWorksMapRegions(singleCity, wide, view).groups.map(group => group.id), ['zhejiang']);
  assert.deepEqual(selectWorksMapRegions(singleCity, wide, zoomWorksMapView(view, wide.map, 8)).groups.map(group => group.id), ['hangzhou']);
});

test('自动收起或展开仅移动 GPS 自动照片，手选城市和手选省的坐标依行政层级判断', () => {
  const [hangzhou, ningbo, chengdu] = cityPhotos;
  const manualProvince = { ...hangzhou, id: 'manual-province', locationRegionId: 'zhejiang' };
  const manualCity = { ...chengdu, id: 'manual-city', locationRegionId: 'ningbo' };
  const overview = groupWorksMapPhotos(locateMapPhotos([hangzhou, manualCity, ningbo, manualProvince]), chinaCatalog);
  const [city, province] = overview;
  assert.equal(city.id, 'ningbo');
  assert.deepEqual(city.photos.map(({ photo }) => photo.id), ['manual-city']);
  assert.deepEqual(city.photos[0].coordinate, parseWorksMapCoordinate(chengdu.location));
  assert.deepEqual(city.representative.coordinate, chinaCatalog.regionAnchor('ningbo'));
  assert.deepEqual(province.photos.map(({ photo }) => photo.id), ['hangzhou', 'ningbo', 'manual-province']);

  const frame = createWorksMapFrame(1248, 582);
  const view = fitWorksMapView(anchors(overview), frame.map);
  const { groups, menuOnly } = selectWorksMapRegions(overview, frame, view);
  assert.deepEqual(groups.map(({ id }) => id), ['hangzhou', 'ningbo']);
  assert.deepEqual(groups[1].photos.map(({ photo }) => photo.id), ['manual-city', 'ningbo']);
  assert.deepEqual(groups[1].representative.coordinate, chinaCatalog.regionAnchor('ningbo'));
  assert.deepEqual(menuOnly.map(({ id }) => id), ['zhejiang']);
  assert.deepEqual(menuOnly[0].photos.map(({ photo }) => photo.id), ['manual-province']);
  assert.deepEqual(menuOnly[0].representative.coordinate, parseWorksMapCoordinate(hangzhou.location));
  assert.deepEqual([...groups, ...menuOnly].flatMap(({ photos }) => photos.map(({ photo }) => photo.id)).sort(),
    ['hangzhou', 'manual-city', 'manual-province', 'ningbo']);

  const manualOnly = groupWorksMapPhotos(locateMapPhotos([manualCity, manualProvince]), chinaCatalog);
  const manualView = fitWorksMapView(anchors(manualOnly), frame.map);
  const manual = selectWorksMapRegions(manualOnly, frame, manualView);
  assert.deepEqual(manual.groups.map(({ id }) => id), ['ningbo']);
  assert.deepEqual(manual.menuOnly.map(({ photos }) => photos.map(({ photo }) => photo.id)), [['manual-province']]);
  const layout = layoutWorksMap(manual.groups, frame, manualView);
  assert.deepEqual(layout.markers.map(({ group }) => group.id), ['ningbo']);
  assert.deepEqual(layout.cards.map(({ regionId }) => regionId), ['ningbo']);

  const provinceGps = photo('province-gps', 29.8, 120.5);
  const withProvinceGps = groupWorksMapPhotos(locateMapPhotos([manualCity, manualProvince, provinceGps]), chinaCatalog);
  const provinceView = fitWorksMapView(anchors(withProvinceGps), frame.map);
  assert.deepEqual(selectWorksMapRegions(withProvinceGps, frame, provinceView).menuOnly[0].photos.map(({ photo }) => photo.id),
    ['manual-province', 'province-gps']);
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

test('宽窗可放超过六张错落展签，窄窗留底，重叠后每张照片仍有露边', () => {
  const regions = individualRegions(locations.map(([id, lat, lon], index) => photo(id, lat, lon, ...ratios[index % ratios.length])));
  for (const [width, height] of [[1248, 582], [1218, 620], [940, 640], [848, 350], [570, 470]]) {
    const frame = createWorksMapFrame(width, height);
    const view = { center: { lat: 0, lon: 3 }, scale: minWorksMapScale(frame.map) };
    const circle = worksMapVisibleCircle(view, frame.map);
    const { cards, markers } = layoutWorksMap(regions, frame, view);
    assert.ok(cards.length >= (frame.narrow ? 3 : 7), `${width} × ${height}, ${cards.length} 张`);
    assert.equal(new Set(cards.map(card => card.regionId)).size, cards.length);
    assert.equal(new Set(cards.map(card => card.photo.id)).size, cards.length);
    if (!frame.narrow) {
      assert.deepEqual(new Set(cards.map(card => card.side)), new Set(['left', 'right']));
      const offsets = cards.filter(card => card.side === 'right').map(({ captionRect }) => Math.round(captionRect.x));
      assert.ok(new Set(offsets).size >= 2);
    }
    let covered = 0;
    for (const [index, card] of cards.entries()) {
      const { rect, captionRect, side, line } = card;
      assert.ok(captionRect.x >= 0 && rect.y >= 0 && right(captionRect) <= width && bottom(captionRect) <= height);
      close(rect.width / rect.height, card.photo.width / card.photo.height);
      close(captionRect.y, bottom(rect));
      assert.deepEqual(line.from, markers.find(({ group }) => group.id === card.regionId).point);
      assert.ok(inside(line.to, rect));
      assert.ok(distanceToRect(circle.center, rect) - circle.radius >= (frame.narrow ? 13 : 22) - 1e-7);
      if (frame.narrow) {
        assert.equal(side, 'bottom');
        assert.equal(line.to.y, rect.y);
        if (index > 0) assert.ok(cards[index - 1].rect.x < rect.x);
      }
      const obscured = cards.filter(other => other !== card).reduce((sum, other) =>
        sum + overlap(rect, { ...other.captionRect, y: other.rect.y, height: other.rect.height + other.captionRect.height }), 0);
      assert.ok(obscured <= rect.width * rect.height * .36 + 1e-7);
      covered += obscured;
    }
    if (width === 1248) assert.ok(covered > 0, '允许适度叠放');
  }
});

test('展签引线为下方的其他点位让出可辨认的间距', () => {
  const frame = createWorksMapFrame(848, 315);
  const view = { center: { lat: 0, lon: 0 }, scale: minWorksMapScale(frame.map) };
  const regions = individualRegions([photo('upper', 40, 0), photo('lower', -21, 3)]);
  const { cards, markers } = layoutWorksMap(regions, frame, view);
  assert.equal(markers.length, 2);
  const upper = cards.find(card => card.photo.id === 'upper');
  const lowerPoint = markers.find(({ group }) => group.id === 'lower').point;
  assert.ok(Math.abs(upper.line.to.x - upper.line.from.x) > 10);
  assert.ok(distanceToLine(lowerPoint, upper.line) >= 11 - 1e-7);
});

test('混合画幅的密集点位在宽窄窗减少引线交叉，保留已经摆下的封面', () => {
  const samples = [
    ['北京市', 39.9042, 116.4074, 640], ['天津市', 39.0842, 117.2009, 639],
    ['成都市', 30.5728, 104.0668, 1440], ['凉山彝族自治州', 27.8945, 102.263, 720],
    ['拉萨市', 29.6456, 91.1409, 627], ['日喀则市', 29.2671, 88.8815, 207, 2],
    ['兰州市', 36.0611, 103.8343, 640], ['张掖市', 38.9259, 100.4498, 720],
    ['乌鲁木齐市', 43.8256, 87.6168, 720], ['吐鲁番市', 42.9513, 89.1895, 384],
    ['博尔塔拉蒙古自治州', 44.9034, 82.0748, 1280, 2], ['阿克苏地区', 41.1684, 80.2606, 720],
    ['伊犁哈萨克自治州', 43.9168, 81.3242, 720], ['阿勒泰地区', 47.8456, 88.1413, 720, 2],
  ];
  const groups = individualRegions(samples.map(([name, lat, lon, height]) => photo(name, lat, lon, 960, height)));
  groups.forEach((group, i) => { if (samples[i][4]) group.photos.push(group.photos[0]); });
  for (const [width, height, expectedCards, allowedCrossings] of [[1248, 582, 14, 1], [848, 350, 8, 0]]) {
    const frame = createWorksMapFrame(width, height);
    const view = { center: { lat: 37.668, lon: 103.138 }, scale: minWorksMapScale(frame.map) };
    const { markers, cards } = layoutWorksMap(groups, frame, view);
    assert.equal(markers.length, groups.length);
    assert.equal(new Set(cards.map(card => card.regionId)).size, expectedCards);
    let crossings = 0;
    for (const [i, { regionId, line }] of cards.entries()) {
      assert.deepEqual(line.from, markers.find(({ group }) => group.id === regionId).point);
      crossings += cards.slice(i + 1).filter(other => intersection(line, other.line)).length;
    }
    assert.ok(crossings <= allowedCrossings, `${width} × ${height} 有 ${crossings} 处引线交叉`);
  }
});

test('北京、河北、新疆同时展示时，邻近点的引线各从真实位置直出', () => {
  const frame = createWorksMapFrame(1248, 520);
  const regions = individualRegions([
    photo('beijing', 39.9042, 116.4074), photo('xinjiang', 43.8256, 87.6168), photo('hebei', 38.0428, 114.5149),
  ]);
  const view = fitWorksMapView(anchors(regions), frame.map);
  const { cards, markers } = layoutWorksMap(regions, frame, view);
  assert.equal(cards.length, 3);
  const beijing = markers.find(({ group }) => group.id === 'beijing').point;
  const hebei = markers.find(({ group }) => group.id === 'hebei').point;
  const spacing = Math.hypot(beijing.x - hebei.x, beijing.y - hebei.y);
  assert.ok(spacing < 11);
  const beijingLine = cards.find(({ regionId }) => regionId === 'beijing').line;
  const hebeiLine = cards.find(({ regionId }) => regionId === 'hebei').line;
  assert.deepEqual(beijingLine.from, beijing);
  assert.deepEqual(hebeiLine.from, hebei);
  assert.ok(distanceToLine(hebei, beijingLine) >= spacing / 2);
  assert.ok(distanceToLine(beijing, hebeiLine) >= spacing / 2);
  assert.equal(intersection(beijingLine, hebeiLine), false);
});

test('截图里的五个地区各有展签，四川从真实点直连且避开重庆点位', () => {
  const frame = createWorksMapFrame(1062, 594);
  const view = { center: { lat: 33, lon: 101 }, scale: minWorksMapScale(frame.map) };
  const samples = [
    ['chongqing', 572, 318, 6000, 4000, 22],
    ['gansu', 531.5, 273, 6000, 3375, 26],
    ['xinjiang', 487, 272, 3375, 6000, 162],
    ['sichuan', 556.5, 307.5, 3375, 6000, 825],
    ['tibet', 505.5, 314.5, 6000, 4000, 79],
  ];
  const groups = individualRegions(samples.map(([id, x, y, width, height]) => {
    const { lat, lon } = unprojectWorksMapPoint({ x, y }, view, frame.map);
    return photo(id, lat, lon, width, height);
  }));
  groups.forEach((group, index) => {
    group.photos = Array(samples[index][5]).fill(group.photos[0]);
  });

  const { markers, cards } = layoutWorksMap(groups, frame, view);
  assert.deepEqual(new Set(cards.map(({ regionId }) => regionId)), new Set(groups.map(({ id }) => id)));
  const sichuan = cards.find(({ regionId }) => regionId === 'sichuan').line;
  const chongqing = markers.find(({ group }) => group.id === 'chongqing').point;
  close(sichuan.from.x, 556.5);
  close(sichuan.from.y, 307.5);
  assert.ok(sichuan.to.x > sichuan.from.x);
  assert.ok(distanceToLine(chongqing, sichuan) >= 11);
  for (const [index, { regionId, line }] of cards.entries()) {
    assert.deepEqual(line.from, markers.find(({ group }) => group.id === regionId).point);
    for (const other of cards.slice(index + 1)) assert.equal(intersection(line, other.line), false);
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
  assert.ok(cards.length > 0 && cards.length < markers.length);
  const { group: hidden } = markers.find(({ group }) => !cards.some(card => card.regionId === group.id));
  const arrangement = structuredClone(cards);
  const preview = previewWorksMapCard(hidden.id, { cards, markers }, frame, view);
  assert.equal(preview.photo.id, hidden.representative.photo.id);
  assert.deepEqual(preview.line.from, markers.find(({ group }) => group.id === hidden.id).point);
  assert.deepEqual(cards, arrangement, '展示临时封面时其他封面留在原位');
  assert.equal(previewWorksMapCard(cards[0].regionId, { cards, markers }, frame, view), undefined);
  const closeView = centerWorksMapView(zoomWorksMapView(view, frame.map, 8), hidden.representative.coordinate);
  const selected = layoutWorksMap(groups, frame, closeView);
  assert.ok(selected.markers.some(({ group }) => group.id === hidden.id));
  assert.equal(selected.cards.find(card => card.regionId === hidden.id).photo.id, hidden.representative.photo.id);
});


test('最大缩放能拉开 3.2 倍时仍拥挤的点位，可见的每个点都有常驻封面', () => {
  const frame = createWorksMapFrame(1248, 582);
  const groups = individualRegions([
    photo('west', 30, 119.79), photo('center', 30.12, 120, 4000, 6000), photo('east', 30, 120.21),
  ]);
  const view = fitWorksMapView(anchors(groups), frame.map);
  const oldLimit = layoutWorksMap(groups, frame, zoomWorksMapView(view, frame.map, 3.2));
  const maximum = layoutWorksMap(groups, frame, zoomWorksMapView(view, frame.map, 8));
  const edgeGap = ({ markers: [west, , east] }) => east.point.x - west.point.x;
  assert.ok(edgeGap(oldLimit) < 8);
  assert.ok(edgeGap(maximum) > 12);
  assert.deepEqual(new Set(maximum.cards.map(card => card.regionId)), new Set(groups.map(group => group.id)));
});
