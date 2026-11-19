import type { MusicTrack } from './music-api';
import type { MusicBeatGrid } from './music-beats';

export interface BuiltinMusicTrack extends MusicTrack {
  nameEn: string;
  bpm: number;
  grid: MusicBeatGrid;
}

function score(bpm: number): MusicBeatGrid {
  const beat = 60 / bpm;
  return {
    duration: Math.round(32 * beat * 22050) / 22050,
    beats: Array.from({ length: 32 }, (_, index) => index * beat),
    // Bar downbeats match the composed kick and chord attacks.
    downbeats: Array.from({ length: 8 }, (_, index) => index * 4 * beat),
  };
}

export const BUILTIN_MUSIC: readonly BuiltinMusicTrack[] = [
  { id: 'builtin-mist-walk', name: '雾中慢行', nameEn: 'Mist Walk', url: '/music/mist-walk.wav', bpm: 72, grid: score(72) },
  { id: 'builtin-light-pulse', name: '光的脉冲', nameEn: 'Light Pulse', url: '/music/light-pulse.wav', bpm: 108, grid: score(108) },
];
