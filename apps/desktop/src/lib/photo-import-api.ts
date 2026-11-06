import { call, withImageUrls } from './api';
import type { CurationDraft } from './curation-types';
import type { LibraryKind } from './types';

export async function prepareLinkImport(input: string, library: LibraryKind, groupId: string | undefined, requestId: string): Promise<CurationDraft> {
  const draft = await call<CurationDraft>('prepare_link_import', { input, library, groupId: groupId ?? null, requestId });
  return { ...draft, candidates: withImageUrls({ photos: draft.candidates, groups: [], memberships: [] }).photos };
}

export async function cancelLinkImport(requestId: string): Promise<void> {
  return call<void>('cancel_link_import', { requestId });
}
