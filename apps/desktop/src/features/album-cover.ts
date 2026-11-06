import type { CSSProperties } from 'react';
import type { AlbumCover, Photo } from '../lib/types';

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
