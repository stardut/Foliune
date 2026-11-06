import type { LibrarySnapshot } from '../lib/types';
import type { WorkDirectoryCommit } from '../lib/work-directory-api';

export interface LibraryView {
  snapshot: LibrarySnapshot;
  pendingCommits: WorkDirectoryCommit[];
  observedPhotos: string[];
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function appendCommit(snapshot: LibrarySnapshot, commit: WorkDirectoryCommit, photoIds: ReadonlySet<string>): LibrarySnapshot {
  const { album, createdAlbum } = commit;
  const groupExists = snapshot.groups.some((group) => group.id === album.id);
  const members = groupExists || createdAlbum
    ? commit.memberships.filter((membership) => !photoIds.has(membership.photoId))
    : [];
  // Keep the same ordering as SQLite snapshots, including picker and search photos.
  return {
    ...snapshot,
    photos: [...snapshot.photos, ...commit.photos.filter((photo) => !photoIds.has(photo.id))]
      .sort((a, b) => compareText(b.importedAt, a.importedAt) || compareText(a.id, b.id)),
    groups: createdAlbum && !groupExists
      ? [...snapshot.groups, album].sort((a, b) => compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id))
      : snapshot.groups,
    memberships: members.length
      ? [...snapshot.memberships, ...members].sort((a, b) => compareText(a.groupId, b.groupId) || a.position - b.position)
      : snapshot.memberships,
  };
}

export function recordDirectoryCommit(view: LibraryView, commit: WorkDirectoryCommit): LibraryView {
  const marker = commit.photos[0]?.id;
  if (!marker || view.snapshot.hiddenPhotoIds?.includes(marker)
    || view.observedPhotos.includes(marker) || view.pendingCommits.some((item) => item.jobId === commit.jobId)) return view;
  const photoIds = new Set(view.snapshot.photos.map((photo) => photo.id));
  if (photoIds.has(marker)) return { ...view, observedPhotos: [...view.observedPhotos, marker] };
  return {
    ...view,
    snapshot: appendCommit(view.snapshot, commit, photoIds),
    pendingCommits: [...view.pendingCommits, commit],
  };
}

export function replaceLibrarySnapshot(view: LibraryView, snapshot: LibrarySnapshot): LibraryView {
  const hiddenIds = new Set(snapshot.hiddenPhotoIds);
  if (view.snapshot.hiddenPhotoIds?.some((id) => !hiddenIds.has(id))) return view;
  if (!view.pendingCommits.length && !view.observedPhotos.length) return { ...view, snapshot };
  const photoIds = new Set(snapshot.photos.map((photo) => photo.id));
  for (const id of hiddenIds) photoIds.add(id);
  // A hidden photo still proves that the snapshot includes its sync commit.
  if (view.observedPhotos.some((id) => !photoIds.has(id))) return view;
  const observedPhotos = [...view.observedPhotos];
  const pendingCommits = view.pendingCommits.filter((commit) => {
    const marker = commit.photos[0].id;
    if (!photoIds.has(marker)) return true;
    observedPhotos.push(marker);
    return false;
  });
  return { snapshot: pendingCommits.reduce((next, commit) => appendCommit(next, commit, photoIds), snapshot), pendingCommits, observedPhotos };
}

export function mergeWorkDirectoryAvailability(current: LibrarySnapshot, fresh: LibrarySnapshot): LibrarySnapshot {
  const external = new Map(fresh.photos.filter((photo) => photo.availability).map((photo) => [photo.id, photo]));
  if (!external.size) return current;
  let changed = false;
  const photos = current.photos.map((photo) => {
    const next = external.get(photo.id);
    if (!next || !photo.availability || next.originalPath !== photo.originalPath
      || (photo.availability === next.availability && photo.originalAvailable === next.originalAvailable && photo.thumbnailAvailable === next.thumbnailAvailable)) return photo;
    changed = true;
    return { ...photo, availability: next.availability, originalAvailable: next.originalAvailable, thumbnailAvailable: next.thumbnailAvailable };
  });
  return changed ? { ...current, photos } : current;
}
