// Record actual showModal order: DOM order does not identify the active modal.
const modals: HTMLDialogElement[] = [];
const listeners = new Set<() => void>();
function notify() { listeners.forEach((listener) => listener()); }

export function currentModalHost(): Element { return modals.at(-1) ?? document.body; }
export function subscribeModalStack(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function presentModal(dialog: HTMLDialogElement) {
  dialog.showModal();
  modals.push(dialog);
  notify();
  const remove = () => {
    const index = modals.indexOf(dialog);
    if (index !== -1) { modals.splice(index, 1); notify(); }
  };
  // StrictMode can reopen before the prior close event is dispatched.
  const onClose = () => { if (!dialog.open) remove(); };
  dialog.addEventListener('close', onClose);
  return () => {
    dialog.removeEventListener('close', onClose);
    dialog.close();
    remove();
  };
}
