import { useLayoutEffect, type RefObject } from 'react';

const DOCK_MOTION = '(any-hover: hover) and (prefers-reduced-motion: no-preference)';
const MAX_GROWTH = 0.24;
const NEIGHBORHOOD = 2.45;

interface ThumbnailPosition {
  button: HTMLButtonElement;
  left: number;
  width: number;
  center: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function nextThumbnail(photos: ThumbnailPosition[], x: number) {
  let lower = 0;
  let upper = photos.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (photos[middle].center < x) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

export function useWorksMapPhotoDock(strip: RefObject<HTMLDivElement | null>, regionId: string | undefined, reviewing: boolean) {
  useLayoutEffect(() => {
    const rail = strip.current;
    const track = rail?.querySelector<HTMLDivElement>('.works-map-thumbnail-track');
    if (!rail || !track || reviewing) return;

    const motion = window.matchMedia(DOCK_MOTION);
    let photos: ThumbnailPosition[] | undefined;
    let pointerX: number | undefined;
    let frame = 0;
    let animated = new Set<HTMLButtonElement>();

    function clear(button: HTMLButtonElement) {
      button.style.removeProperty('--works-map-thumb-x');
      button.style.removeProperty('--works-map-thumb-y');
      button.style.removeProperty('--works-map-thumb-scale');
    }

    function reset() {
      pointerX = undefined;
      cancelAnimationFrame(frame);
      frame = 0;
      animated.forEach(clear);
      animated.clear();
    }

    function render() {
      frame = 0;
      if (!rail || !track || pointerX === undefined) return;
      photos ??= Array.from(track.querySelectorAll('button'), (button) => {
        const { offsetLeft: left, offsetWidth: width } = button;
        return { button, left, width, center: left + width / 2 };
      });
      const first = photos[0];
      const last = photos.at(-1);
      const scroll = rail.scrollLeft;
      const viewportWidth = rail.clientWidth;
      const pointerInRail = pointerX - rail.getBoundingClientRect().left;
      const x = scroll + pointerInRail;
      if (!first || !last || x < first.left - 8 || x > last.left + last.width + 8) {
        animated.forEach(clear);
        animated.clear();
        return;
      }

      const next = nextThumbnail(photos, x);
      const prev = photos[next - 1];
      const after = photos[next];
      const location = prev && after ? next - 1 + (x - prev.center) / (after.center - prev.center)
        : prev ? photos.length - 1 : 0;
      const start = Math.max(0, Math.ceil(location - NEIGHBORHOOD));
      const finish = Math.min(photos.length - 1, Math.floor(location + NEIGHBORHOOD));
      let totalGrowth = 0;
      let growthAtPointer = 0;
      const sizes = new Map<number, { growth: number; before: number; weight: number }>();
      for (let index = start; index <= finish; index++) {
        const { left, width } = photos[index];
        const weight = (1 - Math.abs(index - location) / NEIGHBORHOOD) ** 1.9;
        const growth = width * MAX_GROWTH * weight;
        sizes.set(index, { growth, before: totalGrowth, weight });
        totalGrowth += growth;
        growthAtPointer += growth * clamp((x - left) / width, 0, 1);
      }

      // Keep the pointer over the same part of the photo while its neighbors make room.
      // At the ends of the scroll range, shift inward so the first or last photo can expand fully.
      const trackWidth = track.clientWidth;
      const endSpace = trackWidth - last.left - last.width - first.left;
      const availableRight = Math.max(0, trackWidth - scroll - viewportWidth) + Math.max(0, endSpace);
      const minimumShift = Math.max(0, totalGrowth - availableRight);
      const maximumShift = Math.min(totalGrowth, scroll);
      const shift = minimumShift <= maximumShift ? clamp(growthAtPointer, minimumShift, maximumShift)
        : maximumShift + (minimumShift - maximumShift) * clamp(pointerInRail / viewportWidth, 0, 1);

      const nextAnimated = new Set<HTMLButtonElement>();
      const firstVisible = nextThumbnail(photos, scroll - 190 - totalGrowth);
      for (let index = firstVisible; index < photos.length; index++) {
        const { button, left } = photos[index];
        if (left > scroll + viewportWidth + totalGrowth) break;
        const size = sizes.get(index);
        const moved = (size ? size.before + size.growth / 2 : index > finish ? totalGrowth : 0) - shift;
        button.style.setProperty('--works-map-thumb-x', `${moved}px`);
        button.style.setProperty('--works-map-thumb-y', `${-4 * (size?.weight ?? 0)}px`);
        button.style.setProperty('--works-map-thumb-scale', `${1 + MAX_GROWTH * (size?.weight ?? 0)}`);
        nextAnimated.add(button);
      }
      animated.forEach((button) => { if (!nextAnimated.has(button)) clear(button); });
      animated = nextAnimated;
    }

    function schedule() {
      if (pointerX !== undefined && !frame) frame = requestAnimationFrame(render);
    }

    function follow(event: PointerEvent) {
      if (!motion.matches || event.pointerType !== 'mouse' || event.buttons) return;
      pointerX = event.clientX;
      schedule();
    }

    function browse(event: WheelEvent) {
      if (!rail || event.ctrlKey || event.metaKey) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? rail.clientWidth : 1;
      rail.scrollLeft += delta * unit;
    }

    const resize = new ResizeObserver(() => { photos = undefined; schedule(); });
    resize.observe(track);
    rail.addEventListener('pointermove', follow);
    rail.addEventListener('pointerleave', reset);
    rail.addEventListener('scroll', schedule);
    rail.addEventListener('wheel', browse, { passive: false });
    document.addEventListener('keydown', reset, true);
    motion.addEventListener('change', reset);
    window.addEventListener('blur', reset);
    return () => {
      reset();
      resize.disconnect();
      rail.removeEventListener('pointermove', follow);
      rail.removeEventListener('pointerleave', reset);
      rail.removeEventListener('scroll', schedule);
      rail.removeEventListener('wheel', browse);
      document.removeEventListener('keydown', reset, true);
      motion.removeEventListener('change', reset);
      window.removeEventListener('blur', reset);
    };
  }, [regionId, reviewing, strip]);
}
