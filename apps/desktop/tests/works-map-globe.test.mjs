import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const sourceDirectory = new URL('../src/features/works-map/', import.meta.url);

function sourceUrl(name, imports = {}) {
  let source = readFileSync(new URL(name, sourceDirectory), 'utf8');
  for (const [specifier, url] of Object.entries(imports)) {
    source = source.replace(`'${specifier}'`, JSON.stringify(url));
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  return `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
}

const layoutUrl = sourceUrl('works-map-layout.ts');
const globeUrl = sourceUrl('works-map-globe.ts', {
  'd3-geo': import.meta.resolve('d3-geo'),
  './works-map-layout': layoutUrl,
});
const { drawWorksMapGlobe, prepareWorksMapGlobe, worksMapGlobeProjection } = await import(globeUrl);
const { projectWorksMapCoordinate, worksMapGlobeBounds } = await import(layoutUrl);
const map = { x: 24, y: 10, width: 512, height: 400 };

const colors = {
  landFill: '#404447', coastStroke: '#596165', lakeStroke: '#464e52', graticuleStroke: '#353b3e',
};

function recordingCanvas() {
  let paths = [];
  let current;
  return {
    painted: [],
    save() {},
    restore() {},
    beginPath() { paths = []; },
    moveTo(x, y) { current = [[x, y]]; paths.push(current); },
    lineTo(x, y) { current.push([x, y]); },
    closePath() { current.push(current[0]); },
    fill(rule) { this.painted.push({ color: this.fillStyle, paths, rule }); },
    stroke() { this.painted.push({ color: this.strokeStyle, paths }); },
  };
}

function visibleFill(paths, { x, y }) {
  let crossings = 0;
  for (const ring of paths) {
    for (let index = 1; index < ring.length; index++) {
      const [aX, aY] = ring[index - 1];
      const [bX, bY] = ring[index];
      if ((aY > y) !== (bY > y) && x < aX + (bX - aX) * (y - aY) / (bY - aY)) crossings++;
    }
  }
  return crossings % 2 === 1;
}

test('地球底图与作品位置使用同一正射投影，球面背后没有标记或画线', () => {
  const front = 'M-15,10 -15,-10 15,-10 15,10Z';
  const back = 'M145,10 145,-10 165,-10 165,10Z';
  const geometry = prepareWorksMapGlobe({ land: front + back, lakes: '' });
  const view = { center: { lat: 0, lon: 0 }, scale: 179 };
  const context = recordingCanvas();
  drawWorksMapGlobe(context, geometry, view, map, colors);
  const layer = color => context.painted.find(item => item.color === color);
  assert.equal(layer(colors.landFill).rule, 'evenodd');
  assert.equal(layer(colors.landFill).paths.length, 1);
  assert.equal(layer(colors.coastStroke).paths.length, 1);

  const coordinate = { lat: 8, lon: -11 };
  const marker = projectWorksMapCoordinate(coordinate, view, map);
  const [x, y] = worksMapGlobeProjection(view, map)([coordinate.lon, coordinate.lat]);
  assert.ok(Math.abs(marker.x - x) < 1e-8 && Math.abs(marker.y - y) < 1e-8);
  assert.ok(visibleFill(layer(colors.landFill).paths, marker));
  assert.equal(projectWorksMapCoordinate({ lat: 3, lon: 150 }, view, map), undefined);
});

test('转到日期线时，两侧陆地都可填充且仍在圆盘范围内', () => {
  const west = 'M170,-55 170,-70 180,-70 180,-55Z';
  const east = 'M-180,-55 -180,-70 -170,-70 -170,-55Z';
  const geometry = prepareWorksMapGlobe({ land: west + east, lakes: '' });
  const view = { center: { lat: 63, lon: 180 }, scale: 188 };
  const context = recordingCanvas();
  drawWorksMapGlobe(context, geometry, view, map, colors);
  const fill = context.painted.find(layer => layer.color === colors.landFill);
  const stroke = context.painted.find(layer => layer.color === colors.coastStroke);
  for (const lon of [175, -175]) {
    const point = projectWorksMapCoordinate({ lat: 64, lon }, view, map);
    assert.ok(visibleFill(fill.paths, point));
  }
  const disk = worksMapGlobeBounds(view, map);
  for (const path of [...fill.paths, ...stroke.paths]) {
    for (const [x, y] of path) {
      assert.ok(Math.hypot(x - disk.x - disk.width / 2, y - disk.y - disk.height / 2) <= view.scale + 1e-7);
    }
  }
  assert.ok(stroke.paths.every(path => path[0] !== path.at(-1)));
});

test('真实离线地形在总览和放大时只绘制陆地、海岸、湖泊和经纬网', () => {
  const basemap = JSON.parse(readFileSync(new URL('natural-earth.json', sourceDirectory), 'utf8'));
  const globe = prepareWorksMapGlobe(basemap);
  const photo = { lat: 39.916345, lon: 116.397155 };
  const sea = { lat: 31, lon: 147 };
  for (const scale of [190, 600]) {
    const context = recordingCanvas();
    const view = { center: { lat: 41.75, lon: 107.6 }, scale };
    drawWorksMapGlobe(context, globe, view, map, colors);
    assert.deepEqual(context.painted.map(item => item.color), [
      colors.landFill, colors.coastStroke, colors.lakeStroke, colors.graticuleStroke,
    ]);
    assert.ok(context.painted.every(item => item.paths.length > 0));
    const layer = color => context.painted.find(item => item.color === color).paths;
    const beijingPin = projectWorksMapCoordinate(photo, view, map);
    assert.ok(visibleFill(layer(colors.landFill), beijingPin));
    if (scale < 200) {
      const seaPoint = projectWorksMapCoordinate(sea, view, map);
      assert.equal(visibleFill(layer(colors.landFill), seaPoint), false);
    }
  }
  for (const [center, isLand] of [
    [{ lat: 35, lon: 115 }, true],
    [{ lat: 35, lon: 150 }, false],
    [{ lat: 3, lon: -45 }, false],
  ]) {
    const context = recordingCanvas();
    const view = { center, scale: 180 };
    drawWorksMapGlobe(context, globe, view, map, colors);
    const land = context.painted.find(item => item.color === colors.landFill).paths;
    const origin = projectWorksMapCoordinate(center, view, map);
    assert.equal(visibleFill(land, origin), isLand);
    let visibleLand = 0;
    let visiblePoints = 0;
    for (let x = -160; x <= 160; x += 20) {
      for (let y = -160; y <= 160; y += 20) {
        if (x * x + y * y >= 160 ** 2) continue;
        visiblePoints++;
        if (visibleFill(land, { x: origin.x + x, y: origin.y + y })) visibleLand++;
      }
    }
    assert.ok(visibleLand / visiblePoints > .08 && visibleLand / visiblePoints < .65);
  }
});
