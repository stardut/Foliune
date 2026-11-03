export type BookTemplate = 'white' | 'full' | 'pair';
export interface BookChapter { id: string; title: string; photoIds: string[] }
export interface BookItem { photoId: string; x: number; y: number; width: number; height: number; cropX: number; cropY: number; fit: 'contain' | 'cover' }
export interface BookPage { id: string; chapterId: string; title: string; caption: string; items: BookItem[] }
export interface VersionInput { label: string; template: BookTemplate; pageWidth: number; pageHeight: number; chapters: BookChapter[]; pages: BookPage[] }
export interface BookVersion extends VersionInput { id: string; bookId: string; createdAt: string; kind: 'automatic' | 'manual' }
export interface BookSummary { id: string; title: string; createdAt: string; updatedAt: string; currentVersionId: string; versionCount: number; photoCount: number }
export interface BookDetail { book: BookSummary; versions: BookVersion[] }
export interface CreateBookInput { title: string; template: BookTemplate; pageWidth: number; pageHeight: number; chapters: BookChapter[] }
export const templates: { value: BookTemplate; label: string }[] = [{ value: 'white', label: '留白' }, { value: 'full', label: '满幅' }, { value: 'pair', label: '双图' }];
export function versionInput(version: BookVersion): VersionInput {
  const { label, template, pageWidth, pageHeight, chapters, pages } = version;
  return structuredClone({ label, template, pageWidth, pageHeight, chapters, pages });
}
