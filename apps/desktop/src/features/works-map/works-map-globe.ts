import { geoArea, geoGraticule, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { minWorksMapScale, worksMapDrawingBounds, worksMapVisibleCircle, type MapRect, type WorksMapView } from './works-map-layout';
import type { WorksMapRegionOutline } from './works-map-regions';

type Position = [number, number];
type Lines = { type: 'MultiLineString'; coordinates: Position[][] };
type Areas = { type: 'MultiPolygon'; coordinates: Position[][][] };

interface GeographicPath {
  points: Position[];
  closed: boolean;
}
type Vector = [number, number, number];
interface SphericalCap { axis: Vector; cosine: number; sine: number }
interface GlobeLayers {
  land: Areas;
  coast: Lines;
  lakes: Lines;
  boundaries: Lines;
  caps: Record<'land' | 'coast' | 'lakes' | 'boundaries', (SphericalCap | undefined)[]>;
}
export interface WorksMapGlobeGeometry {
  overview: GlobeLayers;
  readonly detailed: GlobeLayers;
}
export interface WorksMapGlobeColors {
  landFill: string;
  coastStroke: string;
  lakeStroke: string;
  boundaryStroke: string;
  selectedFill: string;
  selectedStroke: string;
  graticuleStroke?: string;
}
interface SelectedGeometry { fill: Areas; stroke: Lines }

const graticule = geoGraticule().step([30, 30]).stepMajor([90, 90]).precision(5)();
const outlineGeometry = new WeakMap<WorksMapRegionOutline, SelectedGeometry>();
const radians = Math.PI / 180;

// The bundled Natural Earth paths use longitude and inverted latitude.
function geographicPaths(path: string): GeographicPath[] {
  return path.split('M').slice(1).map(part => {
    const closed = part.endsWith('Z');
    const coordinates = closed ? part.slice(0, -1) : part;
    const points = coordinates.split(' ').map((coordinate): Position => {
      const comma = coordinate.indexOf(',');
      return [Number(coordinate.slice(0, comma)), -Number(coordinate.slice(comma + 1))];
    });
    return { points, closed };
  });
}

function signedArea(ring: readonly Position[]): number {
  let area = 0;
  let previous = ring[ring.length - 1];
  for (const point of ring) {
    area += previous[0] * point[1] - point[0] * previous[1];
    previous = point;
  }
  return area / 2;
}

function distanceSquared(point: Position, start: Position, end: Position): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const x = point[0] - start[0];
  const y = point[1] - start[1];
  const length = dx * dx + dy * dy;
  const fraction = length ? Math.min(1, Math.max(0, (x * dx + y * dy) / length)) : 0;
  return (x - fraction * dx) ** 2 + (y - fraction * dy) ** 2;
}

function simplify(points: Position[], tolerance: number): Position[] {
  if (points.length < 5) return points;
  const kept = new Uint8Array(points.length);
  kept[0] = kept[points.length - 1] = 1;
  const ranges = [[0, points.length - 1]];
  while (ranges.length > 0) {
    const [start, end] = ranges.pop()!;
    let maximum = tolerance * tolerance;
    let split = -1;
    for (let index = start + 1; index < end; index++) {
      const deviation = distanceSquared(points[index], points[start], points[end]);
      if (deviation <= maximum) continue;
      maximum = deviation;
      split = index;
    }
    if (split < 0) continue;
    kept[split] = 1;
    ranges.push([start, split], [split, end]);
  }
  const result = points.filter((_, index) => kept[index]);
  return result.length >= 4 || points[0] !== points[points.length - 1] ? result : points;
}

function closeRing(points: Position[]): Position[] {
  return [...points, points[0]];
}

function simplifyRing(ring: Position[], tolerance: number): Position[] {
  const simplified = simplify(ring, tolerance);
  if (simplified === ring) return ring;
  // A reversed ring would make D3 fill the other side of the globe.
  if (signedArea(ring) * signedArea(simplified) <= 0) return ring;
  const complement = (coordinates: Position[]) =>
    geoArea({ type: 'Polygon', coordinates: [coordinates] }) > 2 * Math.PI;
  return complement(ring) === complement(simplified) ? simplified : ring;
}

function sphereVector([lon, lat]: Position): Vector {
  const latitude = lat * radians;
  const longitude = lon * radians;
  return [Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude)];
}

function dot(a: Vector, b: Vector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Only cull shapes enclosed by a convex spherical cap. Long paths and continents still use D3's clip.
function coveringCap(points: Position[]): SphericalCap | undefined {
  const axis = sphereVector(points[0]);
  let cosine = 1;
  for (const point of points) cosine = Math.min(cosine, dot(axis, sphereVector(point)));
  return cosine > 0 ? { axis, cosine, sine: Math.sqrt(1 - cosine * cosine) } : undefined;
}

function visibilityTest(view: WorksMapView, map: MapRect) {
  const front = sphereVector([view.center.lon, view.center.lat]);
  const sine = Math.min(1, (worksMapVisibleCircle(view, map).radius + 4) / view.scale);
  const cosine = Math.sqrt(1 - sine * sine);
  return (cap: SphericalCap | undefined) => !cap || dot(front, cap.axis) >= cosine * cap.cosine - sine * cap.sine - 1e-10;
}

function coastlineSegments(ring: Position[]): Position[][] {
  const segments: Position[][] = [];
  const closed = closeRing(ring);
  let segment = [closed[0]];
  for (let index = 1; index < closed.length; index++) {
    const previous = closed[index - 1];
    const point = closed[index];
    if (previous[0] === point[0] && Math.abs(point[0]) === 180) {
      if (segment.length > 1) segments.push(segment);
      segment = [point];
    } else {
      segment.push(point);
    }
  }
  if (segment.length > 1) segments.push(segment);
  return segments;
}

export function prepareWorksMapGlobe(
  basemap: { land: string; lakes: string }, boundaries: string,
): WorksMapGlobeGeometry {
  // The atlas stores each clockwise exterior immediately before its counterclockwise holes.
  const polygons: Position[][][] = [];
  const coastline: Position[][] = [];
  for (const { points } of geographicPaths(basemap.land)) {
    if (signedArea(points) <= 0 || polygons.length === 0) polygons.push([]);
    polygons[polygons.length - 1].push(closeRing(points));
    coastline.push(...coastlineSegments(points));
  }
  const lakeLines = geographicPaths(basemap.lakes).map(({ points }) => closeRing(points));
  const borderLines = geographicPaths(boundaries).map(({ points }) => points);

  function layers(tolerance: number): GlobeLayers {
    const lines = (paths: Position[][]): Lines => ({
      type: 'MultiLineString', coordinates: paths.map(points => simplify(points, tolerance)),
    });
    const land: Areas = { type: 'MultiPolygon', coordinates: polygons.map(polygon => polygon.map(ring => simplifyRing(ring, tolerance))) };
    const coast = lines(coastline);
    const lakes = lines(lakeLines);
    const boundaries = lines(borderLines);
    return {
      land, coast, lakes, boundaries,
      caps: {
        land: land.coordinates.map(([outer]) => coveringCap(outer)),
        coast: coast.coordinates.map(coveringCap),
        lakes: lakes.coordinates.map(coveringCap),
        boundaries: boundaries.coordinates.map(coveringCap),
      },
    };
  }

  let detailed: GlobeLayers | undefined;
  return {
    overview: layers(.13),
    get detailed() { return detailed ??= layers(.035); },
  };
}

function containsPosition(ring: Position[], point: Position): boolean {
  let inside = false;
  let previous = ring[ring.length - 1];
  for (const current of ring) {
    if ((previous[1] > point[1]) !== (current[1] > point[1])
      && point[0] < current[0] + (previous[0] - current[0]) * (point[1] - current[1]) / (previous[1] - current[1])) {
      inside = !inside;
    }
    previous = current;
  }
  return inside;
}

function selectedGeometry(outline: WorksMapRegionOutline): SelectedGeometry {
  const cached = outlineGeometry.get(outline);
  if (cached) return cached;
  // Merged regions may come with arbitrary winding. Nest holes first, then apply D3's winding convention.
  const rings = geographicPaths(outline.fill).map(({ points }) => {
    const area = signedArea(points);
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [lon, lat] of points) {
      west = Math.min(west, lon);
      south = Math.min(south, lat);
      east = Math.max(east, lon);
      north = Math.max(north, lat);
    }
    return { points, area, west, south, east, north, depth: 0, polygon: [] as Position[][] };
  }).sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

  const polygons: Position[][][] = [];
  const nested: typeof rings = [];
  for (const ring of rings) {
    const parent = nested.find(({ west, south, east, north, points }) =>
      west <= ring.west && south <= ring.south && east >= ring.east && north >= ring.north && containsPosition(points, ring.points[0]));
    ring.depth = parent ? parent.depth + 1 : 0;
    const exterior = ring.depth % 2 === 0;
    const points = exterior === (ring.area < 0) ? ring.points : [...ring.points].reverse();
    if (exterior) {
      ring.polygon = [closeRing(points)];
      polygons.push(ring.polygon);
    } else if (parent) {
      ring.polygon = parent.polygon;
      ring.polygon.push(closeRing(points));
    }
    nested.unshift(ring);
  }
  const stroke = geographicPaths(outline.stroke).map(({ points, closed }) => closed ? closeRing(points) : points);
  const geometry: SelectedGeometry = {
    fill: { type: 'MultiPolygon', coordinates: polygons },
    stroke: { type: 'MultiLineString', coordinates: stroke },
  };
  outlineGeometry.set(outline, geometry);
  return geometry;
}

export function worksMapGlobeProjection(view: WorksMapView, map: MapRect) {
  const projection = geoOrthographic()
    .translate([map.x + map.width / 2, map.y + map.height / 2])
    .rotate([-view.center.lon, -view.center.lat])
    .scale(view.scale)
    .clipAngle(90)
    .precision(.45);
  if (view.scale * 2 > Math.min(map.width, map.height)) {
    const bounds = worksMapDrawingBounds(view, map);
    projection.clipExtent([[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y + bounds.height]]);
  }
  return projection;
}

export function drawWorksMapGlobe(
  context: CanvasRenderingContext2D, geometry: WorksMapGlobeGeometry, view: WorksMapView, map: MapRect,
  colors: WorksMapGlobeColors, selectedOutline?: WorksMapRegionOutline,
): void {
  const overviewLimit = Math.max(240, minWorksMapScale(map) * 1.12);
  const layers = view.scale <= overviewLimit ? geometry.overview : geometry.detailed;
  const project = geoPath(worksMapGlobeProjection(view, map), context);
  const selected = selectedOutline && selectedGeometry(selectedOutline);
  const visible = visibilityTest(view, map);

  function fill(shape: Areas, color: string) {
    context.beginPath();
    project(shape);
    context.fillStyle = color;
    context.fill('evenodd');
  }
  function stroke(shape: GeoPermissibleObjects, color: string, width: number) {
    context.beginPath();
    project(shape);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.stroke();
  }

  context.save();
  context.lineJoin = 'round';
  context.lineCap = 'round';
  fill({ ...layers.land, coordinates: layers.land.coordinates.filter((_, index) => visible(layers.caps.land[index])) }, colors.landFill);
  stroke({ ...layers.coast, coordinates: layers.coast.coordinates.filter((_, index) => visible(layers.caps.coast[index])) }, colors.coastStroke, .65);
  stroke({ ...layers.lakes, coordinates: layers.lakes.coordinates.filter((_, index) => visible(layers.caps.lakes[index])) }, colors.lakeStroke, .65);
  if (colors.graticuleStroke) stroke(graticule, colors.graticuleStroke, .55);
  if (selected) fill(selected.fill, colors.selectedFill);
  stroke({ ...layers.boundaries, coordinates: layers.boundaries.coordinates.filter((_, index) => visible(layers.caps.boundaries[index])) }, colors.boundaryStroke, .65);
  if (selected) stroke(selected.stroke, colors.selectedStroke, 1.05);
  context.restore();
}
