import { invoke, isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { withImageUrls } from './api';
import type { BookDetail, BookSummary, CreateBookInput, VersionInput } from './book-types';
import type { LibrarySnapshot } from './types';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('请在 Foliune 桌面应用中使用画册。');
  try { return await invoke<T>(command, args); }
  catch (cause) { throw new Error(typeof cause === 'string' ? cause : String(cause)); }
}
export const listBooks = () => call<BookSummary[]>('books_list');
export const getBook = (id: string) => call<BookDetail>('books_get', { id });
export const createBook = (input: CreateBookInput) => call<BookDetail>('books_create', { input });
export const saveVersion = (bookId: string, versionId: string, input: VersionInput) => call<BookDetail>('books_save_version', { bookId, versionId, input });
export const renameBook = (id: string, title: string) => call<BookDetail>('books_rename', { id, title });
export const deleteBook = async (id: string) => withImageUrls(await call<LibrarySnapshot>('books_delete', { id }));
export const appendPhotosToBook = (bookId: string, photoIds: string[]) => call<BookDetail>('books_append_photos', { bookId, photoIds });
export async function exportBook(book: BookDetail, versionId: string): Promise<string | null> {
  if (!isTauri()) throw new Error('请在 Foliune 桌面应用中导出画册。');
  const safeName = book.book.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  const path = await save({ title: '导出自包含 HTML 画册', defaultPath: `${safeName}.html`, filters: [{ name: '离线 HTML 画册', extensions: ['html'] }] });
  if (!path) return null;
  await call<void>('books_export', { bookId: book.book.id, versionId, path });
  return path;
}
