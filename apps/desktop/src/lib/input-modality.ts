// Programmatic focus (including dialog/menu restoration) keeps the last real
// input modality. WebKit's :focus-visible heuristic alone can retain a ring.
export function installInputModality(document: Document) {
  const root = document.documentElement;
  root.dataset.inputMode = 'pointer';
  const pointer = () => { root.dataset.inputMode = 'pointer'; };
  const navigationKeys = new Set(['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Enter', ' ', 'ContextMenu', 'F10']);
  const keyboard = (event: KeyboardEvent) => {
    if (!event.isComposing && navigationKeys.has(event.key)) root.dataset.inputMode = 'keyboard';
  };
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('keydown', keyboard, true);
  return () => {
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('keydown', keyboard, true);
  };
}
