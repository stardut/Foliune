// Adapted from https://beui.dev/r/wheel-picker.json. See SOURCE.md and LICENSE.
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { capturePointer, releasePointer, TOUCH_GESTURE_CLASS } from './touch';

const itemHeight = 30;
const itemAngle = 30;
const angleInRadians = itemAngle * Math.PI / 180;
const radius = itemHeight / Math.tan(angleInRadians);
const height = Math.round(2 * radius * Math.sin(2 * angleInRadians) + itemHeight);
const perspective = 1000;
const hideBeyond = 3;
const deceleration = 0.00042;
const maxVelocity = 0.18;
const velocityWindow = 90;
const wheelSensitivity = 0.012;
const wheelSettle = 110;
const easeOutBack = (p: number) => 1 + 2.35 * (p - 1) ** 3 + 1.35 * (p - 1) ** 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export function WheelPicker({ label, min, max, value, onValueChange }: {
  label: string; min: number; max: number; value: number; onValueChange: (value: number) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const [position, setPosition] = useState(value);
  const [grabbing, setGrabbing] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const scroll = useRef(value);
  const destination = useRef(value);
  const emitted = useRef(value);
  const onChange = useRef(onValueChange);
  const frame = useRef(0);
  const wheelSnap = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ y: number; scroll: number; item: number; points: [number, number][] } | null>(null);

  useLayoutEffect(() => { onChange.current = onValueChange; }, [onValueChange]);

  const paint = useCallback((next: number) => {
    scroll.current = next;
    setPosition(reduced ? Math.round(next) : next);
  }, [reduced]);

  const emit = useCallback((next: number) => {
    if (next === emitted.current) return;
    emitted.current = next;
    onChange.current(next);
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    clearTimeout(wheelSnap.current);
  }, []);

  const glide = useCallback((next: number, duration: number) => {
    stop();
    const from = scroll.current;
    destination.current = next;
    // Commit the detent when the gesture ends. The dialog can confirm it while
    // the drum is still settling.
    emit(next);
    if (reduced || from === next || duration === 0) { paint(next); return; }
    const start = performance.now();
    const tick = (now: number) => {
      const progress = (now - start) / duration;
      if (progress >= 1) { paint(next); return; }
      paint(clamp(from + (next - from) * easeOutBack(progress), min, max));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [stop, emit, reduced, paint, min, max]);

  useLayoutEffect(() => {
    if (value === emitted.current && destination.current >= min && destination.current <= max) return;
    stop();
    drag.current = null;
    setGrabbing(false);
    emitted.current = value;
    destination.current = value;
    paint(value);
  }, [value, min, max, stop, paint]);

  useEffect(() => stop, [stop]);

  const rowAt = useCallback((y: number) => {
    const { top } = container.current!.getBoundingClientRect();
    const offset = y - top - height / 2;
    const current = scroll.current;
    if (reduced) return clamp(Math.round(Math.round(current) + offset / itemHeight), min, max);
    // Match the projected drum row centres, which get closer together at
    // the edges of the cylinder.
    let nearest = clamp(Math.round(current), min, max);
    let distance = Infinity;
    const last = Math.min(max, Math.floor(current + hideBeyond - .5));
    for (let row = Math.max(min, Math.ceil(current - hideBeyond + .5)); row <= last; row++) {
      const angle = angleInRadians * (row - current);
      const depth = radius * (Math.cos(angle) - 1);
      const center = radius * Math.sin(angle) * perspective / (perspective - depth);
      if (Math.abs(center - offset) < distance) {
        nearest = row;
        distance = Math.abs(center - offset);
      }
    }
    return nearest;
  }, [min, max, reduced]);

  const beginDrag = useCallback((y: number) => {
    stop();
    destination.current = clamp(Math.round(scroll.current), min, max);
    drag.current = { y, scroll: scroll.current, item: rowAt(y), points: [[y, performance.now()]] };
    setGrabbing(true);
  }, [stop, min, max, rowAt]);

  const moveDrag = useCallback((y: number) => {
    const active = drag.current;
    if (!active) return;
    active.points.push([y, performance.now()]);
    if (active.points.length > 8) active.points.shift();
    const next = clamp(active.scroll + (active.y - y) / itemHeight, min, max);
    destination.current = Math.round(next);
    paint(next);
    emit(destination.current);
  }, [min, max, paint, emit]);

  const endDrag = useCallback((cancelled = false) => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    setGrabbing(false);
    const [lastY, lastAt] = active.points.at(-1)!;
    if (!cancelled && Math.abs(lastY - active.y) < 3 && active.points.every(([y]) => Math.abs(y - active.y) < 3)) {
      glide(active.item, 240);
      return;
    }
    const from = scroll.current;
    let next = Math.round(from);
    if (!cancelled && !reduced && performance.now() - lastAt < velocityWindow) {
      const [firstY, firstAt] = active.points.find(([, time]) => lastAt - time <= velocityWindow)!;
      if (lastAt > firstAt) {
        const velocity = clamp((firstY - lastY) / itemHeight / (lastAt - firstAt), -maxVelocity, maxVelocity);
        next = Math.round(from + Math.sign(velocity) * velocity ** 2 / (2 * deceleration));
      }
    }
    const target = clamp(next, min, max);
    glide(target, clamp(Math.sqrt(Math.abs(target - from)) * 210 + 160, 180, 750));
  }, [glide, reduced, min, max]);

  useEffect(() => {
    const element = container.current!;
    function onWheel(event: WheelEvent) {
      if (event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      stop();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      const next = clamp(scroll.current + pixels * wheelSensitivity, min, max);
      destination.current = Math.round(next);
      paint(next);
      emit(destination.current);
      wheelSnap.current = setTimeout(() => glide(destination.current, 240), wheelSettle);
    }
    function onTouchStart(event: TouchEvent) {
      if (event.touches.length === 1) beginDrag(event.touches[0].clientY);
    }
    function onTouchMove(event: TouchEvent) {
      if (event.touches.length !== 1 || !drag.current) return;
      event.preventDefault();
      moveDrag(event.touches[0].clientY);
    }
    const onTouchEnd = () => endDrag();
    const onTouchCancel = () => endDrag(true);
    element.addEventListener('wheel', onWheel, { passive: false });
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchCancel);
    return () => {
      element.removeEventListener('wheel', onWheel);
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [beginDrag, endDrag, glide, max, min, moveDrag, paint, emit, stop]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = destination.current;
    const target = { ArrowUp: at + 1, ArrowDown: at - 1, PageUp: at + 10, PageDown: at - 10, Home: min, End: max }[event.key];
    if (target === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    glide(clamp(target, min, max), event.key === 'Home' || event.key === 'End' ? 0 : 240);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    event.currentTarget.focus({ preventScroll: true });
    beginDrag(event.clientY);
    capturePointer(event.currentTarget, event.pointerId);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') return;
    releasePointer(event.currentTarget, event.pointerId);
    endDrag(event.type === 'pointercancel');
  }

  // Both beUI drum layers share the same projection. Only rows near the
  // visible window need DOM, including when the year runs from 0001 to 9999.
  const first = Math.max(min, Math.ceil(position - hideBeyond));
  const last = Math.min(max, Math.floor(position + hideBeyond));
  const rows = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const center = Math.round(position);
  const transform = reduced ? undefined : `translateZ(${-radius}px) rotateX(${itemAngle * (position - center)}deg)`;
  function renderDrum() {
    return <ul className="date-wheel-drum" style={{ transform }} aria-hidden="true">
      {rows.map((row) => <li key={row} style={{
        height: itemHeight, top: -itemHeight / 2,
        transform: reduced ? `translateY(${(row - position) * itemHeight}px)` : `rotateX(${-itemAngle * (row - center)}deg) translateZ(${radius}px)`,
      }}>{row}<span>{label}</span></li>)}
    </ul>;
  }

  return <div ref={container} className={`date-wheel ${TOUCH_GESTURE_CLASS}`} data-grabbing={grabbing || undefined}
    style={{ height }} role="spinbutton" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
    aria-valuetext={`${value}${label}`} tabIndex={0} onKeyDown={onKeyDown} onPointerDown={onPointerDown}
    onPointerMove={(event) => { if (event.pointerType !== 'touch') moveDrag(event.clientY); }} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
    <div className="date-wheel-window" style={{ perspective }}>{renderDrum()}</div>
    <div className="date-wheel-band" style={{ height: itemHeight, perspective }}>{renderDrum()}</div>
  </div>;
}
