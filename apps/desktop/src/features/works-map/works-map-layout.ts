import type { WorksMapRegion, WorksMapRegionData } from './works-map-regions';

export interface MapPoint { x: number; y: number }
export interface MapRect extends MapPoint { width: number; height: number }
export interface MapCoordinate { lat: number; lon: number }
export interface MapPhoto { id: string; location: string; locationRegionId?: string; width?: number | null; height?: number | null }
export interface LocatedMapPhoto<T extends MapPhoto> { photo: T; coordinate?: MapCoordinate }
export interface WorksMapView { center: MapCoordinate; scale: number }
export interface WorksMapFrame { map: MapRect; narrow: boolean; lowerShelf: number }
export interface WorksMapRegionGroup<T extends MapPhoto> extends WorksMapRegion {
  // Use the region's interior point when GPS is unavailable or conflicts with a manual region.
  representative: { photo: T; coordinate: MapCoordinate };
  photos: LocatedMapPhoto<T>[];
  whenExpanded?: WorksMapRegionGroup<T>[];
}
export interface WorksMapRegionMarker<T extends MapPhoto> { group: WorksMapRegionGroup<T>; point: MapPoint }
export interface WorksMapCard<T extends MapPhoto> {
  regionId: string;
  photo: T;
  rect: MapRect;
  captionRect: MapRect;
  side: CardSide;
  line: MapLine;
}
interface WorksMapLayout<T extends MapPhoto> {
  markers: WorksMapRegionMarker<T>[];
  cards: WorksMapCard<T>[];
}

type CardSide = 'right' | 'bottom' | 'left';
interface MapLine { from: MapPoint; to: MapPoint }
interface CardPlacement<T extends MapPhoto> { card: WorksMapCard<T>; bounds: MapRect; label: MapRect; score: number; covered: number }

const coordinatePattern = /^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*$/;
const markerClearance = 11;
const captionHeight = 18;
const wingGap = 22;
const shelfGap = 13;
const stagePadding = 12;
const wideSides: readonly CardSide[] = ['left', 'right'];
const narrowSides: readonly CardSide[] = ['bottom'];
const positionOffsets = [0, -.3, .3, -.6, .6, -1, 1, -1.4, 1.4, -2, 2, -3, 3];
const maxCover = .36;
const zoomRange = 8;
const radians = Math.PI / 180;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);
const mapCenter = (rect: MapRect): MapPoint => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const right = (rect: MapRect) => rect.x + rect.width;
const bottom = (rect: MapRect) => rect.y + rect.height;
const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const contains = (rect: MapRect, p: MapPoint) =>
  p.x >= rect.x && p.x <= right(rect) && p.y >= rect.y && p.y <= bottom(rect);
const area = (rect: MapRect) => rect.width * rect.height;

function wrapLongitude(lon: number): number {
  if (lon >= -180 && lon < 180) return lon || 0;
  return ((lon % 360 + 540) % 360) - 180;
}

export function parseWorksMapCoordinate(location: string): MapCoordinate | undefined {
  const match = coordinatePattern.exec(location);
  if (!match) return undefined;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat: lat || 0, lon: wrapLongitude(lon) };
}

export function locateMapPhotos<T extends MapPhoto>(photos: readonly T[]): LocatedMapPhoto<T>[] {
  const located: LocatedMapPhoto<T>[] = [];
  const seen = new Set<string>();
  for (const photo of photos) {
    if (seen.has(photo.id)) continue;
    const coordinate = parseWorksMapCoordinate(photo.location);
    if (!coordinate && !photo.locationRegionId) continue;
    seen.add(photo.id);
    located.push({ photo, coordinate });
  }
  return located;
}

export function groupWorksMapPhotos<T extends MapPhoto>(
  photos: readonly LocatedMapPhoto<T>[], regions: Pick<WorksMapRegionData, 'resolve' | 'regionById' | 'regionAnchor'>,
): WorksMapRegionGroup<T>[] {
  type Group = {
    region: WorksMapRegion; photos: LocatedMapPhoto<T>[]; gps?: WorksMapRegionGroup<T>['representative'];
    useRegionAnchor: boolean;
  };
  const overview = new Map<string, Group>();
  const details = new Map<string, Group>();
  function add(groups: Map<string, Group>, region: WorksMapRegion, item: LocatedMapPhoto<T>, gpsRegion?: WorksMapRegion) {
    const { coordinate, photo } = item;
    let group = groups.get(region.id);
    if (!group) {
      group = { region, photos: [], useRegionAnchor: false };
      groups.set(region.id, group);
    }
    group.photos.push(item);
    if (coordinate) {
      const belongsToRegion = gpsRegion?.id === region.id || gpsRegion?.parentId === region.id;
      if (!belongsToRegion) group.useRegionAnchor = true;
      else if (!group.gps) group.gps = { photo, coordinate };
    }
  }
  for (const item of photos) {
    const { coordinate, photo } = item;
    const gpsRegion = coordinate && regions.resolve(coordinate);
    const manualRegion = photo.locationRegionId ? regions.regionById(photo.locationRegionId) : undefined;
    const region = manualRegion ?? gpsRegion;
    if (!region) continue;
    const parent = !manualRegion && region.parentId ? regions.regionById(region.parentId) : undefined;
    add(overview, parent ?? region, item, gpsRegion);
    add(details, region, item, gpsRegion);
  }
  function finish(groups: Iterable<Group>): WorksMapRegionGroup<T>[] {
    return [...groups].flatMap(({ region, photos: members, gps, useRegionAnchor }) => {
      const coordinate = !useRegionAnchor && gps ? gps.coordinate : regions.regionAnchor(region.id);
      return coordinate ? [{ ...region, photos: members, representative: { photo: gps?.photo ?? members[0].photo, coordinate } }] : [];
    }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  }
  const citiesByProvince = new Map<string, WorksMapRegionGroup<T>[]>();
  for (const group of finish([...details.values()].filter(({ region }) => region.parentId))) {
    const id = group.parentId!;
    const children = citiesByProvince.get(id);
    if (children) children.push(group);
    else citiesByProvince.set(id, [group]);
  }
  return finish(overview.values()).map(group => {
    const cities = citiesByProvince.get(group.id);
    if (!cities) return group;
    const province = details.get(group.id);
    return { ...group, whenExpanded: province ? [...cities, ...finish([province])] : cities };
  });
}

export function createWorksMapFrame(width: number, height: number): WorksMapFrame {
  const narrow = width < 940 || height < 450;
  const x = narrow ? Math.min(14, width / 8) : clamp(width * .19, 178, 240);
  const y = narrow ? Math.min(12, height / 8) : 28;
  const lowerShelf = narrow ? Math.min(132, height * .30) : y;
  return {
    map: { x, y, width: Math.max(0, width - x * 2), height: Math.max(0, height - y - lowerShelf) },
    narrow,
    lowerShelf,
  };
}

export function minWorksMapScale(map: MapRect): number {
  return Math.max(1, Math.min(map.width, map.height) / 2 - 8);
}

export function maxWorksMapScale(map: MapRect): number {
  return minWorksMapScale(map) * zoomRange;
}

export function worksMapGlobeBounds(view: WorksMapView, map: MapRect): MapRect {
  const center = mapCenter(map);
  return { x: center.x - view.scale, y: center.y - view.scale, width: view.scale * 2, height: view.scale * 2 };
}

export function worksMapVisibleCircle(view: WorksMapView, map: MapRect): { center: MapPoint; radius: number } {
  const minimum = minWorksMapScale(map);
  const maximumRadius = Math.min(
    minimum + 30,
    map.width / 2 + Math.max(0, map.x - 4),
    map.height / 2 + Math.max(0, map.y - 4),
  );
  const zoomProgress = clamp(Math.log(view.scale / minimum) / Math.log(zoomRange), 0, 1);
  const radius = Math.min(view.scale, minimum + (maximumRadius - minimum) * zoomProgress);
  return { center: mapCenter(map), radius };
}

export function worksMapDrawingBounds(view: WorksMapView, map: MapRect): MapRect {
  if (view.scale <= minWorksMapScale(map)) return map;
  // Use one backing size throughout zoom so animation does not reallocate either canvas every frame.
  const { radius } = worksMapVisibleCircle({ ...view, scale: maxWorksMapScale(map) }, map);
  const insetX = Math.max(0, radius + 4 - map.width / 2);
  const insetY = Math.max(0, radius + 4 - map.height / 2);
  if (!insetX && !insetY) return map;
  return { x: map.x - insetX, y: map.y - insetY, width: map.width + insetX * 2, height: map.height + insetY * 2 };
}

function unitVector({ lat, lon }: MapCoordinate) {
  const latitude = lat * radians;
  const longitude = lon * radians;
  return {
    x: Math.cos(latitude) * Math.cos(longitude),
    y: Math.cos(latitude) * Math.sin(longitude),
    z: Math.sin(latitude),
  };
}

export function fitWorksMapView(coordinates: readonly MapCoordinate[], map: MapRect): WorksMapView {
  const vectors = coordinates.map(unitVector);
  let x = 0;
  let y = 0;
  let z = 0;
  for (const vector of vectors) {
    x += vector.x;
    y += vector.y;
    z += vector.z;
  }
  let center = { lat: 0, lon: 0 };
  if (Math.hypot(x, y, z) > vectors.length * .32) {
    center = { lat: Math.atan2(z, Math.hypot(x, y)) / radians, lon: wrapLongitude(Math.atan2(y, x) / radians) };
  } else if (vectors.length > 0) {
    // For a widely scattered collection, choose a populated hemisphere instead of averaging toward empty ocean.
    const step = Math.max(1, Math.floor(vectors.length / 24));
    let best = -1;
    for (let index = 0; index < vectors.length; index += step) {
      const axis = vectors[index];
      const score = vectors.reduce((total, point) =>
        total + Math.max(0, axis.x * point.x + axis.y * point.y + axis.z * point.z), 0);
      if (score <= best) continue;
      best = score;
      center = coordinates[index];
    }
  }
  return { center, scale: minWorksMapScale(map) };
}

export function centerWorksMapView(view: WorksMapView, coordinate: MapCoordinate): WorksMapView {
  return { ...view, center: coordinate };
}

export function projectWorksMapCoordinate(coordinate: MapCoordinate, view: WorksMapView, map: MapRect): MapPoint | undefined {
  return projectCoordinate(coordinate, view, worksMapVisibleCircle(view, map));
}

function projectCoordinate(coordinate: MapCoordinate, view: WorksMapView, { center, radius }: ReturnType<typeof worksMapVisibleCircle>): MapPoint | undefined {
  const latitude = coordinate.lat * radians;
  const longitude = (coordinate.lon - view.center.lon) * radians;
  const tilt = view.center.lat * radians;
  const north = Math.sin(latitude);
  const meridian = Math.cos(latitude) * Math.cos(longitude);
  if (Math.sin(tilt) * north + Math.cos(tilt) * meridian < 1e-10) return undefined;
  const point = {
    x: center.x + view.scale * Math.cos(latitude) * Math.sin(longitude),
    y: center.y + view.scale * (Math.sin(tilt) * meridian - Math.cos(tilt) * north),
  };
  return distance(point, center) <= radius ? point : undefined;
}

function coordinateAtOffset(view: WorksMapView, x: number, y: number): MapCoordinate {
  const tilt = view.center.lat * radians;
  const front = Math.sqrt(Math.max(0, 1 - x * x - y * y));
  return {
    lat: Math.asin(clamp(Math.sin(tilt) * front + Math.cos(tilt) * y, -1, 1)) / radians,
    lon: wrapLongitude(view.center.lon + Math.atan2(x, Math.cos(tilt) * front - Math.sin(tilt) * y) / radians),
  };
}

export function unprojectWorksMapPoint(point: MapPoint, view: WorksMapView, map: MapRect): MapCoordinate | undefined {
  const { center, radius } = worksMapVisibleCircle(view, map);
  if (distance(point, center) > radius) return undefined;
  const x = (point.x - center.x) / view.scale;
  const y = (center.y - point.y) / view.scale;
  return x * x + y * y < 1 ? coordinateAtOffset(view, x, y) : undefined;
}

export function panWorksMapView(view: WorksMapView, dx: number, dy: number): WorksMapView {
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return view;
  const fraction = Math.min(.95, distance / view.scale) / distance;
  return centerWorksMapView(view, coordinateAtOffset(view, -dx * fraction, dy * fraction));
}

export function zoomWorksMapView(view: WorksMapView, map: MapRect, factor: number, anchor = mapCenter(map)): WorksMapView {
  return scaleWorksMapView(view, map, view.scale * factor, anchor);
}

export function scaleWorksMapView(view: WorksMapView, map: MapRect, target: number, anchor = mapCenter(map)): WorksMapView {
  const scale = clamp(target, minWorksMapScale(map), maxWorksMapScale(map));
  if (scale === view.scale) return view;
  const next = { ...view, scale };
  const center = mapCenter(map);
  if (anchor.x === center.x && anchor.y === center.y) return next;
  const coordinate = unprojectWorksMapPoint(anchor, view, map);
  if (!coordinate) return next;
  const x = (anchor.x - center.x) / scale;
  const y = (center.y - anchor.y) / scale;
  const cosLatitude = Math.cos(coordinate.lat * radians);
  if (x * x + y * y >= 1 || Math.abs(x) >= cosLatitude) return next;
  let deltaLongitude = Math.asin(x / cosLatitude);
  if (Math.cos((coordinate.lon - view.center.lon) * radians) < 0) {
    deltaLongitude = deltaLongitude >= 0 ? Math.PI - deltaLongitude : -Math.PI - deltaLongitude;
  }
  const front = Math.sqrt(1 - x * x - y * y);
  const latitude = Math.atan2(Math.sin(coordinate.lat * radians), cosLatitude * Math.cos(deltaLongitude))
    - Math.atan2(y, front);
  if (Math.abs(latitude) > Math.PI / 2) return next;
  return centerWorksMapView(next, { lat: latitude / radians, lon: wrapLongitude(coordinate.lon - deltaLongitude / radians) });
}

function positionRegionMarkers<T extends MapPhoto>(
  groups: readonly WorksMapRegionGroup<T>[], view: WorksMapView, circle: ReturnType<typeof worksMapVisibleCircle>,
): WorksMapRegionMarker<T>[] {
  return groups.flatMap(group => {
    const point = projectCoordinate(group.representative.coordinate, view, circle);
    return point ? [{ group, point }] : [];
  });
}

function lineCrosses(a: MapLine, b: MapLine, interiorOnly = false): boolean {
  const turn = (start: MapPoint, end: MapPoint, point: MapPoint) =>
    (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  if (!(
    Math.max(a.from.x, a.to.x) >= Math.min(b.from.x, b.to.x) &&
    Math.max(b.from.x, b.to.x) >= Math.min(a.from.x, a.to.x) &&
    Math.max(a.from.y, a.to.y) >= Math.min(b.from.y, b.to.y) &&
    Math.max(b.from.y, b.to.y) >= Math.min(a.from.y, a.to.y)
  )) return false;
  const first = turn(a.from, a.to, b.from) * turn(a.from, a.to, b.to);
  const second = turn(b.from, b.to, a.from) * turn(b.from, b.to, a.to);
  return interiorOnly ? first < 0 && second < 0 : first <= 0 && second <= 0;
}

function lineHitsRect(line: MapLine, rect: MapRect): boolean {
  if (contains(rect, line.from) || contains(rect, line.to)) return true;
  const topLeft = rect;
  const topRight = { x: right(rect), y: rect.y };
  const bottomLeft = { x: rect.x, y: bottom(rect) };
  const bottomRight = { x: right(rect), y: bottom(rect) };
  return (
    lineCrosses(line, { from: topLeft, to: topRight }) ||
    lineCrosses(line, { from: topLeft, to: bottomLeft }) ||
    lineCrosses(line, { from: bottomRight, to: topRight }) ||
    lineCrosses(line, { from: bottomRight, to: bottomLeft })
  );
}

function overlapArea(a: MapRect, b: MapRect): number {
  return Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));
}

function cardBounds({ rect, captionRect }: WorksMapCard<MapPhoto>): MapRect {
  return { ...captionRect, y: rect.y, height: rect.height + captionRect.height };
}

function captionLabel<T extends MapPhoto>(caption: MapRect, { name, photos }: WorksMapRegionGroup<T>): MapRect {
  // The centered caption uses 11px text; allow for both full-width characters and the count.
  const width = Math.min(caption.width, [...name].reduce((sum, letter) => sum + (letter.charCodeAt(0) > 255 ? 11 : 7), 8)
    + (photos.length > 1 ? 12 + String(photos.length).length * 7 : 0));
  return { ...caption, x: caption.x + (caption.width - width) / 2, width };
}

function globeEdge(circle: ReturnType<typeof worksMapVisibleCircle>, y: number, height: number) {
  const offAxis = Math.max(0, y - circle.center.y, circle.center.y - y - height);
  return Math.sqrt(Math.max(0, (circle.radius + wingGap) ** 2 - offAxis ** 2));
}

function lineEnd(rect: MapRect, side: CardSide): MapPoint {
  if (side === 'bottom') return { x: rect.x + rect.width / 2, y: rect.y };
  return { x: side === 'left' ? right(rect) : rect.x, y: rect.y + rect.height / 2 };
}

function lineClearsMarkers<T extends MapPhoto>(
  line: MapLine, markers: readonly WorksMapRegionMarker<T>[], regionId: string,
): boolean {
  const minX = Math.min(line.from.x, line.to.x) - markerClearance;
  const maxX = Math.max(line.from.x, line.to.x) + markerClearance;
  const minY = Math.min(line.from.y, line.to.y) - markerClearance;
  const maxY = Math.max(line.from.y, line.to.y) + markerClearance;
  const dx = line.to.x - line.from.x;
  const dy = line.to.y - line.from.y;
  const lengthSquared = dx * dx + dy * dy;
  return !markers.some(({ group, point }) => {
    if (group.id === regionId || point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) return false;
    const x = point.x - line.from.x;
    const y = point.y - line.from.y;
    const distanceSquared = x * x + y * y;
    const fraction = clamp((x * dx + y * dy) / lengthSquared, 0, 1);
    // Nearby halos are clipped between their real centers.
    const clearanceSquared = distanceSquared < markerClearance ** 2 ? distanceSquared / 4 : markerClearance ** 2;
    return (x - fraction * dx) ** 2 + (y - fraction * dy) ** 2 < clearanceSquared;
  });
}

function leaderConflicts<T extends MapPhoto>(card: WorksMapCard<T>, placed: readonly CardPlacement<T>[]) {
  let crossings = 0;
  let throughPhotos = 0;
  for (const { card: other } of placed) {
    if (lineCrosses(card.line, other.line, true)) crossings++;
    if (lineHitsRect(card.line, other.rect)) throughPhotos++;
    if (lineHitsRect(other.line, card.rect)) throughPhotos++;
  }
  return { crossings, throughPhotos };
}

function captionOverlap<T extends MapPhoto>(a: Pick<CardPlacement<T>, 'card' | 'label'>, b: CardPlacement<T>) {
  return overlapArea(a.label, b.card.rect) / area(a.label)
    + overlapArea(b.label, a.card.rect) / area(b.label)
    + overlapArea(a.label, b.label) / Math.min(area(a.label), area(b.label));
}

function chooseCard<T extends MapPhoto>(
  marker: WorksMapRegionMarker<T>, frame: WorksMapFrame, circle: ReturnType<typeof worksMapVisibleCircle>,
  placed: readonly CardPlacement<T>[], markers: readonly WorksMapRegionMarker<T>[], temporary = false,
  replacing?: CardPlacement<T>,
): CardPlacement<T> | undefined {
  const { map, narrow, lowerShelf } = frame;
  const { group, point } = marker;
  const { photo } = group.representative;
  const ratio = photoRatio(photo);
  const stageHeight = bottom(map) + lowerShelf;
  const shelfTop = Math.max(bottom(map), circle.center.y + circle.radius) + shelfGap;
  const stageWidth = right(map) + map.x;
  const wingWidth = circle.center.x - circle.radius;
  const density = Math.max(0, markers.length - (narrow ? 3 : 4));
  const maxWidth = narrow ? Math.min(138, map.width * .45, Math.max(87, 148 - density * 4))
    : Math.min(Math.max(115, 188 - density * 4.5), wingWidth - wingGap - stagePadding);
  const maxHeight = narrow ? Math.min(108, stageHeight - shelfTop - captionHeight - stagePadding)
    : Math.min(Math.max(88, 180 - density * 7.5), stageHeight - captionHeight - stagePadding * 2);
  if (maxWidth < 32 || maxHeight < 18) return undefined;
  const width = Math.min(maxWidth, maxHeight * ratio);
  const height = Math.min(maxHeight, maxWidth / ratio);
  const boundsWidth = Math.min(maxWidth, Math.max(width, 90));
  const boundsHeight = height + captionHeight;
  let best: CardPlacement<T> | undefined;
  const current = replacing && leaderConflicts(replacing.card, placed);
  const preferredSide = point.x < circle.center.x ? 'left' : 'right';
  let bestCrossings = current?.crossings ?? Infinity;
  for (const side of narrow ? narrowSides : wideSides) {
    if (replacing && side !== replacing.card.side && side !== preferredSide) continue;
    const onShelf = side === 'bottom';
    const cardSpan = onShelf ? boundsWidth : boundsHeight;
    const alongStart = onShelf ? map.x : stagePadding;
    const alongEnd = onShelf ? right(map) : stageHeight - stagePadding;
    if (alongEnd - alongStart < cardSpan) continue;
    const ideal = onShelf ? point.x - boundsWidth / 2 : point.y - height / 2;
    const positions = new Set([
      ...positionOffsets.map(offset => clamp(ideal + offset * (cardSpan + 10), alongStart, alongEnd - cardSpan)),
      alongStart, alongEnd - cardSpan,
    ]);
    for (const along of positions) {
      // Use the space beside the curved shoulders as well as the space beyond the equator.
      const edge = onShelf ? 0 : globeEdge(circle, along, boundsHeight);
      const room = side === 'left' ? circle.center.x - edge : stageWidth - circle.center.x - edge;
      const slack = room - boundsWidth - stagePadding;
      if (!onShelf && slack < 0) continue;
      for (const inset of onShelf ? [0] : [0, slack * .16, slack * .36, slack * .64, slack]) {
        const bounds = {
          x: onShelf ? along : side === 'left' ? room - boundsWidth - inset : stageWidth - room + inset,
          y: onShelf ? shelfTop : along, width: boundsWidth, height: boundsHeight,
        };
        const rect = { x: bounds.x + (boundsWidth - width) / 2, y: bounds.y, width, height };
        const captionRect = { x: bounds.x, y: bottom(rect), width: boundsWidth, height: captionHeight };
        const label = captionLabel(captionRect, group);
        const line = { from: point, to: lineEnd(rect, side) };
        const card = { regionId: group.id, photo, rect, captionRect, side, line };
        let score = distance(point, line.to) + inset * .3;
        if (!current && best && score >= best.score) continue;
        const candidate = { card, bounds, label };
        let covered = 0;
        let usable = true;
        for (const existing of placed) {
          const overlap = overlapArea(bounds, existing.bounds);
          covered += overlapArea(rect, existing.bounds);
          // Bound total overlap in both directions so every resting print leaves a usable exposed area.
          if (!temporary && (covered > area(rect) * maxCover ||
            existing.covered + overlapArea(existing.card.rect, bounds) > area(existing.card.rect) * maxCover)) {
            usable = false;
            break;
          }
          score += overlap / area(bounds) * (temporary ? 85 : 115);
          score += 460 * captionOverlap(candidate, existing);
          if (lineCrosses(line, existing.card.line)) score += 260;
          if (lineHitsRect(line, existing.bounds)) score += 95;
          if (lineHitsRect(existing.card.line, bounds)) score += 95;
        }
        if (!usable || (!current && best && score >= best.score)) continue;
        if (current) {
          const { crossings, throughPhotos } = leaderConflicts(card, placed);
          if (crossings >= current.crossings || crossings > bestCrossings || throughPhotos > current.throughPhotos) continue;
          if (side !== preferredSide) score += Math.abs(point.x - circle.center.x);
          for (const { card: other } of placed) {
            if (other.side === side && (point.y - other.line.from.y) * (line.to.y - other.line.to.y) < 0) score += 60;
          }
          if (crossings < bestCrossings) best = undefined;
          bestCrossings = crossings;
        }
        if (!lineClearsMarkers(line, markers, group.id)) score += 240;
        if (!best || score < best.score) {
          best = { ...candidate, score, covered };
        }
      }
    }
  }
  return best;
}

function swapShelfLeaders<T extends MapPhoto>(placed: CardPlacement<T>[], map: MapRect) {
  // Bottom leaders end at the same height. Swap two crossed endpoints without opening a gap in the row.
  const move = (placement: CardPlacement<T>, x: number): CardPlacement<T> => {
    const { card, bounds, label } = placement;
    const dx = x - card.line.to.x;
    const shift = (rect: MapRect) => ({ ...rect, x: rect.x + dx });
    return { ...placement, bounds: shift(bounds), label: shift(label),
      card: { ...card, rect: shift(card.rect), captionRect: shift(card.captionRect),
        line: { from: card.line.from, to: { x, y: card.line.to.y } } } };
  };
  const conflicts = (a: CardPlacement<T>, b: CardPlacement<T>, others: readonly CardPlacement<T>[]) => {
    const first = leaderConflicts(a.card, others);
    const second = leaderConflicts(b.card, [...others, a]);
    return { crossings: first.crossings + second.crossings, throughPhotos: first.throughPhotos + second.throughPhotos };
  };
  const coveredBy = (print: CardPlacement<T>, neighbors: readonly CardPlacement<T>[]) => neighbors.reduce((sum, other) =>
    sum + overlapArea(print.card.rect, other.bounds), 0);
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i];
        const b = placed[j];
        if (!lineCrosses(a.card.line, b.card.line, true)) continue;
        const nextA = move(a, b.card.line.to.x);
        const nextB = move(b, a.card.line.to.x);
        if ([nextA, nextB].some(({ bounds }) => bounds.x < map.x || right(bounds) > right(map))) continue;
        const others = placed.filter((_, index) => index !== i && index !== j);
        const before = conflicts(a, b, others);
        const after = conflicts(nextA, nextB, others);
        if (after.crossings >= before.crossings || after.throughPhotos > before.throughPhotos) continue;
        const captions = (x: CardPlacement<T>, y: CardPlacement<T>) => others.reduce((sum, other) =>
          sum + captionOverlap(x, other) + captionOverlap(y, other), captionOverlap(x, y));
        if (captions(nextA, nextB) > captions(a, b) + 1e-7) continue;
        nextA.covered = coveredBy(nextA, [...others, nextB]);
        nextB.covered = coveredBy(nextB, [...others, nextA]);
        const adjusted = others.map(other => other.covered - coveredBy(other, [a, b]) + coveredBy(other, [nextA, nextB]));
        if ([nextA, nextB].some(print => print.covered > area(print.card.rect) * maxCover)
          || others.some((other, index) => adjusted[index] > area(other.card.rect) * maxCover)) continue;
        for (const [index, other] of others.entries()) other.covered = adjusted[index];
        placed[i] = nextA;
        placed[j] = nextB;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function reorderWingPrints<T extends MapPhoto>(
  placed: CardPlacement<T>[], frame: WorksMapFrame, circle: ReturnType<typeof worksMapVisibleCircle>,
  markers: readonly WorksMapRegionMarker<T>[],
) {
  // Move only prints with crossed leaders, preserving the other prints and their overlap limits.
  const byId = new Map(markers.map(marker => [marker.group.id, marker]));
  for (const [index, placement] of placed.entries()) {
    if (!placed.some(other => other !== placement && lineCrosses(placement.card.line, other.card.line, true))) continue;
    const others = placed.filter(other => other !== placement).map(other => ({
      ...other, covered: other.covered - overlapArea(other.card.rect, placement.bounds),
    }));
    const replacement = chooseCard(byId.get(placement.card.regionId)!, frame, circle, others, markers, false, placement);
    if (!replacement) continue;
    for (const other of placed) {
      if (other !== placement) {
        other.covered = other.covered - overlapArea(other.card.rect, placement.bounds)
          + overlapArea(other.card.rect, replacement.bounds);
      }
    }
    placed[index] = replacement;
  }
}

function photoRatio(photo: MapPhoto): number {
  const ratio = (photo.width ?? 0) / (photo.height ?? 0);
  return ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
}

export function selectWorksMapRegions<T extends MapPhoto>(
  overview: readonly WorksMapRegionGroup<T>[], frame: WorksMapFrame, view: WorksMapView,
): { groups: readonly WorksMapRegionGroup<T>[]; menuOnly: WorksMapRegionGroup<T>[] } {
  const circle = worksMapVisibleCircle(view, frame.map);
  const expanded = new Map<string, WorksMapRegionGroup<T>[]>();
  const isVisible = ({ representative }: WorksMapRegionGroup<T>) => !!projectCoordinate(representative.coordinate, view, circle);
  const visibleCityParents = new Set(overview.filter(group => group.parentId && isVisible(group)).map(group => group.parentId));
  const close = view.scale >= minWorksMapScale(frame.map) * 2;
  for (const province of overview) {
    if (!province.whenExpanded) continue;
    const cities = province.whenExpanded.filter(group => group.parentId === province.id);
    if (visibleCityParents.has(province.id) ||
      ((cities.length > 1 || close || !isVisible(province)) && cities.some(isVisible))) {
      expanded.set(province.id, cities);
    }
  }
  if (!expanded.size) return { groups: overview, menuOnly: [] };
  const menuOnly: WorksMapRegionGroup<T>[] = [];
  const groups = overview.flatMap(group => {
    const cities = expanded.get(group.id);
    if (cities) {
      const provinceRemainder = group.whenExpanded?.find(child => child.id === group.id);
      if (provinceRemainder) menuOnly.push(provinceRemainder);
      return cities;
    }
    return group.parentId && expanded.has(group.parentId) ? [] : [group];
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return { groups, menuOnly };
}

export function layoutWorksMap<T extends MapPhoto>(
  groups: readonly WorksMapRegionGroup<T>[], frame: WorksMapFrame, view: WorksMapView,
): WorksMapLayout<T> {
  if (frame.map.width <= 0 || frame.map.height <= 0) return { markers: [], cards: [] };
  const circle = worksMapVisibleCircle(view, frame.map);
  const markers = positionRegionMarkers(groups, view, circle);
  const placed: CardPlacement<T>[] = [];
  const order = [...markers].sort((a, b) => b.group.photos.length - a.group.photos.length ||
    photoRatio(a.group.representative.photo) - photoRatio(b.group.representative.photo));
  for (const marker of order) {
    const placement = chooseCard(marker, frame, circle, placed, markers);
    if (!placement) continue;
    for (const existing of placed) existing.covered += overlapArea(existing.card.rect, placement.bounds);
    placed.push(placement);
  }
  if (frame.narrow) swapShelfLeaders(placed, frame.map);
  else reorderWingPrints(placed, frame, circle, markers);
  const cards = placed.map(({ card }) => card).sort((a, b) =>
    wideSides.indexOf(a.side) - wideSides.indexOf(b.side) ||
    (a.side === 'bottom' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y),
  );
  return { markers, cards };
}

export function previewWorksMapCard<T extends MapPhoto>(
  regionId: string, layout: WorksMapLayout<T>, frame: WorksMapFrame, view: WorksMapView,
): WorksMapCard<T> | undefined {
  const marker = layout.markers.find(({ group }) => group.id === regionId);
  if (!marker || layout.cards.some(card => card.regionId === regionId)) return undefined;
  const markerById = new Map(layout.markers.map(item => [item.group.id, item]));
  const placed = layout.cards.map(card => ({
    card, bounds: cardBounds(card), label: captionLabel(card.captionRect, markerById.get(card.regionId)!.group), score: 0, covered: 0,
  }));
  return chooseCard(marker, frame, worksMapVisibleCircle(view, frame.map), placed, layout.markers, true)?.card;
}

export function interpolateWorksMapLayout<T extends MapPhoto>(
  start: WorksMapLayout<T>, target: WorksMapLayout<T>, groups: readonly WorksMapRegionGroup<T>[],
  frame: WorksMapFrame, view: WorksMapView, progress: number,
): WorksMapLayout<T> {
  // Reproject the pins every frame. Rearrange the prints only once the animation reaches its destination.
  const circle = worksMapVisibleCircle(view, frame.map);
  const markers = positionRegionMarkers(groups, view, circle);
  const fraction = clamp(progress, 0, 1);
  const mix = (from: number, to: number) => from + (to - from) * fraction;
  const mixRect = (from: MapRect, to: MapRect) => ({
    x: mix(from.x, to.x), y: mix(from.y, to.y), width: mix(from.width, to.width), height: mix(from.height, to.height),
  });
  const markerFor = new Map(markers.map(marker => [marker.group.id, marker.point]));
  const targetFor = new Map(target.cards.map(card => [card.regionId, card]));
  const stageWidth = right(frame.map) + frame.map.x;
  const stageHeight = bottom(frame.map) + frame.lowerShelf;
  const cards: WorksMapCard<T>[] = [];
  for (const from of start.cards) {
    const point = markerFor.get(from.regionId);
    if (!point) continue;
    const next = targetFor.get(from.regionId);
    const to = next?.side === from.side ? next : from;
    const rect = mixRect(from.rect, to.rect);
    const captionRect = mixRect(from.captionRect, to.captionRect);
    if (from.side === 'bottom') {
      const shift = Math.max(0, circle.center.y + circle.radius + shelfGap - rect.y);
      rect.y += shift;
      captionRect.y += shift;
    } else {
      const edge = globeEdge(circle, rect.y, rect.height + captionRect.height);
      const shift = from.side === 'left' ? Math.min(0, circle.center.x - edge - right(captionRect))
        : Math.max(0, circle.center.x + edge - captionRect.x);
      rect.x += shift;
      captionRect.x += shift;
    }
    if (captionRect.x < 0 || right(captionRect) > stageWidth || bottom(captionRect) > stageHeight) continue;
    const line = { from: point, to: lineEnd(rect, from.side) };
    cards.push({ ...from, rect, captionRect, line });
  }
  return { markers, cards };
}
