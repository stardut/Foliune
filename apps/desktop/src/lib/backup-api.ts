import { t } from './i18n.ts';
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

const backupFilters = [{ name: t('Foliune 图库备份', 'Foliune Library Backup'), extensions: ['zip'] }];

export async function createBackup(mode: BackupMode): Promise<BackupResult | null> {
  const title = mode === 'full' ? t('保存含原片的备份', 'Save Backup with Originals') : t('保存图库资料备份', 'Save Library Data Backup');
  const suffix = mode === 'full' ? t('含原片', 'with-originals') : t('图库资料', 'library-data');
  const path = await save({ title, defaultPath: `Foliune-${new Date().toISOString().slice(0, 10)}-${suffix}.zip`, filters: backupFilters });
  return path ? call<BackupResult>('backup_create', { path, mode }) : null;
}

export function selectBackup() {
  return open({ title: t('选择图库备份', 'Choose a Library Backup'), multiple: false, directory: false, filters: backupFilters });
}

export async function restoreBackup(path: string): Promise<RestoreResult> {
  const result = await call<RestoreResult>('backup_restore', { path });
  return { ...result, snapshot: withImageUrls(result.snapshot) };
}
