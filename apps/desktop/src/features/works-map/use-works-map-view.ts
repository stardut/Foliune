import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import {
  centerWorksMapView, fitWorksMapView, maxWorksMapScale, minWorksMapScale, panWorksMapView, scaleWorksMapView, worksMapVisibleCircle,
  type MapCoordinate, type MapPoint, type MapRect, type WorksMapView,
} from './works-map-layout';

const ZOOM_STEP = 1.5;
const PAN_STEP = 56;
const ZOOM_DURATION = 200;
const GESTURE_ZOOM_DURATION = 120;
type PinchEvent = Event & { scale: number; clientX: number; clientY: number };
type ZoomTransition = {
  start: WorksMapView;
  target: WorksMapView;
};
type ZoomAnimation = ZoomTransition & {
  anchor?: MapPoint;
  startedAt: number;
  duration: number;
  frame: number;
};

export function useWorksMapView(coordinates: readonly MapCoordinate[], map: MapRect | undefined,
  stage: RefObject<HTMLDivElement | null>) {
  const fitted = useMemo(() => map && fitWorksMapView(coordinates, map), [coordinates, map]);
  const [position, setPosition] = useState<WorksMapView | null>(null);
  const minimum = map ? minWorksMapScale(map) : 0;
  const maximum = map ? maxWorksMapScale(map) : 0;
  const normalize = useCallback((view: WorksMapView) => {
    const scale = Math.max(minimum, Math.min(maximum, view.scale));
    return scale === view.scale ? view : { ...view, scale };
  }, [maximum, minimum]);
  const view = useMemo(() => fitted && normalize(position ?? fitted), [position, fitted, normalize]);
  const currentView = useRef(view);
  currentView.current = view;
  const pointer = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const animation = useRef<ZoomAnimation>(null);
  const [zoomTransition, setZoomTransition] = useState<ZoomTransition>();
  const motionPreference = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)'), []);
  const stopZoom = useCallback(() => {
    if (!animation.current) return;
    cancelAnimationFrame(animation.current.frame);
    animation.current = null;
    setZoomTransition(undefined);
  }, []);
  useLayoutEffect(stopZoom, [fitted, stopZoom]);
  useEffect(() => () => {
    if (animation.current) cancelAnimationFrame(animation.current.frame);
  }, []);

  const zoom = useCallback((factor: number, anchor?: MapPoint, duration = ZOOM_DURATION) => {
    const start = currentView.current;
    if (!start || !map || pointer.current?.moved) return;
    const pending = animation.current;
    const requested = pending?.target.scale ?? start.scale;
    const scale = Math.max(minimum, Math.min(maximum, requested * factor));
    if (scale === requested) return;
    const target = scaleWorksMapView(start, map, scale, anchor);
    if (motionPreference.matches || target === start) {
      stopZoom();
      if (target !== start) setPosition(target);
      return;
    }

    function tick(now: number) {
      const active = animation.current;
      if (!active || !map) return;
      const progress = Math.min(1, (now - active.startedAt) / active.duration);
      if (progress >= 1 || motionPreference.matches) {
        animation.current = null;
        setPosition(active.target);
        setZoomTransition(undefined);
        return;
      }
      const eased = 1 - (1 - Math.max(0, progress)) ** 2;
      const scale = active.start.scale + (active.target.scale - active.start.scale) * eased;
      setPosition(scaleWorksMapView(active.start, map, scale, active.anchor));
      active.frame = requestAnimationFrame(tick);
    }
    animation.current = { start, target, anchor, duration,
      startedAt: performance.now(), frame: pending?.frame ?? requestAnimationFrame(tick) };
    setZoomTransition({ start, target });
  }, [map, maximum, minimum, motionPreference, stopZoom]);
  const pan = useCallback((dx: number, dy: number) => {
    stopZoom();
    if (fitted) setPosition((previous) => panWorksMapView(normalize(previous ?? fitted), dx, dy));
  }, [fitted, normalize, stopZoom]);
  const reset = () => { stopZoom(); setPosition(null); };
  function centerOn(coordinate: MapCoordinate) {
    stopZoom();
    if (fitted) setPosition((previous) => centerWorksMapView(normalize(previous ?? fitted), coordinate));
  }

  useEffect(() => {
    const element = stage.current;
    if (!element || !map) return;
    let pinch: { scale: number; anchor?: MapPoint } | null = null;
    function anchorAt({ clientX, clientY }: { clientX: number; clientY: number }) {
      if (!element || !map || !currentView.current) return undefined;
      const stageBounds = element.getBoundingClientRect();
      const x = clientX - stageBounds.left;
      const y = clientY - stageBounds.top;
      const { center, radius } = worksMapVisibleCircle(currentView.current, map);
      return Math.hypot(x - center.x, y - center.y) <= radius ? { x, y } : undefined;
    }
    function wheel(event: WheelEvent) {
      if (!event.ctrlKey || !map || event.deltaY === 0) return;
      const anchor = anchorAt(event);
      if (!anchor) return;
      event.preventDefault();
      if (pinch) return;
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? map.height : 1;
      const delta = Math.max(-160, Math.min(160, event.deltaY * unit));
      zoom(Math.exp(-delta / 125), anchor, GESTURE_ZOOM_DURATION);
    }
    function startPinch(event: Event) {
      if (!(event.target instanceof Element) || !event.target.closest('.works-map-rotation-surface, .works-map-pin')) return;
      event.preventDefault();
      pinch = { scale: 1, anchor: anchorAt(event as PinchEvent) };
    }
    function changePinch(event: Event) {
      if (!pinch) return;
      event.preventDefault();
      const next = (event as PinchEvent).scale;
      if (!Number.isFinite(next) || next <= 0) return;
      zoom(next / pinch.scale, pinch.anchor, GESTURE_ZOOM_DURATION);
      pinch.scale = next;
    }
    function endPinch(event: Event) {
      if (!pinch) return;
      event.preventDefault();
      pinch = null;
    }
    // WKWebView reports trackpad pinches as gesture events. Chromium reports Ctrl+wheel.
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('gesturestart', startPinch, { passive: false });
    element.addEventListener('gesturechange', changePinch, { passive: false });
    element.addEventListener('gestureend', endPinch, { passive: false });
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('gesturestart', startPinch);
      element.removeEventListener('gesturechange', changePinch);
      element.removeEventListener('gestureend', endPinch);
    };
  }, [map, stage, zoom]);

  const [dragOrigin, setDragOrigin] = useState<WorksMapView>();
  const movement = useRef({ dx: 0, dy: 0, frame: 0 });
  useEffect(() => () => { cancelAnimationFrame(movement.current.frame); }, []);

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || pointer.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  }
  function movePan(event: PointerEvent<HTMLDivElement>) {
    const current = pointer.current;
    if (current?.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 3) return;
    if (!current.moved) {
      current.moved = true;
      stopZoom();
      setDragOrigin(view);
    }
    current.x = event.clientX;
    current.y = event.clientY;
    const queued = movement.current;
    queued.dx += dx;
    queued.dy += dy;
    if (!queued.frame) queued.frame = requestAnimationFrame(applyMovement);
  }
  function applyMovement() {
    const queued = movement.current;
    const { dx, dy } = queued;
    queued.frame = queued.dx = queued.dy = 0;
    if (dx || dy) pan(dx, dy);
  }
  function endPan(event: PointerEvent<HTMLDivElement>) {
    const current = pointer.current;
    if (current?.id !== event.pointerId) return false;
    if (movement.current.frame) {
      cancelAnimationFrame(movement.current.frame);
      applyMovement();
    }
    pointer.current = null;
    setDragOrigin(undefined);
    return event.type === 'pointerup' && !current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 3;
  }
  function mapKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'ArrowLeft': pan(PAN_STEP, 0); break;
      case 'ArrowRight': pan(-PAN_STEP, 0); break;
      case 'ArrowUp': pan(0, PAN_STEP); break;
      case 'ArrowDown': pan(0, -PAN_STEP); break;
      case '+':
      case '=': zoom(ZOOM_STEP); break;
      case '-': zoom(1 / ZOOM_STEP); break;
      case '0':
      case 'Home': reset(); break;
      default: return;
    }
    event.preventDefault();
  }

  return {
    view, controlsScale: zoomTransition?.target.scale ?? view?.scale, zoomTransition,
    minimum, maximum, dragOrigin, centerOn, reset, isFitted: position === null && zoomTransition === undefined,
    zoomIn: () => zoom(ZOOM_STEP), zoomOut: () => zoom(1 / ZOOM_STEP), mapKeys,
    panHandlers: { onPointerDown: startPan, onPointerMove: movePan, onPointerUp: endPan, onPointerCancel: endPan, onLostPointerCapture: endPan },
  };
}
