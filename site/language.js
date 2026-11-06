(() => {
  const preferenceKey = 'foliune-language';
  const isSupported = (language) => language === 'zh' || language === 'en';
  const currentLanguage = document.documentElement.lang.split('-')[0];
  const currentUrl = new URL(window.location.href);
  const requestedLanguage = currentUrl.searchParams.get('lang');
  let language;

  if (isSupported(requestedLanguage)) {
    language = requestedLanguage;
    try {
      window.localStorage.setItem(preferenceKey, language);
    } catch {
      // The explicit link also works when storage is unavailable.
    }
  } else if (currentLanguage === 'zh') {
    try {
      language = window.localStorage.getItem(preferenceKey);
    } catch {
      // Use the browser language when the preference cannot be read.
    }
    if (!isSupported(language)) {
      const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language];
      language = browserLanguages.map((locale) => locale.toLowerCase().split('-')[0]).find(isSupported) ?? 'en';
    }
  }

  if (language && language !== currentLanguage) {
    const page = language === 'en' ? 'en.html' : 'index.html';
    const destination = new URL(page, currentUrl);
    destination.search = currentUrl.search;
    destination.hash = currentUrl.hash;
    window.location.replace(destination.href);
  }
})();
