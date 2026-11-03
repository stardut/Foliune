import type { Photo } from '../lib/types';

export type WorkView = 'time' | 'location' | 'project';

// Keep the wall's existing, page-local section order. A review walks those
// exact sections page by page rather than regrouping the entire library.
export function workPhotoSections(photos: Photo[], view: WorkView): [string, Photo[]][] {
  const sections = new Map<string, Photo[]>();
  const sorted = [...photos].sort((a, b) => (b.capturedAt || b.importedAt).localeCompare(a.capturedAt || a.importedAt));
  for (const photo of sorted) {
    const heading = view === 'location' ? photo.location.trim() || '未填写地点'
      : view === 'project' ? photo.project.trim() || '未归入项目'
      : monthLabel(photo.capturedAt || photo.importedAt);
    const items = sections.get(heading);
    if (items) items.push(photo);
    else sections.set(heading, [photo]);
  }
  return [...sections.entries()];
}

export function photoReviewOrder(photos: Photo[], space: 'collection' | 'work' | 'search', view: WorkView, pageSize: number): Photo[] {
  if (space !== 'work') return photos;
  const ordered: Photo[] = [];
  for (let start = 0; start < photos.length; start += pageSize) {
    for (const [, items] of workPhotoSections(photos.slice(start, start + pageSize), view)) ordered.push(...items);
  }
  return ordered;
}

function monthLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未填写时间' : `${date.getFullYear()} 年 ${String(date.getMonth() + 1).padStart(2, '0')} 月`;
}
