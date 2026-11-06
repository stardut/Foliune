import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { isLocalPhoto } from './photo-availability';
import type { AlbumCover, GroupInput, GroupPatch, ImportResult, LibraryKind, LibrarySnapshot, MembershipStatus, Photo, PhotoMetadata, PhotoPatch } from './types';

export const isDesktop = () => isTauri();

export function withPhotoUrls(photo: Photo): Photo {
  const originalUrl = isLocalPhoto(photo)
    ? convertFileSrc(photo.id, 'work-photo')
    : photo.originalPath.startsWith('work-photo:')
      ? convertFileSrc(photo.originalPath.slice('work-photo:'.length), 'work-photo')
      : convertFileSrc(photo.originalPath);
  return { ...photo,
    originalUrl,
    thumbnailUrl: convertFileSrc(photo.thumbnailPath),
  };
}

export function withImageUrls(snapshot: LibrarySnapshot): LibrarySnapshot {
  return { ...snapshot, photos: snapshot.photos.map(withPhotoUrls) };
}

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) throw new Error('请在 Foliune 桌面应用中使用本地图库功能。');
  try { return await invoke<T>(command, args); }
  catch (error) { throw new Error(typeof error === 'string' ? error : String(error)); }
}

export { prepareImport, prepareImportFiles, prepareGroupCuration, commitCuration, cancelCuration } from './curation-api';

async function mutate(command: string, args: Record<string, unknown>): Promise<LibrarySnapshot> {
  return withImageUrls(await call<LibrarySnapshot>(command, args));
}

export async function loadSnapshot(): Promise<LibrarySnapshot> {
  return withImageUrls(await call<LibrarySnapshot>('load_snapshot'));
}

export async function importPhotoFiles(paths: string[], library: LibraryKind, groupId?: string): Promise<ImportResult> {
  const result = await call<ImportResult>('import_photos', { paths, library, groupId: groupId ?? null });
  return { ...result, snapshot: withImageUrls(result.snapshot) };
}

export async function importPhotos(library: LibraryKind, groupId?: string): Promise<ImportResult | null> {
  if (!isDesktop()) throw new Error('请在 Foliune 桌面应用中导入照片。');
  const paths = await open({ multiple: true, directory: false, title: '导入照片',
    filters: [{ name: '照片（JPEG / PNG / WebP）', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  if (!paths || paths.length === 0) return null;
  return importPhotoFiles(Array.isArray(paths) ? paths : [paths], library, groupId);
}

export const createGroup = (input: GroupInput) => mutate('create_group', { input });
export const updateGroup = (id: string, patch: GroupPatch) => mutate('update_group', { id, patch });
export async function readAlbumCover(groupId: string, photoId: string, expectedOriginalPath: string, expectedThumbnailPath: string, expectedCover: AlbumCover | null): Promise<ArrayBuffer> {
  const bytes = await call<ArrayBuffer | number[]>('read_album_cover', { groupId, photoId, expectedOriginalPath, expectedThumbnailPath, expectedCover });
  // Tauri's macOS postMessage transport serializes raw IPC responses as arrays.
  return Array.isArray(bytes) ? Uint8Array.from(bytes).buffer : bytes;
}
export const deleteGroup = (id: string) => mutate('delete_group', { id });
export const shareAlbumAirDrop = (groupId: string, photoIds?: string[]) =>
  call<void>('share_album_airdrop', { groupId, photoIds: photoIds ?? null });
export const updatePhoto = (id: string, patch: PhotoPatch) => mutate('update_photo', { id, patch });
export const readPhotoMetadata = (photoId: string, expectedOriginalPath: string) =>
  call<PhotoMetadata>('read_photo_metadata', { photoId, expectedOriginalPath });
export const addPhotosToGroup = (groupId: string, photoIds: string[]) => mutate('add_photos_to_group', { groupId, photoIds });
export const setMembershipStatus = (groupId: string, photoId: string, status: MembershipStatus) =>
  setMembershipStatuses(groupId, [photoId], status);
export const setMembershipStatuses = (groupId: string, photoIds: string[], status: MembershipStatus) =>
  mutate('set_membership_statuses', { groupId, photoIds, status });

export async function relinkPhoto(photoId: string, confirm: (path: string) => Promise<boolean>): Promise<LibrarySnapshot | null> {
  if (!isDesktop()) throw new Error('请在 Foliune 桌面应用中重新定位照片。');
  const path = await open({ multiple: false, directory: false, title: '重新定位照片',
    filters: [{ name: '照片（JPEG / PNG / WebP）', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  });
  if (!path) return null;
  if (!await confirm(path)) return null;
  return mutate('relink_photo', { photoId, path });
}
