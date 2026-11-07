import type { CSSProperties } from 'react';
import type { AlbumCover, Photo } from '../lib/types';

export function albumCoverRevision(photo: Photo, cover?: AlbumCover | null) {
  return JSON.stringify([photo.id, photo.originalPath, photo.thumbnailPath, photo.originalAvailable, photo.thumbnailAvailable,
    photo.availability, cover?.offsetX, cover?.offsetY, cover?.zoom]);
}

export function albumCoverStyle(cover: AlbumCover): CSSProperties {
  const { offsetX, offsetY, zoom } = cover;
  // Position the enlarged image box and the pixels inside it with the same
  // fractions, so each offset spans the full overflow at any zoom level.
  return {
    '--album-cover-size': `${zoom * 100}%`,
    '--album-cover-left': `${(1 - zoom) * offsetX * 100}%`,
    '--album-cover-top': `${(1 - zoom) * offsetY * 100}%`,
    '--album-cover-position': `${offsetX * 100}% ${offsetY * 100}%`,
  } as CSSProperties;
}

function shiftOffset(offset: number, delta: number, overflow: number) {
  return overflow > .01 && delta ? Math.max(0, Math.min(1, offset - delta / overflow)) : offset;
}

export function shiftAlbumCover(cover: AlbumCover, photo: Pick<Photo, 'width' | 'height'>, frame: Pick<DOMRect, 'width' | 'height'>, dx: number, dy: number): AlbumCover {
  const scale = Math.max(frame.width / photo.width, frame.height / photo.height) * cover.zoom;
  return {
    ...cover,
    offsetX: shiftOffset(cover.offsetX, dx, photo.width * scale - frame.width),
    offsetY: shiftOffset(cover.offsetY, dy, photo.height * scale - frame.height),
  };
}

/** Render the complete source around the crop; ordinary cards still use albumCoverStyle. */
export function albumCoverStageStyle(cover: AlbumCover, photo: Pick<Photo, 'width' | 'height'>): CSSProperties {
  const ratio = photo.width / photo.height;
  const width = Math.max(1, ratio / 1.5) * cover.zoom;
  const height = Math.max(1, 1.5 / ratio) * cover.zoom;
  return {
    ...albumCoverStyle(cover),
    '--album-stage-width': `${width * 100}%`,
    '--album-stage-height': `${height * 100}%`,
    '--album-stage-left': `${(1 - width) * cover.offsetX * 100}%`,
    '--album-stage-top': `${(1 - height) * cover.offsetY * 100}%`,
  } as CSSProperties;
}

export function resetAlbumCover(photoId: string): AlbumCover {
  return { photoId, offsetX: .5, offsetY: .5, zoom: 1 };
}

/** Keep the same source point at the crop center, until an image edge constrains it. */
export function zoomAlbumCover(cover: AlbumCover, photo: Pick<Photo, 'width' | 'height'>, zoom: number): AlbumCover {
  const nextZoom = Math.max(1, Math.min(3, zoom));
  if (nextZoom === cover.zoom) return cover;
  const ratio = photo.width / photo.height;
  const offset = (value: number, baseSize: number) => {
    const before = baseSize * cover.zoom;
    const after = baseSize * nextZoom;
    if (after <= 1) return .5;
    const sourceCenter = (.5 + (before - 1) * value) / before;
    return Math.max(0, Math.min(1, (sourceCenter * after - .5) / (after - 1)));
  };
  return { ...cover, zoom: nextZoom,
    offsetX: offset(cover.offsetX, Math.max(1, ratio / 1.5)),
    offsetY: offset(cover.offsetY, Math.max(1, 1.5 / ratio)),
  };
}
