import { t } from './i18n.ts';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { call, isDesktop } from './api';
export interface MusicTrack { id: string; name: string; url: string }
export interface MusicImportResult {
  tracks: MusicTrack[];
  failures: { name: string; message: string }[];
}
export async function pickMusic(signal: AbortSignal): Promise<MusicImportResult> {
  if (!isDesktop()) throw new Error(t('请在 Foliune 桌面应用中选择本地音乐。', 'Use the Foliune desktop app to choose local music.'));
  const paths = await open({ title: t('选择欣赏配乐', 'Choose Slideshow Music'), multiple: true, directory: false,
    filters: [{ name: t('音乐', 'Music'), extensions: ['mp3', 'm4a', 'wav', 'ogg', 'aac', 'flac'] }],
  });
  const result: MusicImportResult = { tracks: [], failures: [] };
  if (!paths || signal.aborted) return result;
  for (const path of new Set(paths)) {
    if (signal.aborted) break;
    try {
      const track = await call<{id: string; name: string; path: string}>('music_import', { path });
      result.tracks.push({ id: track.id, name: track.name, url: convertFileSrc(track.path) });
    } catch (cause) {
      result.failures.push({ name: path.split(/[\\/]/).pop()!, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return result;
}
export const releaseMusic = (id: string) => call<void>('music_release', { id });
