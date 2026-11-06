import type { Photo } from '../lib/types';
import type { LibraryAlbum } from './library-albums';

type WorkGrouping = 'location' | 'project';
export type WorkView = 'none' | WorkGrouping;
type TimeSort = 'time-asc' | 'time-desc';
export type AlbumSort = TimeSort | 'name-asc' | 'name-desc';
export type PhotoSort = AlbumSort | 'membership';

const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function sortLibraryAlbums(albums: LibraryAlbum[], sort: AlbumSort): LibraryAlbum[] {
  if (sort === 'name-asc') return [...albums].sort((a, b) => names.compare(a.group.name, b.group.name));
  if (sort === 'name-desc') return [...albums].sort((a, b) => names.compare(b.group.name, a.group.name));
  return sortByTime(albums.map((item) => ({ item, time: Date.parse(item.group.createdAt) })), sort);
}

export function sortAlbumPhotos(photos: Photo[], sort: PhotoSort): Photo[] {
  if (sort === 'membership') return photos;
  if (sort === 'name-asc') return [...photos].sort((a, b) => names.compare(a.originalName, b.originalName));
  if (sort === 'name-desc') return [...photos].sort((a, b) => names.compare(b.originalName, a.originalName));
  return sortByTime(photos.map((item) => ({ item, time: photoTime(item) })), sort);
}

type Timed<Item> = { item: Item; time: number };

// Group the complete result once. Rank each section by its newest photo in either direction.
export function workPhotoSections(photos: Photo[], view: WorkGrouping, sort: TimeSort = 'time-desc'): [string, Photo[]][] {
  const sections = new Map<string, { items: Timed<Photo>[]; latest: number }>();
  for (const photo of photos) {
    const time = photoTime(photo);
    const heading = view === 'location' ? photo.location.trim() || '未填写地点' : photo.project.trim() || '未归入项目';
    const section = sections.get(heading) ?? { items: [], latest: -Infinity };
    section.items.push({ item: photo, time });
    if (time > section.latest) section.latest = time;
    sections.set(heading, section);
  }
  const ordered = sortByTime(Array.from(sections, ([heading, { items, latest }]) => ({ item: { heading, items }, time: latest })), sort);
  return ordered.map(({ heading, items }) => [heading, sortByTime(items, sort)]);
}

function sortByTime<Item>(items: Timed<Item>[], sort: TimeSort): Item[] {
  const direction = sort === 'time-asc' ? 1 : -1;
  const key = (time: number) => Number.isFinite(time) ? direction * time : Infinity;
  return items.sort((a, b) => {
    const first = key(a.time);
    const second = key(b.time);
    return first === second ? 0 : first - second;
  }).map(({ item }) => item);
}

function photoTime(photo: Photo) {
  const value = photo.capturedAt ?? '';
  const captured = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  return Number.isNaN(captured) ? Date.parse(photo.importedAt) : captured;
}
