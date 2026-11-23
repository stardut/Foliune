export const DEFAULT_APPRECIATION_SECONDS = 6;
export interface AppreciationPreferences {
  random: boolean;
  loop: boolean;
  preferFill: boolean;
  groupPortraits: boolean;
  musicEnabled: boolean;
}
export const defaultAppreciationPreferences: AppreciationPreferences = {
  random: false, loop: true, preferFill: false, groupPortraits: false, musicEnabled: true,
};
const key = 'foliune.appreciation';

export function readAppreciationPreferences(): AppreciationPreferences {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? 'null') as (Partial<AppreciationPreferences> & { musicId?: string }) | null;
    if (!saved) return defaultAppreciationPreferences;
    return {
      random: typeof saved.random === 'boolean' ? saved.random : defaultAppreciationPreferences.random,
      loop: typeof saved.loop === 'boolean' ? saved.loop : defaultAppreciationPreferences.loop,
      preferFill: typeof saved.preferFill === 'boolean' ? saved.preferFill : defaultAppreciationPreferences.preferFill,
      groupPortraits: typeof saved.groupPortraits === 'boolean' ? saved.groupPortraits : defaultAppreciationPreferences.groupPortraits,
      musicEnabled: typeof saved.musicEnabled === 'boolean' ? saved.musicEnabled : saved.musicId !== 'off',
    };
  } catch { return defaultAppreciationPreferences; }
}

export function saveAppreciationPreferences(preferences: AppreciationPreferences) {
  window.localStorage.setItem(key, JSON.stringify(preferences));
}
