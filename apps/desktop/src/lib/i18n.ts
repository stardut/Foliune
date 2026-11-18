export type InterfaceLocale = 'zh-CN' | 'en';
export type LanguagePreference = InterfaceLocale | 'system';

const preferenceKey = 'foliune.interface.language';
const resumeKey = 'foliune.interface.resume-settings';

export function resolveSystemLocale(language: string): InterfaceLocale {
  try {
    const locale = new Intl.Locale(language).maximize();
    if (locale.language === 'zh' && locale.script === 'Hans') return 'zh-CN';
  } catch {
    // An unavailable or invalid system locale uses English.
  }
  return 'en';
}

export function readLanguagePreference(): LanguagePreference {
  try {
    const saved = window.localStorage.getItem(preferenceKey);
    if (saved === 'en' || saved === 'zh-CN') return saved;
  } catch {
    // The UI can still follow the system when preference storage is unavailable.
  }
  return 'system';
}

function localeFor(preference: LanguagePreference): InterfaceLocale {
  return preference === 'system' ? resolveSystemLocale(globalThis.navigator?.language ?? '') : preference;
}

const locale = localeFor(readLanguagePreference());

export function getLocale(): InterfaceLocale {
  return locale;
}

export function t(chinese: string, english: string): string {
  return locale === 'zh-CN' ? chinese : english;
}

export function photoCount(count: number): string {
  return t(`${count} 张照片`, `${count} ${count === 1 ? 'photo' : 'photos'}`);
}

export function albumCount(count: number): string {
  return t(`${count} 个相簿`, `${count} ${count === 1 ? 'album' : 'albums'}`);
}

export function saveLanguagePreference(preference: LanguagePreference) {
  const reload = localeFor(preference) !== locale;
  if (reload) window.sessionStorage.setItem(resumeKey, '1');
  try {
    window.localStorage.setItem(preferenceKey, preference);
  } catch (error) {
    if (reload) window.sessionStorage.removeItem(resumeKey);
    throw error;
  }
  if (reload) window.location.reload();
}

export function resumeLanguageSettings(): boolean {
  try {
    if (window.sessionStorage.getItem(resumeKey) !== '1') return false;
    window.sessionStorage.removeItem(resumeKey);
    return true;
  } catch {
    return false;
  }
}
