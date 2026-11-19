import { BUILTIN_MUSIC } from './player-music';

export const appreciationIntervals = [3, 5, 6, 10, 15, 30, 60] as const;
export interface AppreciationPreferences {
  seconds: number;
  volume: number;
  random: boolean;
  loop: boolean;
  musicId: string;
}
export const defaultAppreciationPreferences: AppreciationPreferences = {
  seconds: 6, volume: .35, random: false, loop: true, musicId: BUILTIN_MUSIC[0].id,
};
const key = 'foliune.appreciation';

export function readAppreciationPreferences(): AppreciationPreferences {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? 'null') as Partial<AppreciationPreferences> | null;
    if (!saved) return defaultAppreciationPreferences;
    return {
      seconds: appreciationIntervals.some((seconds) => seconds === saved.seconds) ? saved.seconds! : defaultAppreciationPreferences.seconds,
      volume: typeof saved.volume === 'number' && Number.isFinite(saved.volume) && saved.volume >= 0 && saved.volume <= 1 ? saved.volume : defaultAppreciationPreferences.volume,
      random: typeof saved.random === 'boolean' ? saved.random : defaultAppreciationPreferences.random,
      loop: typeof saved.loop === 'boolean' ? saved.loop : defaultAppreciationPreferences.loop,
      musicId: saved.musicId === 'off' || BUILTIN_MUSIC.some((track) => track.id === saved.musicId) ? saved.musicId! : defaultAppreciationPreferences.musicId,
    };
  } catch { return defaultAppreciationPreferences; }
}

export function saveAppreciationPreferences(preferences: AppreciationPreferences) {
  window.localStorage.setItem(key, JSON.stringify(preferences));
}
