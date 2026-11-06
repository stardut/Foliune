import type { Photo } from '../lib/types';
import { photoWallViewport } from './use-photo-wall';

type Bounds = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>;
type VisibleBounds = { left: number; top: number; right: number; bottom: number };

export interface ReviewEntrySource {
  image: HTMLImageElement;
  bounds: Bounds;
  clip: VisibleBounds | null;
}

const preferenceQuery = '(prefers-reduced-motion: reduce)';
const duration = 260;
const easing = 'cubic-bezier(.22, .72, .24, 1)';

function containedPhoto(box: Bounds, image: HTMLImageElement): Bounds {
  const factor = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const width = image.naturalWidth * factor, height = image.naturalHeight * factor;
  return { width, height, left: box.left + (box.width - width) / 2, top: box.top + (box.height - height) / 2 };
}

function ready(image: HTMLImageElement | null | undefined): image is HTMLImageElement {
  return !!image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
}

export function wallReviewSource(photo: Photo, trigger: HTMLButtonElement): ReviewEntrySource | undefined {
  if (!photo.originalAvailable || !photo.thumbnailAvailable || !photo.thumbnailUrl || window.matchMedia(preferenceQuery).matches) return;
  const canvas = trigger.closest<HTMLDivElement>('.virtual-photo-wall');
  const main = canvas?.closest('main');
  const image = trigger.parentElement?.querySelector<HTMLImageElement>('.image-asset > img');
  if (!canvas || !main || !ready(image) || image.getAttribute('src') !== photo.thumbnailUrl
    || image.parentElement?.hasAttribute('data-image-pending')) return;
  const viewport = photoWallViewport(canvas, main);
  const viewportRight = viewport.left + viewport.width;
  // The element's bounds include the wall's hover scale; object-fit padding is not part of the photo.
  const bounds = containedPhoto(image.getBoundingClientRect(), image);
  const right = bounds.left + bounds.width, bottom = bounds.top + bounds.height;
  if (bounds.width <= 0 || bounds.height <= 0 || right <= viewport.left || bottom <= viewport.top
    || bounds.left >= viewportRight || bounds.top >= viewport.bottom) return;
  const clipped = bounds.left < viewport.left || bounds.top < viewport.top || right > viewportRight || bottom > viewport.bottom;
  return { image, bounds, clip: clipped ? { ...viewport, right: viewportRight } : null };
}

export function startReviewEntry(dialog: HTMLDialogElement, source: ReviewEntrySource): (() => void) | undefined {
  const preference = window.matchMedia(preferenceQuery);
  const layers = dialog.querySelector<HTMLDivElement>('.photo-review-images');
  const thumbnail = layers?.querySelector<HTMLImageElement>('.photo-review-frame-current img');
  if (preference.matches || !source.image.isConnected || !layers || !ready(thumbnail) || thumbnail.src !== source.image.src
    || thumbnail.naturalWidth !== source.image.naturalWidth || thumbnail.naturalHeight !== source.image.naturalHeight) return;

  const stage = layers.getBoundingClientRect();
  if (stage.width <= 0 || stage.height <= 0) return;
  const { bounds, clip } = source;
  const target = containedPhoto(stage, thumbnail);
  const scale = bounds.width / target.width;
  const x = bounds.left + bounds.width / 2 - (target.left + target.width / 2);
  const y = bounds.top + bounds.height / 2 - (target.top + target.height / 2);
  const first: Keyframe = { transform: `translate(${x}px, ${y}px) scale(${scale})` };
  const last: Keyframe = { transform: 'translate(0px, 0px) scale(1)' };
  if (clip) {
    // A scrolled tile may sit partly behind the album header or viewport edge.
    // Transfer that clip in layer coordinates, then relax it as the photo moves.
    const left = stage.left + x + stage.width * (1 - scale) / 2;
    const top = stage.top + y + stage.height * (1 - scale) / 2;
    const right = left + stage.width * scale, bottom = top + stage.height * scale;
    first.clipPath = `inset(${[clip.top - top, right - clip.right, bottom - clip.bottom, clip.left - left]
      .map((edge) => `${Math.max(0, edge / scale)}px`).join(' ')})`;
    last.clipPath = 'inset(0px)';
  }

  const mat = getComputedStyle(dialog).backgroundColor;
  const width = layers.clientWidth, height = layers.clientHeight;
  const movement = layers.animate([first, last], { duration, easing });
  const backdrop = dialog.animate([{ backgroundColor: 'transparent' }, { backgroundColor: mat }], { duration, easing });
  const tools = Array.from(dialog.querySelectorAll('.photo-review-header, .photo-review-footer'), (element) =>
    element.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 198, delay: 62, fill: 'backwards', easing }));
  const previousVisibility = source.image.style.visibility;
  // The already loaded review thumbnail takes over the same pixels immediately.
  // Hide only the wall copy, while the darkening backdrop still shows the wall.
  source.image.style.visibility = 'hidden';
  dialog.setAttribute('data-entering-from-wall', '');
  let active = true;
  const observer = new ResizeObserver(() => {
    if (layers.clientWidth !== width || layers.clientHeight !== height) stop();
  });
  function stop() {
    if (!active) return;
    active = false;
    observer.disconnect();
    preference.removeEventListener('change', preferenceChanged);
    dialog.removeAttribute('data-entering-from-wall');
    source.image.style.visibility = previousVisibility;
    movement.cancel();
    backdrop.cancel();
    tools.forEach((animation) => animation.cancel());
  }
  function preferenceChanged(event: MediaQueryListEvent) { if (event.matches) stop(); }
  observer.observe(layers);
  preference.addEventListener('change', preferenceChanged);
  void movement.finished.then(stop, stop);
  return stop;
}

