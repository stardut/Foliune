import type { BookSummary } from '../../lib/book-types';
import type { ModelProfile } from '../../lib/model-types';
import type { ShootPlan } from '../../lib/planning-types';
import type { Photo } from '../../lib/types';
import { planSearchFields } from '../planning/plan-content';

export const searchTerm = (query: string) => query.trim().toLocaleLowerCase();

export function indexSearchItems<T>(items: T[], textOf: (item: T) => string) {
  return items.map((item) => ({ item, text: textOf(item).toLocaleLowerCase() }));
}

export function findSearchItems<T>(index: { item: T; text: string }[], term: string): T[] {
  return term ? index.filter(({ text }) => text.includes(term)).map(({ item }) => item) : [];
}

export function photoSearchText(photo: Photo) {
  return [photo.title, photo.originalName, photo.annotation, photo.source, photo.location, photo.project,
    ...photo.tags, ...(photo.regions || []).map((region) => region.text)].join(' ');
}

export const bookSearchText = (book: BookSummary) => book.title;
export const modelSearchText = (model: ModelProfile) => [model.name, model.city, model.contact, model.notes, ...model.tags].join(' ');

export function planMatchLine(plan: ShootPlan, term: string) {
  const fields = planSearchFields(plan);
  const match = fields.slice(1).find(([, value]) => value?.toLocaleLowerCase().includes(term));
  if (!match && plan.title.toLocaleLowerCase().includes(term)) return undefined;
  const [label, value] = match ?? ['', fields.map(([, text]) => text).join(' ')];
  const index = value.toLocaleLowerCase().indexOf(term);
  if (index === -1) return undefined;
  const start = Math.max(0, index - 12);
  const end = Math.min(value.length, index + Math.max(38, Math.min(term.length, 80)));
  const excerpt = value.slice(start, end).replace(/\s+/g, ' ').trim();
  const context = label.length > 28 ? `${label.slice(0, 12)}…${label.slice(-14)}` : label;
  return `${context ? `${context}：` : ''}${start ? '…' : ''}${excerpt}${end < value.length ? '…' : ''}`;
}
