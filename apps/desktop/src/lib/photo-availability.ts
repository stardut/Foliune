import type { Photo } from './types';

const LOCAL_PHOTO_PREFIX = 'local-photo:';

export function isLocalPhoto(photo?: Pick<Photo, 'originalPath'>) {
  return photo?.originalPath?.startsWith(LOCAL_PHOTO_PREFIX) ?? false;
}

export function displayOriginalPath(photo: Pick<Photo, 'originalPath'>) {
  return isLocalPhoto(photo) ? photo.originalPath.slice(LOCAL_PHOTO_PREFIX.length) : photo.originalPath;
}

// Source files can return to their recorded path after the snapshot was taken.
export function canReadOriginal(photo: Photo) {
  return isLocalPhoto(photo) ? displayOriginalPath(photo) !== '' : photo.originalAvailable;
}

export function originalReadUrl(photo: Photo, session: string) {
  // WKWebView may reuse a decoded image even with a no-store response.
  return isLocalPhoto(photo) && photo.originalUrl !== photo.thumbnailUrl
    ? `${photo.originalUrl}?read=${session}`
    : photo.originalUrl;
}

export function photoUnavailableLabel(photo?: Photo) {
  if (photo?.availability === 'offline') return '作品目录离线';
  if (isLocalPhoto(photo)) return '找不到源文件';
  return photo?.originalAvailable ? '图片无法读取' : '原图文件缺失';
}
