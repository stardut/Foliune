(() => {
  const currentUrl = new URL(window.location.href);
  const requestedLanguage = currentUrl.searchParams.get('lang');
  if (requestedLanguage !== 'zh' && requestedLanguage !== 'en') return;

  const destination = new URL(requestedLanguage === 'en' ? 'en.html' : 'index.html', currentUrl);
  currentUrl.searchParams.delete('lang');
  destination.search = currentUrl.search;
  destination.hash = currentUrl.hash;
  window.location.replace(destination.href);
})();
