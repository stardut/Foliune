import type { Photo } from '../lib/types';

export const EXHIBITION_GAP = 4;
export interface ExhibitionTile { index: number; x: number; y: number; width: number; height: number }
export interface ExhibitionBlock { start: number; height: number; tiles: ExhibitionTile[] }

// Every slicing subtree obeys width = a * height + b, including its gutters.
// Both horizontal and vertical joins therefore retain every source aspect ratio.
interface Slice { a: number; b: number; index?: number; axis?: 'across' | 'down'; first?: Slice; second?: Slice }
const MAX_BLOCK_PHOTOS = 6;

function join(first: Slice, second: Slice, axis: 'across' | 'down'): Slice {
  if (axis === 'across') return { a: first.a + second.a, b: first.b + second.b + EXHIBITION_GAP, axis, first, second };
  const a = 1 / (1 / first.a + 1 / second.a);
  return { a, b: a * (first.b / first.a + second.b / second.a - EXHIBITION_GAP), axis, first, second };
}

function place(tree: Slice, width: number, x = 0, y = 0, tiles: ExhibitionTile[] = []): ExhibitionTile[] | null {
  const height = (width - tree.b) / tree.a;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (tree.index !== undefined) {
    tiles.push({ index: tree.index, x, y, width, height });
    return tiles;
  }
  const { first, second } = tree;
  if (!first || !second) return null;
  if (tree.axis === 'across') {
    const leftWidth = first.a * height + first.b;
    if (!place(first, leftWidth, x, y, tiles)) return null;
    return place(second, width - leftWidth - EXHIBITION_GAP, x + leftWidth + EXHIBITION_GAP, y, tiles);
  }
  const firstHeight = (width - first.b) / first.a;
  if (!place(first, width, x, y, tiles)) return null;
  return place(second, width, x, y + firstHeight + EXHIBITION_GAP, tiles);
}

function score(tiles: ExhibitionTile[], width: number, height: number, viewportHeight: number): number {
  const targetEdge = Math.min(300, Math.max(150, width / 4));
  const minEdge = Math.min(110, width / 4);
  const maxHeight = Math.max(320, Math.min(680, viewportHeight * .76));
  let cost = 0;
  for (const tile of tiles) {
    cost += Math.log(tile.width * tile.height / (targetEdge * targetEdge)) ** 2;
    cost += 5 * Math.max(0, minEdge / Math.min(tile.width, tile.height) - 1) ** 2;
    cost += 8 * Math.max(0, tile.height / maxHeight - 1) ** 2;
    cost += 3 * Math.max(0, tile.width / (width * .72) - 1) ** 2;
  }
  // Prefer a spanning photograph beside a nested stack over repeated equal rows.
  const spanning = tiles.some((tile) => tiles.some((other) =>
    Math.abs(tile.height - other.height) > 12 && other.y > tile.y + 1 && other.y < tile.y + tile.height - 1));
  if (tiles.length >= 3 && !spanning) cost += tiles.length * 1.8;
  if (tiles.length < 3) cost += (3 - tiles.length) * 2;
  cost += tiles.length * .3 * Math.log(height / Math.min(540, Math.max(260, viewportHeight * .6))) ** 2;
  return cost;
}

function browsingWidth(ratio: number, viewportHeight: number) {
  return Math.min(480, Math.min(360, viewportHeight * .5) * ratio);
}

export function exhibitionLayout(photos: Pick<Photo, 'width' | 'height'>[], width: number, viewportHeight: number, compactPair = false): ExhibitionBlock[] {
  if (!photos.length || !Number.isFinite(width) || width <= 0) return [];
  const ratios = photos.map(({ width: w, height: h }) => Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : 1);
  // A lone photograph is a browsing entry, not a full-width mosaic block.
  if (photos.length === 1) {
    const photoWidth = Math.min(width, browsingWidth(ratios[0], viewportHeight));
    const height = photoWidth / ratios[0];
    return [{ start: 0, height, tiles: [{ index: 0, x: 0, y: 0, width: photoWidth, height }] }];
  }
  if (compactPair && photos.length === 2) {
    const gap = Math.min(EXHIBITION_GAP, width / 2);
    const widths = ratios.map((ratio) => browsingWidth(ratio, viewportHeight));
    const scale = Math.min(1, (width - gap) / (widths[0] + widths[1]));
    const tiles = widths.map((photoWidth, index) => ({
      index, x: index === 0 ? 0 : widths[0] * scale + gap, y: 0,
      width: photoWidth * scale, height: photoWidth * scale / ratios[index],
    }));
    return [{ start: 0, height: Math.max(...tiles.map((tile) => tile.height)), tiles }];
  }
  const spans = new Map<string, Slice[]>();
  function candidates(start: number, count: number): Slice[] {
    const key = `${start}:${count}`;
    const cached = spans.get(key);
    if (cached) return cached;
    const result: Slice[] = [];
    if (count === 1) result.push({ a: ratios[start], b: 0, index: start });
    else for (let split = 1; split < count; split++) {
      for (const first of candidates(start, split)) for (const second of candidates(start + split, count - split)) {
        result.push(join(first, second, 'across'), join(first, second, 'down'));
      }
    }
    spans.set(key, result);
    return result;
  }
  // Contiguous spans only: at most C(5)*2^5 = 1344 trees per six-photo span.
  // Each span is generated once, without permutations. The wall stays in business
  // order; only the geometric partition and the block boundaries change.
  const costs = Array<number>(photos.length + 1).fill(Infinity);
  const choices = new Map<number, ExhibitionBlock>();
  costs[photos.length] = 0;
  for (let start = photos.length - 1; start >= 0; start--) {
    for (let count = 1; count <= Math.min(MAX_BLOCK_PHOTOS, photos.length - start); count++) {
      for (const tree of candidates(start, count)) {
        const height = (width - tree.b) / tree.a;
        const tiles = place(tree, width);
        if (!tiles) continue;
        const cost = score(tiles, width, height, viewportHeight) + costs[start + count];
        if (cost < costs[start]) {
          costs[start] = cost;
          choices.set(start, { start, height, tiles });
        }
      }
    }
    // The next start can only reach five photos ahead. Drop older map roots;
    // chosen tiles contain no tree references, so large walls keep bounded
    // candidate memory without changing any score or partition decision.
    for (let count = 1; count <= MAX_BLOCK_PHOTOS; count++) spans.delete(`${start + MAX_BLOCK_PHOTOS - 1}:${count}`);
  }
  const blocks: ExhibitionBlock[] = [];
  for (let start = 0; start < photos.length;) {
    const block = choices.get(start);
    if (!block) throw new Error('无法按照片比例生成展览布局');
    blocks.push(block);
    start += block.tiles.length;
  }
  return blocks;
}
