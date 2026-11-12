import { Channel, invoke } from '@tauri-apps/api/core';

export interface AppUpdateInfo {
  currentVersion: string;
  enabled: boolean;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export const appUpdateInfo = () => invoke<AppUpdateInfo>('app_update_info');
export const checkAppUpdate = () => invoke<string | null>('check_app_update');

export function downloadAppUpdate(version: string, onProgress: (progress: UpdateProgress) => void) {
  const progress = new Channel<UpdateProgress>(onProgress);
  return invoke<void>('download_app_update', { version, progress });
}

export const installAppUpdate = (version: string) => invoke<void>('install_app_update', { version });
