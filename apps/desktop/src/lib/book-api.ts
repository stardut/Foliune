import { t } from './i18n.ts';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { withImageUrls } from './api';
import type { BookDetail, BookSummary, CreateBookInput, VersionInput } from './book-types';
import type { LibrarySnapshot } from './types';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error(t('请在 Foliune 桌面应用中使用画册。', 'Use the Foliune desktop app to work with photo books.'));
  try { return await invoke<T>(command, args); }
  catch (cause) { throw new Error(typeof cause === 'string' ? cause : String(cause)); }
}
export const listBooks = () => call<BookSummary[]>('books_list');
export const getBook = (id: string) => call<BookDetail>('books_get', { id });
export const createBook = (input: CreateBookInput) => call<BookDetail>('books_create', { input });
export const saveVersion = (bookId: string, versionId: string, input: VersionInput) => call<BookDetail>('books_save_version', { bookId, versionId, input });
export const renameBook = (id: string, title: string, expectedRevision: string) =>
  call<BookDetail>('books_rename', { id, title, expectedRevision });
export const deleteBook = async (id: string, expectedRevision: string) =>
  withImageUrls(await call<LibrarySnapshot>('books_delete', { id, expectedRevision }));
export const appendPhotosToBook = (bookId: string, photoIds: string[]) => call<BookDetail>('books_append_photos', { bookId, photoIds });
export async function exportBook(book: BookDetail, versionId: string): Promise<string | null> {
  if (!isTauri()) throw new Error(t('请在 Foliune 桌面应用中导出画册。', 'Use the Foliune desktop app to export photo books.'));
  const safeName = book.book.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  const path = await save({ title: t('导出自包含 HTML 画册', 'Export Self-Contained HTML Photo Book'), defaultPath: `${safeName}.html`, filters: [{ name: t('离线 HTML 画册', 'Offline HTML Photo Book'), extensions: ['html'] }] });
  if (!path) return null;
  await call<void>('books_export', { bookId: book.book.id, versionId, path });
  return path;
}
