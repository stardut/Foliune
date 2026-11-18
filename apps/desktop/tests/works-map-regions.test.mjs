import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const feature = new URL('../src/features/works-map/', import.meta.url);
async function moduleFromSource(filename) {
  const source = readFileSync(new URL(filename, feature), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const { createWorksMapRegionData } = await moduleFromSource('works-map-regions.ts');
const { groupWorksMapPhotos, locateMapPhotos } = await moduleFromSource('works-map-layout.ts');
const data = JSON.parse(readFileSync(new URL('natural-earth-regions.json', feature), 'utf8'));
const regions = createWorksMapRegionData(data);
const { resolve } = regions;
const at = (lat, lon) => resolve({ lat, lon });

test('北京城区的照片同属北京市，天津、河北、新疆仍是各自的行政区', () => {
  const palace = at(39.916345, 116.397155);
  const temple = at(39.882043, 116.406619);
  assert.equal(palace.name, '北京市');
  assert.equal(temple.id, palace.id);
  assert.equal(at(39.084158, 117.200983).name, '天津市');
  assert.equal(at(39.508622, 116.703602).name, '河北省');
  assert.equal(at(43.8256, 87.6168).name, '新疆维吾尔自治区');
  assert.equal(at(22.543096, 114.057865).name, '广东省');
});

test('English region names preserve administrative IDs and outlines', () => {
  const english = createWorksMapRegionData(data, 'en');
  for (const [lat, lon, name, country] of [
    [39.916345, 116.397155, 'Beijing', 'China'],
    [41.3874, 2.1686, 'Catalonia', 'Spain'],
    [22.2759, 114.1455, 'Hong Kong SAR', 'China'],
  ]) {
    const region = at(lat, lon);
    assert.deepEqual(english.resolve({ lat, lon }), { id: region.id, name, country });
    assert.deepEqual(english.regionById(region.id), { id: region.id, name, country });
    assert.deepEqual(english.regionAnchor(region.id), regions.regionAnchor(region.id));
    assert.deepEqual(english.outline(region.id), regions.outline(region.id));
  }
});

test('手选目录的每个地区都有可反查到同一地区的内部地图锚点', () => {
  assert.ok(regions.regions.length > 4_000);
  for (const region of regions.regions) {
    const anchor = regions.regionAnchor(region.id);
    assert.ok(anchor, region.id);
    assert.equal(resolve(anchor)?.id, region.id);
    assert.deepEqual(regions.regionById(region.id), region);
  }
  assert.equal(regions.regionById('unknown'), undefined);
  assert.equal(regions.regionAnchor('unknown'), undefined);
});

test('无 GPS 的手选照片与 GPS 照片同地区合组，保留成员顺序和真实坐标', () => {
  const beijing = at(39.916345, 116.397155);
  const tianjin = at(39.084158, 117.200983);
  const manual = { id: 'manual-beijing', location: '雨天之后', locationRegionId: beijing.id };
  const tagged = { id: 'gps-beijing', location: '39.916345, 116.397155', locationRegionId: tianjin.id };
  const manualOnly = { id: 'manual-tianjin', location: '', locationRegionId: tianjin.id };
  const located = locateMapPhotos([
    manual, { id: 'legacy-text', location: '北京胡同' }, manualOnly, tagged, manual,
    { id: 'bad-id', location: '', locationRegionId: 'unknown' },
    { id: 'sea', location: '0, -140', locationRegionId: tianjin.id },
  ]);
  assert.deepEqual(located.map(({ photo }) => photo.id), ['manual-beijing', 'manual-tianjin', 'gps-beijing', 'bad-id', 'sea']);

  const groups = groupWorksMapPhotos(located, regions);
  assert.equal(groups.length, 2);
  const mixed = groups.find(group => group.id === beijing.id);
  assert.deepEqual(mixed.photos.map(({ photo }) => photo), [manual, tagged]);
  assert.equal(mixed.photos[0].coordinate, undefined);
  assert.equal(mixed.photos[0].photo.location, '雨天之后');
  assert.deepEqual(mixed.representative, { photo: tagged, coordinate: { lat: 39.916345, lon: 116.397155 } });

  const manualGroup = groups.find(group => group.id === tianjin.id);
  assert.deepEqual(manualGroup.photos.map(({ photo }) => photo), [manualOnly]);
  assert.equal(manualGroup.photos[0].coordinate, undefined);
  assert.equal(manualGroup.representative.photo, manualOnly);
  assert.equal(resolve(manualGroup.representative.coordinate)?.id, tianjin.id);
  assert.equal(manualGroup.representative.photo.location, '');
});

test('香港和澳门按特别行政区定位，台湾的台北和高雄归入同一区域', () => {
  const hongKong = at(22.2759, 114.1455);
  assert.equal(hongKong.name, '香港特别行政区');
  assert.equal(at(22.337, 114.18).id, hongKong.id);
  assert.equal(at(22.197107, 113.543873).name, '澳门特别行政区');
  const taipei = at(25.033964, 121.564468);
  assert.equal(taipei.name, '台湾');
  assert.equal(at(22.6273, 120.3014).id, taipei.id);
});

test('使用州、省、都、大区等中文行政区名称，聚合上游较细的行政划分', () => {
  for (const [lat, lon, name] of [
    [37.7749, -122.4194, '加利福尼亚州'],
    [40.7128, -74.006, '纽约州'],
    [45.5017, -73.5673, '魁北克省'],
    [-33.8688, 151.2093, '新南威尔士州'],
    [35.6762, 139.6503, '东京都'],
    [45.4642, 9.19, '伦巴第大区'],
    [41.3874, 2.1686, '加泰罗尼亚自治区'],
    [51.5072, -.1276, '英格兰'],
    [55.9533, -3.1883, '苏格兰'],
  ]) assert.equal(at(lat, lon).name, name);
  const paris = at(48.8566, 2.3522);
  assert.equal(paris.name, '法兰西岛大区');
  assert.equal(at(48.8049, 2.1204).id, paris.id);
  assert.equal(at(48.3904, -4.4861).name, '布列塔尼大区');
});

test('保留离岛、海外大区与跨日期线由多个多边形组成的行政区', () => {
  assert.equal(at(21.347, -157.954).name, '夏威夷州');
  assert.equal(at(26.2124, 127.6809).name, '冲绳县');
  assert.equal(at(-43.95, -176.555).name, '查塔姆群岛');
  const reunion = at(-20.8892, 55.4694);
  assert.equal(reunion.name, '留尼汪');
  assert.equal(reunion.country, '法国');

  const alaska = at(52.85, 173.18);
  assert.equal(alaska.name, '阿拉斯加州');
  assert.equal(at(51.8798, -176.6498).id, alaska.id);
  const dateLineEast = at(66.2, 180);
  assert.equal(dateLineEast.name, '楚科奇自治区');
  assert.equal(at(66.2, -180).id, dateLineEast.id);
  assert.equal(at(66.2, -179.6).id, dateLineEast.id);
});

test('飞地和跨国同名地区不被合并', () => {
  assert.equal(at(41.9029, 12.4534).name, '梵蒂冈');
  assert.equal(at(41.8902, 12.4922).name, '拉齐奥大区');
  assert.equal(at(-29.3151, 27.4869).country, '莱索托');
  assert.equal(at(-29.0852, 26.1596).country, '南非');

  const belgian = at(50.93, 5.34);
  const dutch = at(50.8514, 5.6909);
  assert.equal(belgian.name, '林堡省');
  assert.equal(dutch.name, belgian.name);
  assert.equal(belgian.country, '比利时');
  assert.equal(dutch.country, '荷兰');
  assert.notEqual(belgian.id, dutch.id);
});

test('无已知行政区或坐标无效时不猜测最近地点', () => {
  assert.equal(at(0, -140), undefined);
  assert.equal(at(-80, 50), undefined);
  assert.equal(at(91, 116), undefined);
  assert.equal(at(39, -181), undefined);
  assert.equal(at(NaN, 116), undefined);
  assert.equal(at(39, Infinity), undefined);
});

function paths(path) {
  return path.split('M').filter(Boolean).map(part => {
    const closed = part.endsWith('Z');
    const points = (closed ? part.slice(0, -1) : part).split(' ').map(point => point.split(',').map(Number));
    return closed ? [...points, points[0]] : points;
  });
}

function nearLine(lines, lon, lat, tolerance) {
  for (const points of lines) {
    for (let index = 1; index < points.length; index++) {
      const [x1, y1] = points[index - 1];
      const [x2, y2] = points[index];
      if (lon < Math.min(x1, x2) - tolerance || lon > Math.max(x1, x2) + tolerance ||
        -lat < Math.min(y1, y2) - tolerance || -lat > Math.max(y1, y2) + tolerance) continue;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const projection = ((lon - x1) * dx + (-lat - y1) * dy) / (dx * dx + dy * dy);
      const t = Math.max(0, Math.min(1, projection));
      if (Math.hypot(lon - x1 - t * dx, -lat - y1 - t * dy) <= tolerance) return true;
    }
  }
  return false;
}

function insideFill(fill, lon, lat) {
  let crossings = 0;
  for (const points of paths(fill)) {
    for (let index = 1; index < points.length; index++) {
      const [x1, y1] = points[index - 1];
      const [x2, y2] = points[index];
      if ((y1 > -lat) !== (y2 > -lat) &&
        lon < x1 + (x2 - x1) * (-lat - y1) / (y2 - y1)) crossings += 1;
    }
  }
  return crossings % 2 === 1;
}

const boundaryLines = paths(regions.boundaries);

test('京津冀、新疆及美西共界与归属多边形对齐', () => {
  const targets = [
    {
      point: [116.875636, 39.686467], inside: [[39.916345, 116.397155], [39.084158, 117.200983]],
      names: ['北京市', '天津市'],
    },
    {
      point: [115.802007, 39.542393], inside: [[39.916345, 116.397155], [39.508622, 116.703602]],
      names: ['北京市', '河北省'],
    },
    {
      point: [92.941542, 40.472569], inside: [[43.8256, 87.6168], [39.744, 98.517]],
      names: ['新疆维吾尔自治区', '甘肃省'],
    },
    {
      point: [-119.063104, 38.345268], inside: [[38.5816, -121.4944], [39.1638, -119.7674]],
      names: ['加利福尼亚州', '内华达州'],
    },
  ];
  for (const { point, inside, names } of targets) {
    assert.ok(nearLine(boundaryLines, ...point, .0001), names.join(' / '));
    for (const [index, [lat, lon]] of inside.entries()) {
      const region = at(lat, lon);
      assert.equal(region.name, names[index]);
      const outline = regions.outline(region.id);
      assert.ok(insideFill(outline.fill, lon, lat));
      assert.ok(nearLine(paths(outline.stroke), ...point, .0001));
    }
  }
  // At maximum zoom a simplified Beijing/Hebei bend would diverge by almost 15 screen pixels.
  const bend = [116.7447, 39.965];
  const beijing = regions.outline(at(39.916345, 116.397155).id);
  const hebei = regions.outline(at(39.508622, 116.703602).id);
  for (const lines of [boundaryLines, paths(beijing.stroke), paths(hebei.stroke)]) {
    assert.ok(nearLine(lines, ...bend, 1e-8));
  }
});

test('底图省界省略国界、海岸和已经归并的次级分界', () => {
  const smallerBorders = [
    [[-.150321, 51.531274], [51.5072, -.1276], '英格兰'],
    [[2.233154, 48.869082], [48.8566, 2.3522], '法兰西岛大区'],
    [[9.204441, 45.573997], [45.4642, 9.19], '伦巴第大区'],
  ];
  for (const [point, [lat, lon], name] of smallerBorders) {
    const region = at(lat, lon);
    assert.equal(region.name, name);
    const outline = regions.outline(region.id);
    assert.ok(insideFill(outline.fill, lon, lat));
    assert.equal(nearLine(boundaryLines, ...point, .0006), false);
    assert.equal(nearLine(paths(outline.stroke), ...point, .0001), false);
  }
  assert.equal(nearLine(boundaryLines, -122.2658, 49.002, .02), false);
  assert.equal(nearLine(boundaryLines, 55.46, -20.89, .06), false);
});

test('海外轮廓、内环和日期线多部件可填充，描边省略人工闭口', () => {
  const reunion = at(-20.8892, 55.4694);
  assert.ok(insideFill(regions.outline(reunion.id).fill, 55.4694, -20.8892));
  const rome = at(41.8902, 12.4922);
  const lazio = regions.outline(rome.id);
  assert.ok(insideFill(lazio.fill, 12.4922, 41.8902));
  assert.equal(insideFill(lazio.fill, 12.4534, 41.9029), false);
  assert.equal(regions.outline('unknown'), undefined);

  const chukotka = regions.outline(at(66.2, 180).id);
  assert.ok(insideFill(chukotka.fill, 179.999, 66.2));
  assert.ok(insideFill(chukotka.fill, -179.999, 66.2));
  assert.ok(paths(chukotka.fill).some(points => points.every(([lon]) => lon >= 0)));
  assert.ok(paths(chukotka.fill).some(points => points.every(([lon]) => lon <= 0)));
  for (const lines of [paths(chukotka.stroke), boundaryLines]) {
    for (const points of lines) {
      for (let index = 1; index < points.length; index++) {
        const lon = points[index][0];
        const previousLon = points[index - 1][0];
        assert.ok(lon !== previousLon || Math.abs(lon) !== 180);
        assert.ok(Math.abs(lon - previousLon) < 180);
      }
    }
  }
});
