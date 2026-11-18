import type { WorksMapRegion, WorksMapRegionData } from './works-map-regions';

export interface MapPoint { x: number; y: number }
export interface MapRect extends MapPoint { width: number; height: number }
export interface MapCoordinate { lat: number; lon: number }
export interface MapPhoto { id: string; location: string; locationRegionId?: string; width?: number | null; height?: number | null }
export interface LocatedMapPhoto<T extends MapPhoto> { photo: T; coordinate?: MapCoordinate }
export interface WorksMapView { center: MapCoordinate; scale: number }
export interface WorksMapFrame { map: MapRect; narrow: boolean; lowerShelf: number }
export interface WorksMapRegionGroup<T extends MapPhoto> extends WorksMapRegion {
  // This point places the region on the map. For groups with no GPS it is an interior point of the region.
  representative: { photo: T; coordinate: MapCoordinate };
  photos: LocatedMapPhoto<T>[];
}
export interface WorksMapRegionMarker<T extends MapPhoto> { group: WorksMapRegionGroup<T>; point: MapPoint; button: MapPoint }
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
interface CardPlacement<T extends MapPhoto> { card: WorksMapCard<T>; bounds: MapRect; score: number }

const coordinatePattern = /^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*$/;
const buttonSeparation = 30;
const buttonRadius = 14;
const markerClearance = 11;
const captionHeight = 18;
const cardGap = 12;
const wingGap = 22;
const shelfGap = 13;
const stagePadding = 12;
const wideSides: readonly CardSide[] = ['left', 'right'];
const narrowSides: readonly CardSide[] = ['bottom'];
const positionOffsets = [0, -.25, .25, -.5, .5, -1, 1, -1.5, 1.5, -2, 2];
const radians = Math.PI / 180;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(Math.max(value, minimum), maximum);
const mapCenter = (rect: MapRect): MapPoint => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const right = (rect: MapRect) => rect.x + rect.width;
const bottom = (rect: MapRect) => rect.y + rect.height;
const distance = (a: MapPoint, b: MapPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const contains = (rect: MapRect, p: MapPoint) =>
  p.x >= rect.x && p.x <= right(rect) && p.y >= rect.y && p.y <= bottom(rect);

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
  const groups = new Map<string, {
    region: WorksMapRegion; photos: LocatedMapPhoto<T>[]; gps?: WorksMapRegionGroup<T>['representative'];
  }>();
  for (const item of photos) {
    const { coordinate, photo } = item;
    const region = coordinate ? regions.resolve(coordinate)
      : photo.locationRegionId ? regions.regionById(photo.locationRegionId) : undefined;
    if (!region) continue;
    let group = groups.get(region.id);
    if (!group) {
      group = { region, photos: [] };
      groups.set(region.id, group);
    }
    group.photos.push(item);
    if (coordinate && !group.gps) group.gps = { photo, coordinate };
  }
  return [...groups.values()].flatMap(({ region, photos: members, gps }) => {
    const coordinate = gps?.coordinate ?? regions.regionAnchor(region.id);
    return coordinate ? [{ ...region, photos: members, representative: { photo: gps?.photo ?? members[0].photo, coordinate } }] : [];
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));
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
  return minWorksMapScale(map) * 3.2;
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
  const zoomProgress = clamp((view.scale - minimum) / (maxWorksMapScale(map) - minimum), 0, 1);
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
  const latitude = coordinate.lat * radians;
  const longitude = (coordinate.lon - view.center.lon) * radians;
  const tilt = view.center.lat * radians;
  const north = Math.sin(latitude);
  const meridian = Math.cos(latitude) * Math.cos(longitude);
  if (Math.sin(tilt) * north + Math.cos(tilt) * meridian < 1e-10) return undefined;
  const { center, radius } = worksMapVisibleCircle(view, map);
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
  groups: readonly WorksMapRegionGroup<T>[], map: MapRect, view: WorksMapView,
): WorksMapRegionMarker<T>[] {
  const markers: WorksMapRegionMarker<T>[] = [];
  const occupied = new Map<string, MapPoint[]>();
  const cellOf = (value: number) => Math.floor(value / buttonSeparation);
  function overlaps(point: MapPoint) {
    const column = cellOf(point.x);
    const row = cellOf(point.y);
    for (let i = column - 1; i <= column + 1; i++) {
      for (let j = row - 1; j <= row + 1; j++) {
        if (occupied.get(`${i},${j}`)?.some((button) => distance(button, point) < buttonSeparation)) return true;
      }
    }
    return false;
  }
  for (const group of groups) {
    const point = projectWorksMapCoordinate(group.representative.coordinate, view, map);
    if (!point) continue;
    const button = overlaps(point) ? separateMarkerButton(point, map, view, overlaps) : point;
    const key = `${cellOf(button.x)},${cellOf(button.y)}`;
    const cell = occupied.get(key);
    if (cell) cell.push(button);
    else occupied.set(key, [button]);
    markers.push({ group, point, button });
  }
  return markers;
}

function separateMarkerButton(
  point: MapPoint, map: MapRect, view: WorksMapView, overlaps: (candidate: MapPoint) => boolean,
): MapPoint {
  const insetX = Math.min(buttonRadius, map.width / 2);
  const insetY = Math.min(buttonRadius, map.height / 2);
  const { center, radius: visibleRadius } = worksMapVisibleCircle(view, map);
  let closest: MapPoint | undefined;
  let closestDistance = Infinity;
  for (const radius of [buttonSeparation, buttonSeparation * 2, buttonSeparation * 3]) {
    for (let index = 0; index < 12; index++) {
      const angle = index * Math.PI / 6;
      const candidate = {
        x: clamp(point.x + radius * Math.cos(angle), map.x + insetX, right(map) - insetX),
        y: clamp(point.y + radius * Math.sin(angle), map.y + insetY, bottom(map) - insetY),
      };
      const offset = distance(candidate, point);
      if (offset >= closestDistance || distance(candidate, center) > visibleRadius - 4 || overlaps(candidate)) continue;
      closest = candidate;
      closestDistance = offset;
    }
    if (closest) break;
  }
  return closest ?? point;
}

function lineCrosses(a: MapLine, b: MapLine): boolean {
  const turn = (start: MapPoint, end: MapPoint, point: MapPoint) =>
    (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
  return (
    Math.max(a.from.x, a.to.x) >= Math.min(b.from.x, b.to.x) &&
    Math.max(b.from.x, b.to.x) >= Math.min(a.from.x, a.to.x) &&
    Math.max(a.from.y, a.to.y) >= Math.min(b.from.y, b.to.y) &&
    Math.max(b.from.y, b.to.y) >= Math.min(a.from.y, a.to.y) &&
    turn(a.from, a.to, b.from) * turn(a.from, a.to, b.to) <= 0 &&
    turn(b.from, b.to, a.from) * turn(b.from, b.to, a.to) <= 0
  );
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

function placementConflicts<T extends MapPhoto>(placement: CardPlacement<T>, existing: CardPlacement<T>): boolean {
  const a = placement.bounds;
  const b = existing.bounds;
  return (
    (right(a) + cardGap > b.x && right(b) + cardGap > a.x &&
      bottom(a) + cardGap > b.y && bottom(b) + cardGap > a.y) ||
    lineCrosses(placement.card.line, existing.card.line) ||
    lineHitsRect(placement.card.line, b) ||
    lineHitsRect(existing.card.line, a)
  );
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
  return !markers.some(({ group, point, button }) => {
    if (group.id === regionId) {
      // Its own short line joins at the button. Keep the two segments from overlapping.
      const stemX = point.x - button.x;
      const stemY = point.y - button.y;
      return Math.abs(dx * stemY - dy * stemX) < 1e-7 && dx * stemX + dy * stemY > 0;
    }
    if (point !== button && lineCrosses(line, { from: point, to: button })) return true;
    if (button.x < minX || button.x > maxX || button.y < minY || button.y > maxY) return false;
    const x = button.x - line.from.x;
    const y = button.y - line.from.y;
    const fraction = clamp((x * dx + y * dy) / lengthSquared, 0, 1);
    // Adjacent anchors can start inside the neighboring marker's halo. Allow the line to lead away.
    return fraction > 0 && (x - fraction * dx) ** 2 + (y - fraction * dy) ** 2 < markerClearance ** 2;
  });
}

function chooseCard<T extends MapPhoto>(
  marker: WorksMapRegionMarker<T>, frame: WorksMapFrame, circle: ReturnType<typeof worksMapVisibleCircle>, maxCards: number,
  placed: readonly CardPlacement<T>[], markers: readonly WorksMapRegionMarker<T>[],
): CardPlacement<T> | undefined {
  const { map, narrow, lowerShelf } = frame;
  const { group, button } = marker;
  const { photo } = group.representative;
  const storedRatio = (photo.width ?? 0) / (photo.height ?? 0);
  const ratio = storedRatio > 0 && Number.isFinite(storedRatio) ? storedRatio : 1;
  const stageHeight = bottom(map) + lowerShelf;
  const shelfTop = Math.max(bottom(map), circle.center.y + circle.radius) + shelfGap;
  const stageWidth = right(map) + map.x;
  const globeLeft = circle.center.x - circle.radius;
  const globeRight = circle.center.x + circle.radius;
  const rows = Math.ceil(Math.min(markers.length, maxCards) / 2);
  let best: CardPlacement<T> | undefined;
  for (const side of narrow ? narrowSides : wideSides) {
    const onShelf = side === 'bottom';
    const sideWidth = side === 'left' ? globeLeft : stageWidth - globeRight;
    const maxWidth = narrow
      ? Math.min(138, (map.width - (maxCards - 1) * cardGap) / maxCards)
      : Math.min(188, sideWidth - wingGap - stagePadding);
    const maxHeight = onShelf ? Math.min(108, stageHeight - shelfTop - captionHeight - stagePadding)
      : Math.min(180, (stageHeight - stagePadding * 2 - (rows - 1) * cardGap) / rows - captionHeight);
    if (maxWidth <= 0 || maxHeight <= 0) continue;
    const width = Math.min(maxWidth, maxHeight * ratio);
    const height = Math.min(maxHeight, maxWidth / ratio);
    const boundsWidth = Math.min(maxWidth, Math.max(width, 115));
    const boundsHeight = height + captionHeight;
    const cardSpan = onShelf ? boundsWidth : boundsHeight;
    const alongStart = onShelf ? map.x : stagePadding;
    const alongEnd = onShelf ? right(map) : stageHeight - stagePadding;
    const ideal = onShelf ? button.x - boundsWidth / 2 : button.y - height / 2;
    const candidatePositions = new Set(positionOffsets.map(offset =>
      clamp(ideal + offset * (cardSpan + cardGap), alongStart, alongEnd - cardSpan),
    ));
    for (const along of candidatePositions) {
      const bounds = {
        x: onShelf ? along : side === 'left' ? globeLeft - wingGap - boundsWidth : globeRight + wingGap,
        y: onShelf ? shelfTop : along,
        width: boundsWidth, height: boundsHeight,
      };
      const rect = { x: bounds.x + (boundsWidth - width) / 2, y: bounds.y, width, height };
      const captionRect = { x: bounds.x, y: bottom(rect), width: boundsWidth, height: captionHeight };
      const to = onShelf
        ? { x: rect.x + width / 2, y: rect.y }
        : { x: side === 'left' ? right(rect) : rect.x, y: rect.y + height / 2 };
      const line = { from: button, to };
      const score = distance(button, to);
      if (best && score >= best.score) continue;
      const placement = { card: { regionId: group.id, photo, rect, captionRect, side, line }, bounds, score };
      if (placed.some(existing => placementConflicts(placement, existing))) continue;
      if (lineClearsMarkers(line, markers, group.id)) best = placement;
    }
  }
  return best;
}

export function layoutWorksMap<T extends MapPhoto>(
  groups: readonly WorksMapRegionGroup<T>[], frame: WorksMapFrame, view: WorksMapView, preferredRegionId?: string,
): WorksMapLayout<T> {
  if (frame.map.width <= 0 || frame.map.height <= 0) return { markers: [], cards: [] };
  const markers = positionRegionMarkers(groups, frame.map, view);
  const circle = worksMapVisibleCircle(view, frame.map);
  const maxCards = frame.narrow ? clamp(Math.floor(frame.map.width / 142), 1, 4) : 6;
  const remaining = new Set(markers);
  const placed: CardPlacement<T>[] = [];
  const chosenPoints: MapPoint[] = [];
  const preferred = markers.find(({ group }) => group.id === preferredRegionId);
  for (let attempt = 0; attempt < 24 && placed.length < maxCards && remaining.size > 0; attempt++) {
    let candidate = attempt === 0 ? preferred : undefined;
    if (!candidate) {
      let bestScore = -1;
      for (const marker of remaining) {
        const score = chosenPoints.length === 0
          ? marker.group.photos.length
          : Math.min(...chosenPoints.map(point => distance(point, marker.point)));
        if (score > bestScore) {
          candidate = marker;
          bestScore = score;
        }
      }
    }
    if (!candidate) break;
    remaining.delete(candidate);
    chosenPoints.push(candidate.point);
    const placement = chooseCard(candidate, frame, circle, maxCards, placed, markers);
    if (placement) placed.push(placement);
  }
  const cards = placed.map(({ card }) => card);
  cards.sort((a, b) =>
    wideSides.indexOf(a.side) - wideSides.indexOf(b.side) ||
    (a.side === 'bottom' ? a.rect.x - b.rect.x : a.rect.y - b.rect.y),
  );
  return { markers, cards };
}

export function interpolateWorksMapLayout<T extends MapPhoto>(
  start: WorksMapLayout<T>, target: WorksMapLayout<T>, current: WorksMapLayout<T>,
  circle: ReturnType<typeof worksMapVisibleCircle>, progress: number,
): WorksMapLayout<T> {
  const fromCards = start.cards;
  const toCards = target.cards;
  if (fromCards.length !== toCards.length ||
    fromCards.some((card, index) => card.regionId !== toCards[index].regionId || card.side !== toCards[index].side)) return current;

  // Same-side cards in the same order can move between layouts without crossing the globe or each other.
  const fraction = clamp(progress, 0, 1);
  const mix = (from: number, to: number) => from + (to - from) * fraction;
  const mixRect = (from: MapRect, to: MapRect) => ({
    x: mix(from.x, to.x), y: mix(from.y, to.y), width: mix(from.width, to.width), height: mix(from.height, to.height),
  });
  const startMarkers = new Map(start.markers.map(marker => [marker.group.id, marker]));
  const targetMarkers = new Map(target.markers.map(marker => [marker.group.id, marker]));
  const markers = current.markers.map(marker => {
    const from = startMarkers.get(marker.group.id);
    const to = targetMarkers.get(marker.group.id);
    if (!from || !to) return marker;
    const button = {
      x: marker.point.x + mix(from.button.x - from.point.x, to.button.x - to.point.x),
      y: marker.point.y + mix(from.button.y - from.point.y, to.button.y - to.point.y),
    };
    if (distance(button, circle.center) > circle.radius) return marker;
    return { ...marker, button: button.x === marker.point.x && button.y === marker.point.y ? marker.point : button };
  });
  const markerFor = new Map(markers.map(marker => [marker.group.id, marker]));
  const placed: CardPlacement<T>[] = [];
  for (const [index, from] of fromCards.entries()) {
    const marker = markerFor.get(from.regionId);
    if (!marker) return current;
    const rect = mixRect(from.rect, toCards[index].rect);
    const captionRect = mixRect(from.captionRect, toCards[index].captionRect);
    const to = from.side === 'bottom' ? { x: rect.x + rect.width / 2, y: rect.y }
      : { x: from.side === 'left' ? right(rect) : rect.x, y: rect.y + rect.height / 2 };
    const line = { from: marker.button, to };
    const card = { ...from, rect, captionRect, line };
    const bounds = { ...captionRect, y: rect.y, height: rect.height + captionRect.height };
    const placement = { card, bounds, score: 0 };
    if (placed.some(existing => placementConflicts(placement, existing)) || !lineClearsMarkers(line, markers, from.regionId)) return current;
    placed.push(placement);
  }
  return { markers, cards: placed.map(({ card }) => card) };
}
