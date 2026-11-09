import type { LibrarySnapshot, Photo } from '../../lib/types';
import type { ModelProfile } from '../../lib/model-types';

export interface ModelWorkspaceProps {
  snapshot: LibrarySnapshot;
  photos: Photo[];
  onSnapshot: (snapshot: LibrarySnapshot) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  onRelink?: (photo: Photo) => Promise<void>;
}

export type ModelView =
  | { page: 'home' }
  | { page: 'detail'; model: ModelProfile }
  | { page: 'edit'; model?: ModelProfile };

type ModelNavigation =
  | { type: 'open' | 'saved'; model: ModelProfile }
  | { type: 'new' | 'edit' | 'back' | 'deleted' };

export function modelViewReducer(view: ModelView, action: ModelNavigation): ModelView {
  switch (action.type) {
    case 'open':
    case 'saved': return { page: 'detail', model: action.model };
    case 'new': return { page: 'edit' };
    case 'edit': return view.page === 'detail' ? { page: 'edit', model: view.model } : view;
    case 'back': return view.page === 'edit' && view.model ? { page: 'detail', model: view.model } : { page: 'home' };
    case 'deleted': return { page: 'home' };
  }
}

export function overviewSamples(model: ModelProfile, photos: ReadonlyMap<string, Photo>): Photo[] {
  const available = [...new Set(model.photoIds)].flatMap((id) => {
    const photo = photos.get(id);
    return photo ? [photo] : [];
  });
  // Square photographs share the landscape group. The cover chooses a group,
  // never a new position within the model's saved sample order.
  const portraits = available.filter((photo) => photo.width < photo.height);
  const landscapes = available.filter((photo) => photo.width >= photo.height);
  const completeGroups = [portraits, landscapes].filter((group) => group.length >= 3);
  if (completeGroups.length) {
    const group = completeGroups.find((items) => items.some((photo) => photo.id === model.coverPhotoId))
      ?? completeGroups.find((items) => items.includes(available[0]))
      ?? completeGroups[0];
    return group.slice(0, 3);
  }
  const selected = available.slice(0, 3);
  return [...selected.filter((photo) => photo.width < photo.height), ...selected.filter((photo) => photo.width >= photo.height)];
}

export const overviewSampleHeight = 120;

/** Equal-height, full-frame samples fitted to the measured right-hand column. */
export function overviewSampleLayout(samples: Photo[], width: number) {
  if (!samples.length) return { height: 0, gap: 0, groupGap: 0, widths: [] };
  const availableWidth = Math.max(0, width);
  const gap = Math.min(10, availableWidth / (samples.length * 3));
  const mixed = samples.some((photo) => photo.width < photo.height) && samples.some((photo) => photo.width >= photo.height);
  const groupGap = gap * 2;
  const spaces = gap * (samples.length - 1) + (mixed ? groupGap - gap : 0);
  const ratios = samples.map((photo) => photo.width / photo.height);
  const height = Math.min(overviewSampleHeight, Math.max(0, availableWidth - spaces) / ratios.reduce((sum, ratio) => sum + ratio, 0));
  return { height, gap, groupGap, widths: ratios.map((ratio) => ratio * height) };
}
