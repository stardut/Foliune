import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PhotoUnavailable } from '../components/PhotoImage';
import { canReadOriginal, originalReadUrl } from '../lib/photo-availability';
import type { Photo } from '../lib/types';

type Frame = { id: string; photo?: Photo; key: string; src?: string };
type ImageFrame = Frame & { photo: Photo; src: string };
type FrameStatus = 'ready' | 'error';
type DisplayedFrame = { frame: Frame; status: FrameStatus | 'thumbnail' };

const effects = ['dissolve', 'drift', 'settle'] as const;
type Transition = { outgoing: Frame; effect: typeof effects[number] };
const transitionDuration = 320;
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

function frameFor(id: string, photo: Photo | undefined, session: string): Frame {
  const src = photo && canReadOriginal(photo) ? originalReadUrl(photo, session) : undefined;
  return { id, photo, src, key: JSON.stringify([id, src, photo?.originalPath, photo?.originalAvailable, photo?.availability]) };
}

export function usePlayerPresentation(photos: ReadonlyMap<string, Photo>, order: string[], index: number, loop: boolean) {
  const [session] = useState(() => crypto.randomUUID());
  const reduced = useSyncExternalStore(subscribeToReducedMotion, prefersReducedMotion);
  const [decoded, setDecoded] = useState(new Map<string, FrameStatus>());
  function frameAt(position: number) {
    const id = order[position] ?? '';
    return frameFor(id, photos.get(id), session);
  }
  const requested = frameAt(index);
  const [displayed, setDisplayed] = useState<DisplayedFrame | null>(() => {
    const photo = requested.photo;
    return requested.src && photo?.thumbnailAvailable && photo.thumbnailUrl && photo.thumbnailUrl !== requested.src
      ? { frame: requested, status: 'thumbnail' } : null;
  });
  const [transition, setTransition] = useState<Transition | null>(null);
  const adjacent = [playerNeighbor(index, 1, order.length, loop), playerNeighbor(index, -1, order.length, loop)];
  const activeTransition = reduced ? null : transition;
  const frames = new Map<string, ImageFrame>();
  function keep(frame: Frame | undefined) {
    if (frame?.src && frame.photo && !frames.has(frame.key) && frames.size < 4) {
      frames.set(frame.key, { ...frame, photo: frame.photo, src: frame.src });
    }
  }
  if (displayed?.status === 'ready') keep(displayed.frame);
  keep(activeTransition?.outgoing);
  keep(requested);
  for (const position of adjacent) if (position !== null) keep(frameAt(position));

  const onDecoded = useCallback((key: string, status: FrameStatus) => {
    setDecoded((previous) => new Map(previous).set(key, status));
  }, []);
  function discardThumbnail(key: string) {
    setDisplayed((previous) => previous?.status === 'thumbnail' && previous.frame.key === key ? null : previous);
  }
  const targetStatus = requested.src ? decoded.get(requested.key) : 'error';
  useLayoutEffect(() => {
    // Results only belong to the actual mounted image elements.
    if ([...decoded.keys()].some((key) => !frames.has(key))) {
      setDecoded((previous) => new Map([...previous].filter(([key]) => frames.has(key))));
    }
    if (!targetStatus || (displayed?.frame.key === requested.key && displayed.status === targetStatus)) return;
    const outgoing = !reduced && displayed?.status === 'ready' && targetStatus === 'ready' ? displayed.frame : null;
    setTransition(outgoing ? { outgoing, effect: effects[Math.floor(Math.random() * effects.length)] } : null);
    setDisplayed({ frame: requested, status: targetStatus });
  });
  useEffect(() => {
    if (!activeTransition) return;
    const timer = setTimeout(() => setTransition(null), transitionDuration);
    return () => clearTimeout(timer);
  }, [activeTransition]);
  useEffect(() => { if (reduced) setTransition(null); }, [reduced]);

  return { displayed, requested, frames, transition: activeTransition, onDecoded, discardThumbnail };
}

export function PlayerFrames({ presentation, onRelink }: {
  presentation: ReturnType<typeof usePlayerPresentation>; onRelink: (photo: Photo) => Promise<void>;
}) {
  const { displayed, requested, frames, transition, onDecoded, discardThumbnail } = presentation;
  const thumbnail = displayed?.status === 'thumbnail' ? displayed.frame.photo : undefined;
  const waiting = requested.src && (displayed?.frame.key !== requested.key || displayed.status === 'thumbnail');
  return <>
    {[...frames.values()].map((frame) => {
      const current = displayed?.status === 'ready' && displayed.frame.key === frame.key;
      const outgoing = transition?.outgoing.key === frame.key;
      const role = current ? 'current' : outgoing ? 'outgoing' : 'prepared';
      return <div key={frame.key} className="player-frame" data-role={role} data-effect={current ? transition?.effect : undefined}
        aria-hidden={!current} inert={!current}>
        <PlayerFrameImage frame={frame} priority={frame.key === requested.key ? 'high' : 'low'} onDecoded={onDecoded} />
      </div>;
    })}
    {displayed && thumbnail && <div className="player-frame" data-role="current">
      <img src={thumbnail.thumbnailUrl} width={thumbnail.width} height={thumbnail.height} alt={thumbnail.title || thumbnail.originalName}
        draggable={false} onError={() => discardThumbnail(displayed.frame.key)} />
    </div>}
    {displayed?.status === 'error' && (displayed.frame.photo
      ? <div key={displayed.frame.key} className="player-frame image-asset image-unavailable" role="status"><PhotoUnavailable photo={displayed.frame.photo} onRelink={onRelink} /></div>
      : <p role="alert">此照片不在当前图库中</p>)}
    {waiting && <PlayerWaiting key={requested.key} />}
    <PlayerEntryVeil />
  </>;
}

function PlayerEntryVeil() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 280);
    return () => clearTimeout(timer);
  }, []);
  return visible && <div className="player-entry-veil" aria-hidden="true" />;
}

function PlayerWaiting() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, []);
  return visible && <span className="player-waiting" role="status"><span className="sr-only">正在准备照片</span></span>;
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
