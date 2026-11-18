import { t } from './i18n.ts';
export type BookTemplate = 'white' | 'full' | 'pair';
export interface BookChapter { id: string; title: string; photoIds: string[] }
export interface BookItem { photoId: string; x: number; y: number; width: number; height: number; cropX: number; cropY: number; fit: 'contain' | 'cover' }
export interface BookPage { id: string; chapterId: string; title: string; caption: string; items: BookItem[] }
export interface VersionInput { label: string; template: BookTemplate; pageWidth: number; pageHeight: number; chapters: BookChapter[]; pages: BookPage[] }
export interface BookVersion extends VersionInput { id: string; bookId: string; createdAt: string; kind: 'automatic' | 'manual' }
export interface BookSummary { id: string; title: string; createdAt: string; updatedAt: string; currentVersionId: string; versionCount: number; photoCount: number; coverPhotoId: string | null }
export interface BookDetail { book: BookSummary; versions: BookVersion[] }
export interface CreateBookInput { title: string; template: BookTemplate; pageWidth: number; pageHeight: number; chapters: BookChapter[] }
export const templates: { value: BookTemplate; label: string }[] = [{ value: 'white', label: t('留白', 'White Space') }, { value: 'full', label: t('满幅', 'Full Bleed') }, { value: 'pair', label: t('双图', 'Two Photos') }];
export function versionInput(version: BookVersion): VersionInput {
  const { label, template, pageWidth, pageHeight, chapters, pages } = version;
  return structuredClone({ label, template, pageWidth, pageHeight, chapters, pages });
}
