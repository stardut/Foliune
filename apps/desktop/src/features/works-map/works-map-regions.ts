export interface WorksMapRegion { id: string; name: string; country: string }
interface Coordinate { lat: number; lon: number }
export type WorksMapRegionResolver = (coordinate: Coordinate) => WorksMapRegion | undefined;
export interface WorksMapRegionOutline { fill: string; stroke: string }
export interface WorksMapRegionData {
  readonly regions: readonly WorksMapRegion[];
  resolve: WorksMapRegionResolver;
  regionById: (regionId: string) => WorksMapRegion | undefined;
  regionAnchor: (regionId: string) => Coordinate | undefined;
  readonly boundaries: string;
  outline: (regionId: string) => WorksMapRegionOutline | undefined;
}

interface PackedWorksMapRegions {
  labels: readonly (readonly string[])[];
  geometry: string;
  boundaries: string;
  merged: readonly number[];
}

interface PackedPolygon {
  region: number;
  offset: number;
  west: number;
  south: number;
  east: number;
  north: number;
  rings?: Int32Array[];
}

const precision = 10_000;
const unitsPerCell = 5 * precision;
const columns = 72;
const rows = 36;
const longitudeOffset = 180 * precision;
const latitudeOffset = 90 * precision;
const pointStride = 2 * latitudeOffset + 1;

function column(lon: number): number {
  return Math.min(columns - 1, Math.floor((lon + longitudeOffset) / unitsPerCell));
}

function row(lat: number): number {
  return Math.min(rows - 1, Math.floor((lat + latitudeOffset) / unitsPerCell));
}

// Values are stored as base-128 varints. Signed coordinates use zigzag encoding.
class RegionReader {
  constructor(private readonly bytes: Uint8Array, public offset = 0) {}

  unsigned(): number {
    let result = 0;
    for (let shift = 0; this.offset < this.bytes.length && shift < 32; shift += 7) {
      const byte = this.bytes[this.offset++];
      result |= (byte & 127) << shift;
      if (byte < 128) return result >>> 0;
    }
    throw new Error('离线地区数据不完整');
  }

  signed(): number {
    const value = this.unsigned();
    return (value >>> 1) ^ -(value & 1);
  }
}

function readLine(reader: RegionReader): Int32Array {
  const points = new Int32Array(reader.unsigned() * 2);
  let lon = 0;
  let lat = 0;
  for (let index = 0; index < points.length; index += 2) {
    lon += reader.signed();
    lat += reader.signed();
    points[index] = lon;
    points[index + 1] = lat;
  }
  return points;
}

function readRings(bytes: Uint8Array, offset: number): Int32Array[] {
  const reader = new RegionReader(bytes, offset);
  return Array.from({ length: reader.unsigned() }, () => readLine(reader));
}

function ringContains(points: Int32Array, lon: number, lat: number): boolean {
  let inside = false;
  let previousLon = points[points.length - 2];
  let previousLat = points[points.length - 1];
  for (let index = 0; index < points.length; index += 2) {
    const currentLon = points[index];
    const currentLat = points[index + 1];
    if (lon === currentLon && lat === currentLat) return true;
    if (lat === currentLat && lat === previousLat && lon >= Math.min(previousLon, currentLon) &&
      lon <= Math.max(previousLon, currentLon)) return true;
    if ((currentLat > lat) !== (previousLat > lat)) {
      const crossing = currentLon + (previousLon - currentLon) * (lat - currentLat) / (previousLat - currentLat);
      if (crossing === lon) return true;
      if (crossing > lon) inside = !inside;
    }
    previousLon = currentLon;
    previousLat = currentLat;
  }
  return inside;
}

function polygonContains(polygon: PackedPolygon, bytes: Uint8Array, lon: number, lat: number): boolean {
  if (lon < polygon.west || lon > polygon.east || lat < polygon.south || lat > polygon.north) return false;
  const rings = polygon.rings ??= readRings(bytes, polygon.offset);
  if (!ringContains(rings[0], lon, lat)) return false;
  for (let index = 1; index < rings.length; index++) {
    if (ringContains(rings[index], lon, lat)) return false;
  }
  return true;
}

function readBytes(encoded: string): Uint8Array {
  const decoded = atob(encoded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < bytes.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function svgPoint(points: Int32Array, index: number): string {
  return `${points[index] / precision},${-points[index + 1] / precision}`;
}

function svgLine(points: Int32Array): string {
  let path = `M${svgPoint(points, 0)}`;
  for (let index = 2; index < points.length; index += 2) path += ` ${svgPoint(points, index)}`;
  return path;
}

function readBoundaryPath(encoded: string): string {
  const bytes = readBytes(encoded);
  const reader = new RegionReader(bytes);
  let path = '';
  while (reader.offset < bytes.length) path += svgLine(readLine(reader));
  return path;
}

function keyForPoint(lon: number, lat: number): number {
  return (lon + longitudeOffset) * pointStride + lat + latitudeOffset;
}

// Shared edges of subregions cancel in the outline of their merged region.
function dissolveRings(rings: readonly Int32Array[]): Int32Array[] {
  const adjacency = new Map<number, Set<number>>();
  function toggleNeighbor(from: number, to: number) {
    const neighbors = adjacency.get(from);
    if (!neighbors) adjacency.set(from, new Set([to]));
    else if (!neighbors.delete(to)) neighbors.add(to);
  }
  for (const ring of rings) {
    let from = keyForPoint(ring[ring.length - 2], ring[ring.length - 1]);
    for (let index = 0; index < ring.length; index += 2) {
      const to = keyForPoint(ring[index], ring[index + 1]);
      toggleNeighbor(from, to);
      toggleNeighbor(to, from);
      from = to;
    }
  }
  const outlines: Int32Array[] = [];
  for (const [start, neighbors] of adjacency) {
    while (neighbors.size > 0) {
      const points: number[] = [];
      let current = start;
      do {
        points.push(Math.floor(current / pointStride) - longitudeOffset, current % pointStride - latitudeOffset);
        const adjacent = adjacency.get(current);
        const next = adjacent?.values().next().value;
        if (next === undefined) throw new Error('行政区轮廓未闭合');
        adjacent?.delete(next);
        adjacency.get(next)?.delete(current);
        current = next;
      } while (current !== start);
      outlines.push(Int32Array.from(points));
    }
  }
  return outlines;
}

function dateLineEdge(ring: Int32Array, from: number, to: number): boolean {
  return ring[from] === ring[to] && Math.abs(ring[from]) === longitudeOffset;
}

function ringStroke(ring: Int32Array, closedPath: string): string {
  let cutFrom = -1;
  for (let from = 0; from < ring.length; from += 2) {
    if (!dateLineEdge(ring, from, (from + 2) % ring.length)) continue;
    cutFrom = from;
    break;
  }
  if (cutFrom < 0) return closedPath;
  let path = '';
  let begin = true;
  for (let step = 2; step < ring.length; step += 2) {
    const from = (cutFrom + step) % ring.length;
    const to = (from + 2) % ring.length;
    if (dateLineEdge(ring, from, to)) {
      begin = true;
      continue;
    }
    if (begin) path += `M${svgPoint(ring, from)}`;
    path += ` ${svgPoint(ring, to)}`;
    begin = false;
  }
  return path;
}

function polygonAnchor(polygon: PackedPolygon, bytes: Uint8Array, matches: (coordinate: Coordinate) => boolean): Coordinate | undefined {
  const rings = polygon.rings ??= readRings(bytes, polygon.offset);
  const candidates: { coordinate: Coordinate; width: number }[] = [];
  // A midpoint of an interior horizontal span stays out of holes and off the polygon's edge.
  for (const fraction of [.5, .25, .75, .125, .375, .625, .875]) {
    const lat = polygon.south + (polygon.north - polygon.south) * fraction;
    const crossings: number[] = [];
    for (const ring of rings) {
      let previousLon = ring[ring.length - 2];
      let previousLat = ring[ring.length - 1];
      for (let index = 0; index < ring.length; index += 2) {
        const lon = ring[index];
        const nextLat = ring[index + 1];
        if ((previousLat > lat) !== (nextLat > lat)) {
          crossings.push(previousLon + (lon - previousLon) * (lat - previousLat) / (nextLat - previousLat));
        }
        previousLon = lon;
        previousLat = nextLat;
      }
    }
    crossings.sort((a, b) => a - b);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const left = crossings[index];
      const right = crossings[index + 1];
      if (right > left) candidates.push({ coordinate: { lat: lat / precision, lon: (left + right) / (2 * precision) }, width: right - left });
    }
  }
  candidates.sort((a, b) => b.width - a.width);
  return candidates.find(({ coordinate }) => matches(coordinate))?.coordinate;
}

export function createWorksMapRegionData(data: PackedWorksMapRegions, locale: 'zh-CN' | 'en' = 'zh-CN'): WorksMapRegionData {
  const bytes = readBytes(data.geometry);
  const labels = data.labels.map(([id, name, country, nameEn, countryEn]) => locale === 'en'
    ? { id, name: nameEn, country: countryEn }
    : { id, name, country });
  const indexes = new Map(labels.map(({ id }, index) => [id, index]));
  const byRegion: PackedPolygon[][] = Array.from({ length: labels.length }, () => []);
  const merged = new Set(data.merged);
  const grid: PackedPolygon[][] = Array.from({ length: columns * rows }, () => []);
  const reader = new RegionReader(bytes);
  while (reader.offset < bytes.length) {
    const region = reader.unsigned();
    const west = reader.signed();
    const south = reader.signed();
    const east = reader.signed();
    const north = reader.signed();
    const length = reader.unsigned();
    const polygon = { region, west, south, east, north, offset: reader.offset };
    reader.offset += length;
    byRegion[region].push(polygon);
    for (let y = row(south); y <= row(north); y++) {
      for (let x = column(west); x <= column(east); x++) grid[y * columns + x].push(polygon);
    }
  }

  const resolve: WorksMapRegionResolver = ({ lon, lat }) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return undefined;
    const y = lat * precision;
    const integerLon = lon * precision;
    const longitudes = Math.abs(lon) === 180 ? [integerLon, -integerLon] : [integerLon];
    let match: number | undefined;
    for (const x of longitudes) {
      for (const polygon of grid[row(y) * columns + column(x)]) {
        if (polygon.region === match || !polygonContains(polygon, bytes, x, y)) continue;
        // A match in two regions does not establish a unique administrative location.
        if (match !== undefined) return undefined;
        match = polygon.region;
      }
    }
    return match === undefined ? undefined : labels[match];
  };

  let boundaries: string | undefined;
  let lastOutline: { region: number; path: WorksMapRegionOutline } | undefined;
  const anchors = new Map<number, Coordinate | undefined>();
  return {
    regions: labels.filter((_, index) => byRegion[index].length > 0),
    resolve,
    regionById(regionId) {
      const index = indexes.get(regionId);
      return index === undefined ? undefined : labels[index];
    },
    regionAnchor(regionId) {
      const index = indexes.get(regionId);
      if (index === undefined) return undefined;
      if (anchors.has(index)) return anchors.get(index);
      const size = ({ west, east, south, north }: PackedPolygon) => (east - west) * (north - south);
      const polygons = [...byRegion[index]].sort((a, b) => size(b) - size(a));
      let anchor: Coordinate | undefined;
      for (const polygon of polygons) {
        anchor = polygonAnchor(polygon, bytes, coordinate => resolve(coordinate)?.id === regionId);
        if (anchor) break;
      }
      anchors.set(index, anchor);
      return anchor;
    },
    get boundaries() {
      return boundaries ??= readBoundaryPath(data.boundaries);
    },
    outline(regionId) {
      const region = indexes.get(regionId);
      if (region === undefined || byRegion[region].length === 0) return undefined;
      if (lastOutline?.region === region) return lastOutline.path;
      let rings = byRegion[region].flatMap(polygon => polygon.rings ??= readRings(bytes, polygon.offset));
      if (merged.has(region)) rings = dissolveRings(rings);
      let fill = '';
      let stroke = '';
      for (const ring of rings) {
        const path = svgLine(ring) + 'Z';
        fill += path;
        stroke += ringStroke(ring, path);
      }
      const path = { fill, stroke };
      lastOutline = { region, path };
      return path;
    },
  };
}

const pendingRegions = new Map<'zh-CN' | 'en', Promise<WorksMapRegionData>>();

export function loadWorksMapRegionData(locale: 'zh-CN' | 'en'): Promise<WorksMapRegionData> {
  let pending = pendingRegions.get(locale);
  if (!pending) {
    pending = import('./natural-earth-regions.json').then(({ default: data }) => createWorksMapRegionData(data, locale));
    pendingRegions.set(locale, pending);
  }
  return pending;
}
