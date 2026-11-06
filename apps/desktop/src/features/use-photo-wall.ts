import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { photoWallLayout, visibleWallRange, type PhotoWallLayout, type PhotoWallResponse, type WallLayoutInput, type WallUnit } from './photo-wall-layout';

interface PublishedWall { key: string; contentKey: string; layout: PhotoWallLayout; complete: boolean }

const layoutCache = new Map<string, PhotoWallLayout>();
function remember(key: string, layout: PhotoWallLayout) {
  layoutCache.delete(key);
  layoutCache.set(key, layout);
  if (layoutCache.size > 3) layoutCache.delete(layoutCache.keys().next().value!);
}

export function usePhotoWall(canvasRef: RefObject<HTMLDivElement | null>, contentKey: string, mode: 'exhibition' | 'grid') {
  const [bounds, setBounds] = useState({ width: 1120, viewportHeight: 880, bleed: 24, measured: false });
  const input = useMemo<WallLayoutInput>(() => ({
    ...JSON.parse(contentKey) as Pick<WallLayoutInput, 'sections' | 'compactAlbumPair'>, layout: mode, ...bounds,
  }), [contentKey, mode, bounds]);
  const key = useMemo(() => JSON.stringify([contentKey, mode, bounds]), [contentKey, mode, bounds]);
  const [computed, setComputed] = useState<PublishedWall | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const grid = useMemo(() => mode === 'grid' ? photoWallLayout(input) : null, [input, mode]);
  const cached = layoutCache.get(key);
  const previous = computed?.contentKey === contentKey ? computed : null;
  const result = grid ?? cached ?? previous?.layout ?? null;
  const pending = !bounds.measured || (mode === 'exhibition' && !cached && !(previous?.key === key && previous.complete));
  const partial = mode === 'exhibition' && !cached && !!previous && !previous.complete;
  const populated = input.sections.some((section) => section.photos.length > 0);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const next = { width: canvas.clientWidth, viewportHeight: window.innerHeight,
        bleed: Number.parseFloat(getComputedStyle(canvas).getPropertyValue('--photo-wall-bleed')) || 0, measured: true };
      setBounds((previous) => previous.width === next.width && previous.viewportHeight === next.viewportHeight && previous.bleed === next.bleed && previous.measured ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [canvasRef, populated]);
  useEffect(() => {
    if (!bounds.measured || mode !== 'exhibition' || !populated) return;
    const cached = layoutCache.get(key);
    if (cached) {
      setComputed((last) => last?.key === key && last.complete ? last : { key, contentKey, layout: cached, complete: true });
      return;
    }
    let worker: Worker | undefined;
    let active = true;
    let units: WallUnit[] = [];
    const stop = () => { active = false; worker?.terminate(); };
    const fail = (message: string) => {
      if (!active) return;
      stop();
      setFailure({ key, message });
    };
    // Coalesce live window resizing before restarting the search.
    const timer = window.setTimeout(() => {
      setFailure(null);
      try {
        worker = new Worker(new URL('./photo-wall.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }: MessageEvent<PhotoWallResponse>) => {
          if (!active) return;
          if ('error' in data) { fail(data.error || '无法准备照片布局'); return; }
          units = units.concat(data.units);
          const layout = { units, height: data.height };
          if (data.complete) {
            remember(key, layout);
            stop();
          }
          setComputed((last) => {
            // Keep a complete wall during resizing. For a partial wall, publish
            // new coordinates as soon as their height covers the previous range.
            if (!data.complete && last?.contentKey === contentKey && last.key !== key && (last.complete || layout.height < last.layout.height)) return last;
            return { key, contentKey, layout, complete: data.complete };
          });
        };
        worker.onerror = () => fail('无法准备照片布局');
        worker.postMessage(input);
      } catch (cause) { fail(cause instanceof Error ? cause.message : '无法准备照片布局'); }
    }, previous ? 80 : 0);
    return () => { clearTimeout(timer); stop(); };
  }, [key, input, mode, contentKey, populated]);
  const current = bounds.measured && (!!grid || !!cached || previous?.key === key);
  return { layout: result, current, pending, partial, error: failure?.key === key ? failure.message : null };
}

export function photoWallViewport(canvas: HTMLDivElement, main: HTMLElement) {
  const viewport = main.getBoundingClientRect();
  const viewportTop = viewport.top + main.clientTop;
  const sibling = canvas.previousElementSibling;
  const header = sibling?.matches('.album-detail-header') ? sibling : null;
  return {
    header,
    top: Math.max(viewportTop, header?.getBoundingClientRect().bottom ?? viewportTop),
    bottom: viewportTop + main.clientHeight,
    left: viewport.left + main.clientLeft,
    width: main.clientWidth,
  };
}

export function useWallWindow(canvasRef: RefObject<HTMLDivElement | null>, layout: PhotoWallLayout | null, restore?: object) {
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const frame = useRef<number | null>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const main = canvas?.closest('main');
    if (!canvas || !main || !layout) return;
    const update = () => {
      frame.current = null;
      const viewport = photoWallViewport(canvas, main);
      const top = viewport.top - canvas.getBoundingClientRect().top;
      viewport.header?.toggleAttribute('data-photo-underlay', main.scrollTop > 0 && top > 0);
      const next = visibleWallRange(layout.units, top, viewport.bottom - viewport.top, Math.max(900, main.clientHeight * 1.5));
      setRange((previous) => previous[0] === next[0] && previous[1] === next[1] ? previous : next);
      return viewport.header;
    };
    const schedule = () => { if (frame.current === null) frame.current = requestAnimationFrame(update); };
    const header = update();
    main.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(main);
    return () => {
      main.removeEventListener('scroll', schedule);
      observer.disconnect();
      header?.removeAttribute('data-photo-underlay');
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [canvasRef, layout, restore]);
  return range;
}
