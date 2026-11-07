const noop = () => {};

export function revealContent(elements: readonly Element[]): () => void {
  return animateContent(elements, [{ opacity: .76 }, { opacity: 1 }], 180)?.cancel ?? noop;
}

export function slideContent(elements: readonly Element[], offset: number, hold: boolean) {
  return animateContent(elements, [{ transform: `translateX(${offset}px)` }, { transform: 'translateX(0)' }], 240, hold);
}

function animateContent(elements: readonly Element[], frames: Keyframe[], duration: number, hold = false) {
  if (!elements.length) return;

  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (preference.matches) return;

  const animations = elements.map((element) => {
    const animation = element.animate(frames, { duration, easing: 'cubic-bezier(.2, .72, .2, 1)' });
    if (hold) {
      animation.pause();
      animation.currentTime = 0;
    }
    return animation;
  });
  let active = true;
  const unsubscribe = () => preference.removeEventListener('change', onPreferenceChange);
  const cancel = () => {
    if (!active) return;
    active = false;
    unsubscribe();
    for (const animation of animations) animation.cancel();
  };
  const onPreferenceChange = (event: MediaQueryListEvent) => { if (event.matches) cancel(); };
  preference.addEventListener('change', onPreferenceChange);
  // Release the preference listener on completion, including cancellation.
  const finished = Promise.all(animations.map((animation) => animation.finished));
  void finished.then(unsubscribe, unsubscribe);
  return { cancel, finished, play: () => { if (active) for (const animation of animations) animation.play(); } };
}
