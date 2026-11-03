import type { Photo } from './types';

export interface CurationDraft {
  id: string;
  groupId: string | null;
  groupName: string;
  capacity: number | null;
  candidates: Photo[];
  activeIds: string[];
  pendingIds: string[];
  failures: { path: string; message: string }[];
}

export interface GroupCurationPatch {
  photoIds?: string[];
  name?: string;
  description?: string;
  capacity?: number | null;
}
