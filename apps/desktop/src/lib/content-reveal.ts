const noop = () => {};

export function revealContent(elements: readonly Element[]): () => void {
  if (!elements.length) return noop;

  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches) return noop;

  const animations = elements.map((element) => element.animate([{ opacity: .76 }, { opacity: 1 }], {
    duration: 180,
    easing: 'cubic-bezier(.2, .72, .2, 1)',
  }));
  const unsubscribe = () => preference.removeEventListener('change', onPreferenceChange);
  const cancel = () => {
    unsubscribe();
    for (const animation of animations) animation.cancel();
  };
  const onPreferenceChange = (event: MediaQueryListEvent) => { if (event.matches) cancel(); };
  preference.addEventListener('change', onPreferenceChange);
  // Release the preference listener on completion, including cancellation.
  void Promise.all(animations.map((animation) => animation.finished)).then(unsubscribe, unsubscribe);
  return cancel;
}
