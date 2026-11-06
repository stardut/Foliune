import { exhibitionLayout, EXHIBITION_GAP, type ExhibitionTile } from './exhibition-layout';

export interface WallSection { heading?: string; photos: { width: number; height: number }[] }
export interface WallUnit {
  top: number;
  height: number;
  heading?: string;
  left: number;
  tiles: ExhibitionTile[];
}
export interface PhotoWallLayout { units: WallUnit[]; height: number }
export interface PhotoWallBatch extends PhotoWallLayout { complete: boolean }
export type PhotoWallResponse = PhotoWallBatch | { error: string };
export interface WallLayoutInput {
  sections: WallSection[];
  layout: 'exhibition' | 'grid';
  width: number;
  viewportHeight: number;
  bleed: number;
}

const FIRST_EXHIBITION_PHOTOS = 32;
const MAX_EXHIBITION_PHOTOS = 128;
const NEXT_EXHIBITION_BATCH = 96;

// Each batch appends exact coordinates. Earlier units never move as the wall grows.
export function* photoWallLayoutBatches({ sections, layout, width, viewportHeight, bleed }: WallLayoutInput): Generator<PhotoWallBatch> {
  let units: WallUnit[] = [];
  let top = 0;
  let offset = 0;
  const photoCount = sections.reduce((count, section) => count + section.photos.length, 0);
  let publishAt = photoCount > MAX_EXHIBITION_PHOTOS ? FIRST_EXHIBITION_PHOTOS : photoCount;
  for (const section of sections) {
    if (!section.photos.length) continue;
    if (top) top += 48;
    if (section.heading !== undefined) {
      units.push({ top, height: 28, heading: section.heading, left: 0, tiles: [] });
      top += 50;
    }
    if (layout === 'exhibition') {
      const sectionCount = section.photos.length;
      const left = sectionCount === 1 ? 0 : -bleed;
      // Preserve the original search for small sections. In a long section the
      // first segment is short, then the remaining photos are evenly divided.
      const firstCount = sectionCount <= MAX_EXHIBITION_PHOTOS ? sectionCount : FIRST_EXHIBITION_PHOTOS;
      let segmentsLeft = 1 + Math.ceil((sectionCount - firstCount) / MAX_EXHIBITION_PHOTOS);
      for (let start = 0; start < sectionCount; segmentsLeft--) {
        const count = start === 0 ? firstCount : Math.ceil((sectionCount - start) / segmentsLeft);
        const photos = count === sectionCount ? section.photos : section.photos.slice(start, start + count);
        const blocks = exhibitionLayout(photos, width - left * 2, viewportHeight);
        blocks.forEach((block, index) => {
          if (start || index) top += EXHIBITION_GAP;
          units.push({ top, height: block.height, left, tiles: block.tiles.map((tile) => ({ ...tile, index: tile.index + offset + start })) });
          top += block.height;
        });
        start += count;
        const placed = offset + start;
        if (blocks.length && placed >= publishAt && placed < photoCount) {
          yield { units, height: top, complete: false };
          units = [];
          publishAt = placed + NEXT_EXHIBITION_BATCH;
        }
      }
    } else {
      const columns = Math.max(1, Math.floor((width + 24) / (160 + 24)));
      const tileWidth = (width - (columns - 1) * 24) / columns;
      const height = Math.max(140, tileWidth / 1.2);
      for (let start = 0; start < section.photos.length; start += columns) {
        if (start) top += 28;
        units.push({ top, height, left: 0, tiles: section.photos.slice(start, start + columns).map((_, column) => ({
          index: offset + start + column, x: column * (tileWidth + 24), y: 0, width: tileWidth, height,
        })) });
        top += height;
      }
    }
    offset += section.photos.length;
  }
  yield { units, height: top, complete: true };
}

export function photoWallLayout(input: WallLayoutInput): PhotoWallLayout {
  const units: WallUnit[] = [];
  let height = 0;
  for (const batch of photoWallLayoutBatches(input)) {
    for (const unit of batch.units) units.push(unit);
    height = batch.height;
  }
  return { units, height };
}

// Units have monotonically increasing, non-overlapping vertical bounds.
export function visibleWallRange(units: WallUnit[], top: number, height: number, overscan: number): [number, number] {
  const lower = top - overscan;
  const upper = top + height + overscan;
  let left = 0;
  let right = units.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (units[middle].top + units[middle].height < lower) left = middle + 1;
    else right = middle;
  }
  const start = left;
  right = units.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (units[middle].top <= upper) left = middle + 1;
    else right = middle;
  }
  return [start, left];
}
