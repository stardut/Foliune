import { open, save } from '@tauri-apps/plugin-dialog';
import { call, withImageUrls } from './api';
import type { LibrarySnapshot } from './types';

export type BackupMode = 'metadata' | 'full';
export interface BackupResult { path: string; photoCount: number }
export interface RestoreResult {
  snapshot: LibrarySnapshot;
  photoCount: number;
  skippedMembershipCount: number;
  skippedDocumentCount: number;
  unresolvedWorkPhotoCount: number;
}

const backupFilters = [{ name: 'Foliune 图库备份', extensions: ['zip'] }];

export async function createBackup(mode: BackupMode): Promise<BackupResult | null> {
  const title = mode === 'full' ? '保存含原片的备份' : '保存图库资料备份';
  const suffix = mode === 'full' ? '含原片' : '图库资料';
  const path = await save({ title, defaultPath: `Foliune-${new Date().toISOString().slice(0, 10)}-${suffix}.zip`, filters: backupFilters });
  return path ? call<BackupResult>('backup_create', { path, mode }) : null;
}

export function selectBackup() {
  return open({ title: '选择图库备份', multiple: false, directory: false, filters: backupFilters });
}

export async function restoreBackup(path: string): Promise<RestoreResult> {
  const result = await call<RestoreResult>('backup_restore', { path });
  return { ...result, snapshot: withImageUrls(result.snapshot) };
}
