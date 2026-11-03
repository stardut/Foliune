import { call, withImageUrls } from './api';
import type { CollageInput } from './collage-types';
import type { CurationDraft } from './curation-types';

export async function prepareCollage(input: CollageInput): Promise<CurationDraft> {
  const draft = await call<CurationDraft>('prepare_collage', { input });
  return {
    ...draft,
    candidates: withImageUrls({ photos: draft.candidates, groups: [], memberships: [] }).photos,
  };
}
