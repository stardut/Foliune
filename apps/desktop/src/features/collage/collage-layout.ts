import type { Photo } from '../../lib/types';
import { isLocalPhoto } from '../../lib/photo-availability.ts';

export type CollageMode = 'adaptive' | 'grid' | 'long';
export type CollageFrame = 'auto' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3';
export interface PhotoCrop { fit: 'contain' | 'cover'; offsetX: number; offsetY: number; zoom: number }
export interface CollageState {
  photoIds: string[]; mode: CollageMode; frame: CollageFrame; gap: number; margin: number;
  background: string; crops: Record<string, PhotoCrop>;
}
export interface CollageRect { photoId: string; x: number; y: number; width: number; height: number }
export interface CollageLayout { width: number; height: number; items: CollageRect[] }
const BASE = 2400;
export const COLLAGE_MAX_PHOTOS = 100;
export const COLLAGE_MAX_EDGE = 32768;
export const COLLAGE_MAX_PIXELS = 160000000;
export const centeredCrop: PhotoCrop = { fit: 'cover', offsetX: .5, offsetY: .5, zoom: 1 };
export function initialCollage(photoIds: string[]): CollageState {
  return { photoIds: [...new Set(photoIds)], mode: 'adaptive', frame: 'auto', gap: 18, margin: 48, background: '#FFFFFF', crops: {} };
}
export function cropFor(state: CollageState, id: string): PhotoCrop {
  return state.mode === 'grid' ? state.crops[id] || centeredCrop : { ...centeredCrop, fit: 'contain' };
}
function ratio(photo: Pick<Photo, 'width' | 'height'>) { return Math.max(1, photo.width) / Math.max(1, photo.height); }
function frameRatio(frame: CollageFrame) { const [w, h] = frame.split(':').map(Number); return w / h; }

// Dynamic row partitioning preserves business order, while balancing visual row heights.
function adaptiveRows(photos: Photo[], width: number, gap: number): Photo[][] {
  const target = width / Math.max(1.5, Math.sqrt(photos.length * 1.3));
  const costs = Array(photos.length + 1).fill(Infinity) as number[];
  const previous = Array(photos.length + 1).fill(0) as number[];
  costs[0] = 0;
  for (let end = 1; end <= photos.length; end++) {
    let aspects = 0;
    for (let start = end - 1; start >= Math.max(0, end - 8); start--) {
      aspects += ratio(photos[start]);
      const height = (width - gap * (end - start - 1)) / aspects;
      const cost = costs[start] + (Math.log(Math.max(1, height) / target) ** 2) * (end - start);
      if (cost < costs[end]) { costs[end] = cost; previous[end] = start; }
    }
  }
  const rows: Photo[][] = [];
  for (let end = photos.length; end > 0;) { const start = previous[end]; rows.unshift(photos.slice(start, end)); end = start; }
  return rows;
}

// Layout controls use reference units; changing output resolution never changes the design.
export function collageReferenceLayout(state: CollageState, allPhotos: Photo[]): CollageLayout {
  const byId = new Map(allPhotos.map((photo) => [photo.id, photo]));
  const photos = state.photoIds.map((id) => byId.get(id)).filter((photo): photo is Photo => !!photo);
  if (!photos.length) return { width: BASE, height: BASE, items: [] };
  const margin = state.margin, gap = state.gap, available = BASE - 2 * margin;
  let height: number;
  const items: CollageRect[] = [];
  if (state.mode === 'grid') {
    const aspect = state.frame === 'auto' ? 1 : frameRatio(state.frame);
    height = BASE / aspect;
    const columns = Math.max(1, Math.ceil(Math.sqrt(photos.length * aspect)));
    const rows = Math.ceil(photos.length / columns);
    const cellHeight = (height - 2 * margin - gap * (rows - 1)) / rows;
    photos.forEach((photo, index) => {
      const row = Math.floor(index / columns);
      const count = Math.min(columns, photos.length - row * columns);
      const cellWidth = (available - gap * (count - 1)) / count;
      items.push({ photoId: photo.id, x: margin + (index % columns) * (cellWidth + gap), y: margin + row * (cellHeight + gap), width: cellWidth, height: cellHeight });
    });
  } else {
    const rows = state.mode === 'long' ? photos.map((photo) => [photo]) : adaptiveRows(photos, available, gap);
    let y = margin;
    for (const row of rows) {
      const rowHeight = (available - gap * (row.length - 1)) / row.reduce((sum, photo) => sum + ratio(photo), 0);
      let x = margin;
      for (const photo of row) {
        const width = rowHeight * ratio(photo);
        items.push({ photoId: photo.id, x, y, width, height: rowHeight });
        x += width + gap;
      }
      y += rowHeight + gap;
    }
    height = y - gap + margin;
    if (state.frame !== 'auto') {
      const targetHeight = BASE / frameRatio(state.frame);
      const factor = Math.min(1, (targetHeight - 2 * margin) / (height - 2 * margin));
      const offsetX = (BASE - available * factor) / 2;
      const offsetY = (targetHeight - (height - 2 * margin) * factor) / 2;
      items.forEach((item) => { item.x = offsetX + (item.x - margin) * factor; item.y = offsetY + (item.y - margin) * factor; item.width *= factor; item.height *= factor; });
      height = targetHeight;
    }
  }
  return { width: BASE, height, items };
}

export function collageLayout(state: CollageState, allPhotos: Photo[]): CollageLayout {
  const reference = collageReferenceLayout(state, allPhotos);
  const byId = new Map(allPhotos.map((photo) => [photo.id, photo]));
  // Preserve the effective source pixels of every photo (the visible region for
  // cover). A smaller source may be enlarged; it must not shrink other photos.
  let scale = 0;
  reference.items.forEach((item) => {
    const photo = byId.get(item.photoId)!;
    const crop = cropFor(state, item.photoId);
    const sourceScale = crop.fit === 'cover' ? Math.max(item.width / photo.width, item.height / photo.height) * crop.zoom : Math.min(item.width / photo.width, item.height / photo.height);
    scale = Math.max(scale, 1 / sourceScale);
  });
  if (!reference.items.length) return reference;
  // One reference pixel of headroom prevents boundary rounding from reducing
  // the most demanding image below its native sampling resolution.
  scale += Math.max(...reference.items.map((item) => 1 / Math.min(item.width, item.height)));
  const width = Math.max(1, Math.ceil(reference.width * scale));
  const height = Math.max(1, Math.ceil(reference.height * scale));
  return { width, height, items: reference.items.map((item) => {
    const x = Math.max(0, Math.round(item.x * scale));
    const y = Math.max(0, Math.round(item.y * scale));
    return { photoId: item.photoId, x, y, width: Math.min(width - x, Math.round((item.x + item.width) * scale) - x), height: Math.min(height - y, Math.round((item.y + item.height) * scale) - y) };
  }) };
}

export function collageOutputProblem(layout: CollageLayout): string {
  if (![layout.width, layout.height].every((value) => Number.isSafeInteger(value) && value > 0)) return '请输入有效像素尺寸';
  if (layout.width > COLLAGE_MAX_EDGE || layout.height > COLLAGE_MAX_EDGE || layout.width * layout.height > COLLAGE_MAX_PIXELS) return '单边最多 32,768 px，总像素最多 1.6 亿；请调整布局、选片或输出尺寸';
  if (layout.items.some((item) => item.width < 1 || item.height < 1)) return '当前尺寸过小，请增加输出尺寸';
  return '';
}

export function collageProblem(state: CollageState, photos: Photo[], layout: CollageLayout): string {
  if (state.photoIds.length < 2) return '至少选择 2 张照片';
  if (state.photoIds.length > COLLAGE_MAX_PHOTOS) return `拼图最多支持 ${COLLAGE_MAX_PHOTOS} 张照片`;
  if (layout.items.length !== state.photoIds.length) return '部分照片记录缺失，请重新选片';
  const missing = state.photoIds.map((id) => photos.find((photo) => photo.id === id)).filter((photo) => !photo?.originalAvailable);
  if (missing.some(isLocalPhoto)) return '部分照片找不到源文件';
  if (missing.length) return '请先重新定位缺失的原图';
  if (layout.items.some((item) => item.width < 1 || item.height < 1 || item.x + item.width > layout.width || item.y + item.height > layout.height)) return '照片比例差异过大，请调整布局或选片';
  return '';
}

export function movePhoto(ids: string[], id: string, target: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0 || target < 0 || target >= ids.length || from === target) return ids;
  const next = [...ids]; next.splice(from, 1); next.splice(target, 0, id); return next;
}
export interface History<T> { past: T[]; present: T; future: T[] }
export function recordHistory<T>(history: History<T>, value: T): History<T> {
  if (JSON.stringify(history.present) === JSON.stringify(value)) return history;
  return { past: [...history.past.slice(-79), history.present], present: value, future: [] };
}
export function undoHistory<T>(history: History<T>): History<T> {
  if (!history.past.length) return history;
  return { past: history.past.slice(0, -1), present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
}
export function redoHistory<T>(history: History<T>): History<T> {
  if (!history.future.length) return history;
  return { past: [...history.past, history.present], present: history.future[0], future: history.future.slice(1) };
}

export function resizeCollage(layout: CollageLayout, longEdge: number): CollageLayout {
  const scale = longEdge / Math.max(layout.width, layout.height);
  const width = Math.max(1, Math.round(layout.width * scale)), height = Math.max(1, Math.round(layout.height * scale));
  return { width, height, items: layout.items.map((item) => {
    const x = Math.round(item.x * scale), y = Math.round(item.y * scale);
    return { photoId: item.photoId, x, y, width: Math.round((item.x + item.width) * scale) - x, height: Math.round((item.y + item.height) * scale) - y };
  }) };
}
