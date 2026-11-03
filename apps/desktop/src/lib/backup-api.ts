import { open, save } from '@tauri-apps/plugin-dialog';
import { call, withImageUrls } from './api';
import type { LibrarySnapshot } from './types';
export interface LibraryInfo { id: string; name: string; path: string }
export interface LibraryList { currentId: string; libraries: LibraryInfo[] }
export interface BackupResult { path: string; photoCount: number }
export interface RestoreResult { library: LibraryInfo; photoCount: number }
export const listLibraries = () => call<LibraryList>('libraries_list');
export async function createBackup(): Promise<BackupResult | null> {
  const path = await save({ title: '备份图库', defaultPath: `Foliune-${new Date().toISOString().slice(0,10)}.zip`, filters: [{ name: 'Foliune 图库备份', extensions: ['zip'] }] });
  return path ? call<BackupResult>('backup_create', { path }) : null;
}
export async function restoreBackup(): Promise<RestoreResult | null> {
  const path = await open({ title: '恢复到新图库', multiple: false, directory: false, filters: [{ name: 'Foliune 图库备份', extensions: ['zip'] }] });
  return path ? call<RestoreResult>('backup_restore', { path }) : null;
}
export async function switchLibrary(id: string): Promise<LibrarySnapshot> {
  return withImageUrls(await call<LibrarySnapshot>('libraries_switch', { id }));
}
