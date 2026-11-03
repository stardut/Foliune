import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { movePhotoId, socialGridTarget } from './social-photo-order';

type DragView = { id: string; left: number; top: number; width: number; height: number; valid: boolean };
type DragSession = {
  id: string; pointerId: number; originalIds: string[]; ids: string[];
  startX: number; startY: number; x: number; y: number; offsetX: number; offsetY: number; width: number; height: number; started: boolean;
};

export function useSocialPhotoSort(ids: string[], onChange: (ids: string[]) => void, announce: (message: string) => void) {
  const listRef = useRef<HTMLOListElement>(null);
  const current = useRef({ ids, onChange, announce });
  current.current = { ids, onChange, announce };
  const [drag, setDrag] = useState<DragView | null>(null);
  const session = useRef<DragSession | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  function start(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    const list = listRef.current;
    const row = event.currentTarget.closest('li');
    if (!list || !row || ids.length < 2 || event.button !== 0 || !event.isPrimary || session.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const bounds = row.getBoundingClientRect();
    const state: DragSession = {
      id, pointerId: event.pointerId, originalIds: [...ids], ids: [...ids],
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top,
      width: bounds.width, height: bounds.height, started: false,
    };
    session.current = state;
    let scrollParent: HTMLElement | null = list.parentElement;
    while (scrollParent && !/(auto|scroll)/.test(getComputedStyle(scrollParent).overflowY)) scrollParent = scrollParent.parentElement;
    const scroller = scrollParent;
    let frame = 0;
    let lastTime = 0;

    function viewport() {
      const rect = scroller?.getBoundingClientRect();
      return { top: Math.max(0, rect?.top ?? 0), bottom: Math.min(window.innerHeight, rect?.bottom ?? window.innerHeight) };
    }
    function canDrop() {
      const rect = list!.getBoundingClientRect();
      const visible = viewport();
      return state.x >= rect.left - 16 && state.x <= rect.right + 16
        && state.y >= Math.max(rect.top, visible.top) - 16 && state.y <= Math.min(rect.bottom, visible.bottom) + 16;
    }
    function draw() {
      if (session.current !== state) return;
      const latestIds = current.current.ids;
      if (latestIds.length !== state.originalIds.length || latestIds.some((photoId) => !state.originalIds.includes(photoId))) {
        finish(true);
        return;
      }
      const valid = canDrop();
      const left = state.x - state.offsetX;
      const top = state.y - state.offsetY;
      setDrag((previous) => previous?.id === id && previous.left === left && previous.top === top && previous.valid === valid
        ? previous : { id, left, top, width: state.width, height: state.height, valid });
      if (!valid) return;
      // All slots, including the placeholder, keep their geometry after an
      // insertion. Hit the pointer against those slots rather than IDs that
      // move around it, so a stationary pointer cannot alternate destinations.
      const target = socialGridTarget([...list!.children].map((item) => item.getBoundingClientRect()), state.x, state.y);
      const next = movePhotoId(state.ids, id, target);
      if (next.some((photoId, index) => photoId !== state.ids[index])) {
        state.ids = next;
        current.current.onChange(next);
      }
    }
    function tick(time: number) {
      if (session.current !== state) return;
      const elapsed = lastTime ? Math.min(time - lastTime, 32) / 16.67 : 1;
      lastTime = time;
      if (state.started) {
        if (scroller && canDrop()) {
          const visible = viewport();
          const edge = Math.min(52, (visible.bottom - visible.top) / 4);
          const speed = state.y < visible.top + edge ? -Math.min(1, (visible.top + edge - state.y) / edge)
            : state.y > visible.bottom - edge ? Math.min(1, (state.y - visible.bottom + edge) / edge) : 0;
          scroller.scrollTop += speed * 13 * elapsed;
        }
        draw();
      }
      if (session.current === state) frame = requestAnimationFrame(tick);
    }
    function cleanup() {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
      list!.removeEventListener('lostpointercapture', cancel);
      if (list!.hasPointerCapture(state.pointerId)) list!.releasePointerCapture(state.pointerId);
      session.current = null;
      stop.current = null;
    }
    function finish(cancelled: boolean) {
      if (session.current !== state) return;
      cleanup();
      setDrag(null);
      if (!state.started) return;
      // If another control changed the selection, never restore removed photos.
      const latestIds = current.current.ids;
      const unchangedSelection = latestIds.length === state.originalIds.length && latestIds.every((photoId) => state.originalIds.includes(photoId));
      if (cancelled && unchangedSelection) current.current.onChange(state.originalIds);
      current.current.announce(cancelled ? '已取消排序' : `照片已移至第 ${state.ids.indexOf(id) + 1} 张，共 ${state.ids.length} 张`);
    }
    function move(pointer: PointerEvent) {
      if (pointer.pointerId !== state.pointerId) return;
      pointer.preventDefault();
      state.x = pointer.clientX; state.y = pointer.clientY;
      if (state.x < 0 || state.x > window.innerWidth || state.y < 0 || state.y > window.innerHeight) { finish(true); return; }
      if (!state.started && Math.hypot(state.x - state.startX, state.y - state.startY) >= 5) state.started = true;
      if (state.started) draw();
    }
    function up(pointer: PointerEvent) {
      if (pointer.pointerId !== state.pointerId) return;
      state.x = pointer.clientX; state.y = pointer.clientY;
      if (!state.started && Math.hypot(state.x - state.startX, state.y - state.startY) >= 5) state.started = true;
      const valid = state.x >= 0 && state.x <= window.innerWidth && state.y >= 0 && state.y <= window.innerHeight && canDrop();
      // Pointerup may carry the final movement before another move event or frame.
      if (valid && state.started) draw();
      finish(!valid);
    }
    function cancel() { finish(true); }
    function key(keyboard: KeyboardEvent) {
      if (keyboard.key === 'Escape') { keyboard.preventDefault(); keyboard.stopPropagation(); finish(true); }
      else if (keyboard.key === 'Tab') finish(true);
    }
    function visibility() { if (document.hidden) finish(true); }
    stop.current = cleanup;
    list.setPointerCapture(state.pointerId);
    window.addEventListener('pointermove', move, { capture: true, passive: false });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    list.addEventListener('lostpointercapture', cancel);
    frame = requestAnimationFrame(tick);
  }

  return { listRef, drag, start };
}
