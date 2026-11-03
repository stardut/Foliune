import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { call, isDesktop } from './api';
export interface MusicTrack { id: string; name: string; url: string }
export async function pickMusic(): Promise<MusicTrack | null> {
  if (!isDesktop()) throw new Error('请在 Foliune 桌面应用中选择本地音乐。');
  const path = await open({ title: '选择欣赏配乐', multiple: false, directory: false,
    filters: [{ name: '音乐', extensions: ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'] }],
  });
  if (!path) return null;
  const track = await call<{id: string; name: string; path: string}>('music_import', { path });
  return { id: track.id, name: track.name, url: convertFileSrc(track.path) };
}
export const releaseMusic = (id: string) => call<void>('music_release', { id });
