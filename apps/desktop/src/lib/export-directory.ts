import { t } from './i18n.ts';
import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export function selectExportDirectory(title: string): Promise<string | null> {
  if (!isTauri()) throw new Error(t('请在 Foliune 桌面应用中导出 PNG。', 'Use the Foliune desktop app to export PNG files.'));
  return open({ title, directory: true, multiple: false });
}

export function exportedFileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}
