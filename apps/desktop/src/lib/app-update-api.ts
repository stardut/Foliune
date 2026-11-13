import { Channel, invoke } from '@tauri-apps/api/core';

export interface AppUpdateInfo {
  currentVersion: string;
  enabled: boolean;
}

export type UpdateProgress =
  | { stage: 'downloading'; downloaded: number; total: number | null }
  | { stage: 'verifying' | 'installing' | 'restarting' };

export const appUpdateInfo = () => invoke<AppUpdateInfo>('app_update_info');
export const checkAppUpdate = () => invoke<string | null>('check_app_update');

export function installAppUpdate(version: string, onProgress: (progress: UpdateProgress) => void) {
  const progress = new Channel<UpdateProgress>(onProgress);
  return invoke<void>('install_app_update', { version, progress });
}
