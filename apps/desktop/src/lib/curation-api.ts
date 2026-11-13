import { open } from '@tauri-apps/plugin-dialog';
import { call, withImageUrls } from './api';
import { isLocalPhoto } from './photo-availability';
import type { LibraryKind, LibrarySnapshot } from './types';
import type { CurationDraft, GroupCurationPatch, GroupInfoInput, GroupInfoResult } from './curation-types';

function draftImages(draft: CurationDraft, localImport = false): CurationDraft {
  const photos = withImageUrls({ photos: draft.candidates, groups: [], memberships: [] }).photos;
  const pending = new Set(localImport ? draft.pendingIds : []);
  return { ...draft, candidates: photos.map((photo) => pending.has(photo.id) && isLocalPhoto(photo)
    ? { ...photo, originalUrl: photo.thumbnailUrl }
    : photo) };
}

export async function prepareImport(library: LibraryKind, groupId?: string, directory = false): Promise<CurationDraft | null> {
  const { isDesktop } = await import('./api');
  if (!isDesktop()) throw new Error('请在 Foliune 桌面应用中导入照片。');
  const paths = await open(directory
    ? { multiple: false, directory: true, title: '选择照片文件夹' }
    : { multiple: true, directory: false, title: '导入照片',
      filters: [{ name: '照片（JPEG / PNG / WebP）', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    });
  if (!paths || paths.length === 0) return null;
  return prepareImportFiles(Array.isArray(paths) ? paths : [paths], library, groupId);
}

export async function prepareImportFiles(paths: string[], library: LibraryKind, groupId?: string): Promise<CurationDraft> {
  return draftImages(await call<CurationDraft>('prepare_import', { paths, library, groupId: groupId ?? null }), true);
}

export async function prepareGroupCuration(groupId: string, patch: GroupCurationPatch): Promise<CurationDraft> {
  return draftImages(await call<CurationDraft>('prepare_group_curation', { groupId, patch }));
}

export async function saveAlbumInfo(groupId: string, info: GroupInfoInput): Promise<GroupInfoResult> {
  const result = await call<GroupInfoResult>('save_album_info', { groupId, info });
  return result.status === 'saved'
    ? { ...result, snapshot: withImageUrls(result.snapshot) }
    : { ...result, draft: draftImages(result.draft) };
}

export async function commitCuration(draftId: string, keepIds: string[]): Promise<LibrarySnapshot> {
  return withImageUrls(await call<LibrarySnapshot>('commit_curation', { draftId, keepIds }));
}

export async function cancelCuration(draftId: string): Promise<void> {
  return call<void>('cancel_curation', { draftId });
}
