import { Channel } from '@tauri-apps/api/core';
import { call, isDesktop, withImageUrls, withPhotoUrls } from './api';
import type { CurationDraft } from './curation-types';
import type { LibraryKind, Photo } from './types';

interface LinkImportProgress { total: number; photo?: Photo | null }

export async function prepareLinkImport(input: string, library: LibraryKind, groupId: string | undefined, requestId: string,
  onProgress: (update: LinkImportProgress) => void): Promise<CurationDraft> {
  if (!isDesktop()) throw new Error('请在 Foliune 桌面应用中获取链接图片。');
  const progress = new Channel<LinkImportProgress>(({ total, photo }) => onProgress({ total, photo: photo ? withPhotoUrls(photo) : null }));
  const draft = await call<CurationDraft>('prepare_link_import', { input, library, groupId: groupId ?? null, requestId, progress });
  return { ...draft, candidates: withImageUrls({ photos: draft.candidates, groups: [], memberships: [] }).photos };
}

export async function cancelLinkImport(requestId: string): Promise<void> {
  return call<void>('cancel_link_import', { requestId });
}
