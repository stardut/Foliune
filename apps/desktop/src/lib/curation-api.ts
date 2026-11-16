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

export function chooseLocalPhotoSources(): Promise<string[]> {
  return call<string[]>('choose_local_photo_sources');
}

export async function prepareImportFiles(paths: string[], library: LibraryKind, groupId?: string): Promise<CurationDraft> {
  return draftImages(await call<CurationDraft>('prepare_import', { paths, library, groupId: groupId ?? null }), true);
}

export async function prepareGroupCuration(groupId: string, patch: GroupCurationPatch): Promise<CurationDraft> {
  return draftImages(await call<CurationDraft>('prepare_group_curation', { groupId, patch }));
}

export async function saveAlbumInfo(groupId: string, info: GroupInfoInput, expected: GroupInfoInput): Promise<GroupInfoResult> {
  const result = await call<GroupInfoResult>('save_album_info', { groupId, info, expected });
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
