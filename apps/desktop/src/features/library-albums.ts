import type { Group, LibraryKind, LibrarySnapshot, Membership, Photo } from '../lib/types';

export interface LibraryAlbum {
  group: Group;
  photos: Photo[];
}

export function libraryAlbums(snapshot: LibrarySnapshot, library: LibraryKind) {
  const photosById = new Map<string, Photo>();
  for (const photo of snapshot.photos) {
    if (photo.library === library) photosById.set(photo.id, photo);
  }
  const membersByGroup = new Map<string, { group: Group; members: Membership[] }>();
  for (const group of snapshot.groups) {
    if (group.library === library) membersByGroup.set(group.id, { group, members: [] });
  }
  for (const member of snapshot.memberships) {
    membersByGroup.get(member.groupId)?.members.push(member);
  }
  const albums = Array.from(membersByGroup.values(), ({ group, members }) => {
    const active = new Set<Photo>();
    const discarded = new Set<Photo>();
    for (const member of members.sort((a, b) => a.position - b.position)) {
      const photo = photosById.get(member.photoId);
      if (!photo) continue;
      if (member.status === 'active') active.add(photo);
      else if (member.status === 'discarded') discarded.add(photo);
    }
    return { group, photos: [...active], discardedPhotos: [...discarded] };
  });
  return { albums, byGroupId: new Map(albums.map((album) => [album.group.id, album])) };
}
