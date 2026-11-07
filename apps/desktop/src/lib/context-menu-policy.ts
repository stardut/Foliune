export type TextMenuKind = 'edit' | 'copy';
export type OpenTextMenu = (kind: TextMenuKind, at: { x: number; y: number }, target: HTMLElement) => void;

function textTarget(target: EventTarget | null): { element: HTMLElement; kind: TextMenuKind } | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>('input, textarea, [contenteditable]');
  if (!element || element.matches(':disabled')) return null;
  if (element instanceof HTMLInputElement) {
    if (!['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(element.type)) return null;
    return { element, kind: element.readOnly ? 'copy' : 'edit' };
  }
  if (element instanceof HTMLTextAreaElement) return { element, kind: element.readOnly ? 'copy' : 'edit' };
  const editable = element.getAttribute('contenteditable')?.toLowerCase();
  return editable === '' || editable === 'true' || editable === 'plaintext-only' ? { element, kind: 'edit' } : null;
}

// Run after React's delegated business handlers. Prevent only the browser's
// default menu; never stop propagation or replace an already handled menu.
export function installContextMenuPolicy(document: Document, open: OpenTextMenu) {
  const contextmenu = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    event.preventDefault();
    const target = textTarget(event.target);
    if (target) open(target.kind, { x: event.clientX, y: event.clientY }, target.element);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))) return;
    event.preventDefault();
    const target = textTarget(event.target);
    if (!target) return;
    const rect = target.element.getBoundingClientRect();
    open(target.kind, { x: rect.left + 12, y: rect.bottom }, target.element);
  };
  document.addEventListener('contextmenu', contextmenu);
  document.addEventListener('keydown', keydown);
  return () => {
    document.removeEventListener('contextmenu', contextmenu);
    document.removeEventListener('keydown', keydown);
  };
}
