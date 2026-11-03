import type { Group, LibraryKind, LibrarySnapshot, Photo } from '../lib/types';

export interface LibraryAlbum {
  group: Group;
  photos: Photo[];
}

export function libraryAlbums(snapshot: LibrarySnapshot, library: LibraryKind) {
  const photos = snapshot.photos.filter((photo) => photo.library === library);
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  // A discarded membership still belongs to its album; it must not become ungrouped.
  const associated = new Set(snapshot.memberships.map((member) => member.photoId));
  const albums: LibraryAlbum[] = snapshot.groups.filter((group) => group.library === library).map((group) => {
    const ids = [...new Set(snapshot.memberships
      .filter((member) => member.groupId === group.id && member.status === 'active')
      .sort((a, b) => a.position - b.position)
      .map((member) => member.photoId))];
    return { group, photos: ids.map((id) => byId.get(id)).filter((photo): photo is Photo => !!photo) };
  });
  return { albums, ungrouped: photos.filter((photo) => !associated.has(photo.id)) };
}
