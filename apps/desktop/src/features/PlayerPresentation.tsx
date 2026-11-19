import { t } from '../lib/i18n';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { PhotoUnavailable } from '../components/PhotoImage';
import { canReadOriginal, originalReadUrl } from '../lib/photo-availability';
import type { Photo } from '../lib/types';

type Frame = { id: string; photo?: Photo; key: string; src?: string };
type ImageFrame = Frame & { photo: Photo; src: string };
type FrameStatus = 'ready' | 'error';
export type PlayerComposition = { start: number; end: number };
type Scene = PlayerComposition & { anchorId: string; key: string; frame: Frame; frames: Frame[] };
type DisplayedScene = Scene & { status: FrameStatus | 'thumbnail' };
type Transition = { outgoing: Scene; effect: 'dissolve' | 'gather' | 'glide'; duration: number; direction: number };
type PresentationOptions = { stageAspect?: number; accent?: boolean; direction?: number; preloadAdjacent?: boolean };
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(callback: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
function prefersReducedMotion() { return window.matchMedia(reducedMotionQuery).matches; }

export function playerNeighbor(index: number, direction: number, length: number, loop: boolean) {
  const next = index + direction;
  if (next >= 0 && next < length) return next;
  return loop && length > 0 ? (next + length) % length : null;
}

function portraitRatio(photo: Photo | undefined) {
  return photo && photo.width > 0 && photo.height > 0 && photo.width / photo.height < .9
    ? photo.width / photo.height : null;
}

/** Partition the existing browsing order; the last group never borrows from the beginning. */
export function buildPlayerCompositions(photos: ReadonlyMap<string, Photo>, order: string[], stageAspect: number): PlayerComposition[] {
  const scenes: PlayerComposition[] = [];
  let start = 0;
  let portraitEnd = 0;
  while (start < order.length) {
    let count = 1;
    if (stageAspect >= 1.12 && portraitRatio(photos.get(order[start])) !== null) {
      if (portraitEnd <= start) {
        portraitEnd = start;
        while (portraitEnd < order.length && portraitRatio(photos.get(order[portraitEnd])) !== null) portraitEnd++;
      }
      const remaining = portraitEnd - start;
      const candidates = stageAspect >= 1.45 && remaining !== 4 ? [3, 2] : [2];
      for (const candidate of candidates) {
        if (remaining < candidate) continue;
        let ratio = 0;
        for (let offset = 0; offset < candidate; offset++) ratio += portraitRatio(photos.get(order[start + offset]))!;
        // Keep the common image height at least ~80% of the available stage height.
        if ((ratio + .035 * (candidate - 1)) / stageAspect <= 1.25) { count = candidate; break; }
      }
    }
    scenes.push({ start, end: start + count - 1 });
    start += count;
  }
  return scenes;
}

export function playerCompositionNeighbor(compositions: PlayerComposition[], index: number, direction: number, loop: boolean) {
  const current = compositions.findIndex((scene) => index >= scene.start && index <= scene.end);
  const next = playerNeighbor(current, direction, compositions.length, loop);
  return next === null ? null : compositions[next]?.start ?? null;
}

function frameFor(id: string, photo: Photo | undefined, session: string, occurrence = 0): Frame {
  const src = photo && canReadOriginal(photo) ? originalReadUrl(photo, session) : undefined;
  return { id, photo, src, key: JSON.stringify([id, occurrence, src, photo?.originalPath, photo?.originalAvailable, photo?.availability]) };
}

export function usePlayerPresentation(photos: ReadonlyMap<string, Photo>, order: string[], index: number, loop: boolean,
  { stageAspect = 0, accent = false, direction = 1, preloadAdjacent = true }: PresentationOptions = {}) {
  const [session] = useState(() => crypto.randomUUID());
  const reduced = useSyncExternalStore(subscribeToReducedMotion, prefersReducedMotion);
  const [decoded, setDecoded] = useState(new Map<string, FrameStatus>());
  const compositions = useMemo(() => buildPlayerCompositions(photos, order, stageAspect), [photos, order, stageAspect]);
  const occurrences = useMemo(() => {
    // A saved photo book can use the same photo on more than one page.
    const counts = new Map<string, number>();
    return order.map((id) => {
      const count = counts.get(id) ?? 0;
      counts.set(id, count + 1);
      return count;
    });
  }, [order]);
  function sceneAt(position: number): Scene {
    const range = compositions.find((scene) => position >= scene.start && position <= scene.end) ?? { start: position, end: position };
    const frames = order.slice(range.start, range.end + 1).map((id, offset) => frameFor(id, photos.get(id), session, occurrences[range.start + offset]));
    if (!frames.length) frames.push(frameFor('', undefined, session));
    const frame = frames[0];
    return { ...range, anchorId: order[position] ?? '', frames, frame, key: JSON.stringify([range.start, ...frames.map((item) => item.key)]) };
  }
  const requested = sceneAt(index);
  const [displayed, setDisplayed] = useState<DisplayedScene | null>(() => {
    const photo = requested.frame.photo;
    return requested.frames.length === 1 && requested.frame.src && photo?.thumbnailAvailable && photo.thumbnailUrl && photo.thumbnailUrl !== requested.frame.src
      ? { ...requested, status: 'thumbnail' } : null;
  });
  const [transition, setTransition] = useState<Transition | null>(null);
  const activeTransition = reduced ? null : transition;
  const adjacent = [playerCompositionNeighbor(compositions, index, 1, loop), playerCompositionNeighbor(compositions, index, -1, loop)];
  const frames = new Map<string, ImageFrame>();
  const capacity = Math.max(4, requested.frames.length * 4, (displayed?.frames.length ?? 0) * 4, (activeTransition?.outgoing.frames.length ?? 0) * 4);
  function keep(scene: Scene | undefined | null) {
    for (const frame of scene?.frames ?? []) {
      if (frame.src && frame.photo && !frames.has(frame.key) && frames.size < capacity) {
        frames.set(frame.key, { ...frame, photo: frame.photo, src: frame.src });
      }
    }
  }
  keep(displayed);
  keep(requested);
  keep(activeTransition?.outgoing);
  if (preloadAdjacent) for (const position of adjacent) if (position !== null) keep(sceneAt(position));

  const onDecoded = useCallback((key: string, status: FrameStatus) => {
    setDecoded((previous) => previous.get(key) === status ? previous : new Map(previous).set(key, status));
  }, []);
  function discardThumbnail(key: string) {
    setDisplayed((previous) => previous?.status === 'thumbnail' && previous.frame.key === key ? null : previous);
  }
  const statuses = requested.frames.map((frame) => frame.src ? decoded.get(frame.key) : 'error');
  const targetStatus = statuses.every(Boolean) ? (statuses.includes('error') ? 'error' : 'ready') : undefined;
  useLayoutEffect(() => {
    if ([...decoded.keys()].some((key) => !frames.has(key))) {
      setDecoded((previous) => new Map([...previous].filter(([key]) => frames.has(key))));
    }
    if (!targetStatus || (displayed?.key === requested.key && displayed.status === targetStatus)) return;
    // Resizing a composition keeps its anchor and does not replay a scene transition.
    const changedAnchor = displayed?.anchorId !== requested.anchorId;
    const outgoing = !reduced && changedAnchor && displayed?.status === 'ready' && targetStatus === 'ready' ? displayed : null;
    const targetPhoto = requested.frame.photo;
    const wideSingle = requested.frames.length === 1 && targetPhoto && targetPhoto.width / targetPhoto.height >= 1.65;
    const effect = outgoing?.frames.length !== requested.frames.length ? 'gather'
      : requested.frames.length > 1 || wideSingle ? 'glide' : 'dissolve';
    setTransition(outgoing ? { outgoing, effect, duration: accent ? 150 : 320, direction } : null);
    setDisplayed({ ...requested, status: targetStatus });
  });
  useEffect(() => {
    if (!activeTransition) return;
    const timer = setTimeout(() => setTransition(null), activeTransition.duration);
    return () => clearTimeout(timer);
  }, [activeTransition]);
  useEffect(() => { if (reduced) setTransition(null); }, [reduced]);

  const requestedVisible = displayed?.key === requested.key && displayed.status !== 'thumbnail';
  const displayedRange = displayed ? { start: displayed.start, end: displayed.end } : null;
  return { displayed, requested, frames, transition: activeTransition, onDecoded, discardThumbnail, compositions, requestedVisible, displayedRange, decoded };
}

function placement(scene: Scene, key: string): CSSProperties {
  const ratios = scene.frames.map((frame) => frame.photo && frame.photo.width > 0 && frame.photo.height > 0 ? frame.photo.width / frame.photo.height : 1);
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const position = scene.frames.findIndex((frame) => frame.key === key);
  const leading = ratios.slice(0, position).reduce((sum, ratio) => sum + ratio, 0) / total;
  const width = ratios[position] / total;
  const gaps = scene.frames.length - 1;
  const groupWidth = `min(100cqw, calc(100cqh * ${total} + var(--player-gap) * ${gaps}))`;
  const imageWidth = `(${groupWidth} - var(--player-gap) * ${gaps})`;
  return {
    width: `calc(${imageWidth} * ${width})`,
    left: `calc((100% - ${groupWidth}) / 2 + ${imageWidth} * ${leading} + var(--player-gap) * ${position})`,
    '--player-slot': position - gaps / 2,
  } as CSSProperties;
}

export function PlayerFrames({ presentation, onRelink }: {
  presentation: ReturnType<typeof usePlayerPresentation>; onRelink: (photo: Photo) => Promise<void>;
}) {
  const { displayed, requested, frames, transition, onDecoded, discardThumbnail, decoded } = presentation;
  const thumbnail = displayed?.status === 'thumbnail' ? displayed.frame.photo : undefined;
  const waiting = requested.frames.some((frame) => frame.src) && (displayed?.key !== requested.key || displayed.status === 'thumbnail');
  const transitionStyle = transition ? { '--player-transition': `${transition.duration}ms`, '--player-direction': transition.direction } as CSSProperties : {};
  return <>
    {[...frames.values()].map((frame) => {
      const current = displayed?.status !== 'thumbnail' && displayed?.frames.some((item) => item.key === frame.key);
      const outgoing = transition?.outgoing.frames.some((item) => item.key === frame.key);
      const role = current ? 'current' : outgoing ? 'outgoing' : 'prepared';
      const scene = current ? displayed! : outgoing ? transition!.outgoing : requested;
      const failed = current && decoded.get(frame.key) === 'error';
      return <div key={frame.key} className={`player-frame${failed ? ' image-asset image-unavailable' : ''}`} data-role={role}
        data-effect={current ? transition?.effect : undefined} style={{ ...(role !== 'prepared' ? placement(scene, frame.key) : {}), ...transitionStyle }}
        aria-hidden={!current} inert={!current}>
        <PlayerFrameImage frame={frame} priority={requested.frames.some((item) => item.key === frame.key) ? 'high' : 'low'} onDecoded={onDecoded} />
        {failed && <PhotoUnavailable photo={frame.photo} onRelink={onRelink} />}
      </div>;
    })}
    {displayed && thumbnail && <div className="player-frame" data-role="current">
      <img src={thumbnail.thumbnailUrl} width={thumbnail.width} height={thumbnail.height} alt={thumbnail.title || thumbnail.originalName}
        draggable={false} onError={() => discardThumbnail(displayed.frame.key)} />
    </div>}
    {displayed?.status === 'error' && displayed.frames.filter((frame) => !frame.src).map((frame) => frame.photo
      ? <div key={frame.key} className="player-frame image-asset image-unavailable" style={placement(displayed, frame.key)} role="status"><PhotoUnavailable photo={frame.photo} onRelink={onRelink} /></div>
      : <p key={frame.key} role="alert">{t('此照片不在当前图库中', 'This photo is unavailable in the current library')}</p>)}
    {waiting && <PlayerWaiting key={requested.key} />}
  </>;
}

function PlayerWaiting() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, []);
  return visible && <span className="player-waiting" role="status"><span className="sr-only">{t('正在准备照片', 'Preparing photo')}</span></span>;
}

function PlayerFrameImage({ frame, priority, onDecoded }: {
  frame: ImageFrame; priority: 'high' | 'low'; onDecoded: (key: string, status: FrameStatus) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const element = image.current!;
    let mounted = true;
    void element.decode().then(
      () => { if (mounted) onDecoded(frame.key, element.naturalWidth > 0 ? 'ready' : 'error'); },
      () => { if (mounted) onDecoded(frame.key, 'error'); },
    );
    return () => { mounted = false; };
  }, [frame.key, onDecoded]);
  const { photo } = frame;
  return <img ref={image} src={frame.src} width={photo.width} height={photo.height}
    alt={photo.title || photo.originalName} decoding="async" fetchPriority={priority} draggable={false} />;
}
