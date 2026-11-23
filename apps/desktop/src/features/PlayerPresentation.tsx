import { t } from '../lib/i18n';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { PhotoUnavailable } from '../components/PhotoImage';
import { canReadOriginal, originalReadUrl } from '../lib/photo-availability';
import type { Photo } from '../lib/types';
import { photoPreloadOffsets } from '../lib/photo-preload';
import { neutralPlayerEdges, neutralPlayerMat, playerMatColors, reportPlayerMatFailure, samplePlayerMat, type PlayerEdges, type PlayerMatSample, type PlayerMatTexture } from './player-mat';

type Frame = { id: string; photo?: Photo; key: string; src?: string };
type ImageFrame = Frame & { photo: Photo; src: string };
type FrameStatus = 'ready' | 'error';
type DecodedFrame = PlayerMatSample & { status: FrameStatus; width: number; height: number };
export type PlayerComposition = { start: number; end: number };
type Scene = PlayerComposition & { fit: 'contain' | 'cover'; key: string; frame: Frame; frames: Frame[] };
type DisplayedScene = Scene & { status: FrameStatus | 'thumbnail' };
type PresentationOptions = { stageAspect?: number; groupPortraits?: boolean; preferFill?: boolean; preloadAdjacent?: boolean; direction?: number };

export function playerNeighbor(index: number, direction: number, length: number, loop: boolean) {
  const next = index + direction;
  if (next >= 0 && next < length) return next;
  return loop && length > 0 ? ((next % length) + length) % length : null;
}

function photoAspect(photo: Pick<Photo, 'width' | 'height'> | undefined) {
  if (!photo || !(photo.width > 0 && photo.height > 0)) return null;
  const ratio = photo.width / photo.height;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

export function playerPhotoFit(photo: Pick<Photo, 'width' | 'height'> | undefined, stageAspect: number, preferFill: boolean): 'contain' | 'cover' {
  const ratio = photoAspect(photo);
  if (!preferFill || ratio === null || !Number.isFinite(stageAspect) || stageAspect <= 0) return 'contain';
  const retainedArea = Math.min(ratio, stageAspect) / Math.max(ratio, stageAspect);
  // Only absorb floating-point rounding at the inclusive 7% area-loss boundary.
  return retainedArea >= .93 - Number.EPSILON * 2 ? 'cover' : 'contain';
}

function portraitRatio(photo: Photo | undefined) {
  const ratio = photoAspect(photo);
  return ratio !== null && ratio < .9 ? ratio : null;
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
        // Three pictures should retain almost the full height; prefer a pair over letterboxing.
        const minimumHeight = candidate === 3 ? .88 : .8;
        if (ratio / stageAspect <= 1 / minimumHeight) { count = candidate; break; }
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
  { stageAspect = 0, preloadAdjacent = true, preferFill = false, groupPortraits = false, direction = 0 }: PresentationOptions = {}) {
  const [session] = useState(() => crypto.randomUUID());
  const [decoded, setDecoded] = useState(new Map<string, DecodedFrame>());
  const compositions = useMemo(() => groupPortraits ? buildPlayerCompositions(photos, order, stageAspect)
    : order.map((_, index) => ({ start: index, end: index })), [photos, order, stageAspect, groupPortraits]);
  const occurrences = useMemo(() => {
    // A saved photo book can use the same photo on more than one page.
    const counts = new Map<string, number>();
    return order.map((id) => {
      const count = counts.get(id) ?? 0;
      counts.set(id, count + 1);
      return count;
    });
  }, [order]);
  function sceneAt(range: PlayerComposition): Scene {
    const frames = order.slice(range.start, range.end + 1).map((id, offset) => frameFor(id, photos.get(id), session, occurrences[range.start + offset]));
    if (!frames.length) frames.push(frameFor('', undefined, session));
    const frame = frames[0];
    const fit = frames.length === 1 && frame.src && decoded.get(frame.key)?.status !== 'error'
      ? playerPhotoFit(decoded.get(frame.key), stageAspect, preferFill) : 'contain';
    return { ...range, fit, frames, frame, key: JSON.stringify([range.start, fit, ...frames.map((item) => item.key)]) };
  }
  const compositionIndex = compositions.findIndex((scene) => index >= scene.start && index <= scene.end);
  const requested = sceneAt(compositions[compositionIndex] ?? { start: index, end: index });
  const [displayed, setDisplayed] = useState<DisplayedScene | null>(() => {
    const photo = requested.frame.photo;
    return requested.frames.length === 1 && requested.frame.src && photo?.thumbnailAvailable && photo.thumbnailUrl && photo.thumbnailUrl !== requested.frame.src
      ? { ...requested, status: 'thumbnail' } : null;
  });
  const nextPosition = playerNeighbor(compositionIndex, 1, compositions.length, loop);
  const nextScene = nextPosition === null ? null : sceneAt(compositions[nextPosition]);
  const nextReady = !nextScene || nextScene.frames.every((frame) => !frame.src || decoded.has(frame.key));
  const adjacent = [...new Set(photoPreloadOffsets(direction)
    .map((offset) => playerNeighbor(compositionIndex, offset, compositions.length, loop)))]
    .filter((position): position is number => position !== null && position !== compositionIndex)
    .map((position) => position === nextPosition ? nextScene! : sceneAt(compositions[position]));
  const frames = new Map<string, ImageFrame>();
  function keep(scene: Scene | undefined | null) {
    for (const frame of scene?.frames ?? []) {
      if (frame.src && frame.photo && !frames.has(frame.key)) {
        frames.set(frame.key, { ...frame, photo: frame.photo, src: frame.src });
      }
    }
  }
  keep(displayed);
  keep(requested);
  if (preloadAdjacent) for (const scene of adjacent) keep(scene);

  const onDecoded = useCallback((key: string, result: DecodedFrame) => {
    setDecoded((previous) => previous.get(key)?.status === result.status ? previous : new Map(previous).set(key, result));
  }, []);
  function discardThumbnail(key: string) {
    setDisplayed((previous) => previous?.status === 'thumbnail' && previous.frame.key === key ? null : previous);
  }
  const statuses = requested.frames.map((frame) => frame.src ? decoded.get(frame.key)?.status : 'error');
  const targetStatus = statuses.every(Boolean) ? (statuses.includes('error') ? 'error' : 'ready') : undefined;
  useLayoutEffect(() => {
    if ([...decoded.keys()].some((key) => !frames.has(key))) {
      setDecoded((previous) => new Map([...previous].filter(([key]) => frames.has(key))));
    }
    if (!targetStatus || (displayed?.key === requested.key && displayed.status === targetStatus)) return;
    setDisplayed({ ...requested, status: targetStatus });
  });
  const requestedVisible = displayed?.key === requested.key && displayed.status !== 'thumbnail';
  const displayedRange = displayed ? { start: displayed.start, end: displayed.end } : null;
  return { displayed, requested, frames, nextReady, onDecoded, discardThumbnail, compositions, requestedVisible, displayedRange, decoded };
}

function sceneGeometry(scene: Scene) {
  const ratios = scene.frames.map((frame) => photoAspect(frame.photo) ?? 1);
  const total = ratios.reduce((sum, ratio) => sum + ratio, 0);
  const gaps = scene.frames.length - 1;
  const width = `min(100cqw, calc(100cqh * ${total} + var(--player-gap) * ${gaps}))`;
  const imageWidth = `(${width} - var(--player-gap) * ${gaps})`;
  const height = `(${imageWidth} / ${total})`;
  const left = `((100% - ${width}) / 2)`;
  const top = `((100% - ${height}) / 2)`;
  return { ratios, total, gaps, imageWidth, height, left, top };
}

function placement(scene: Scene, key: string): CSSProperties {
  if (scene.fit === 'cover') return { width: '100%', left: 0 };
  const { ratios, total, imageWidth, left } = sceneGeometry(scene);
  const position = scene.frames.findIndex((frame) => frame.key === key);
  const leading = ratios.slice(0, position).reduce((sum, ratio) => sum + ratio, 0) / total;
  return {
    width: `calc(${imageWidth} * ${ratios[position] / total})`,
    left: `calc(${left} + ${imageWidth} * ${leading} + var(--player-gap) * ${position})`,
  };
}

function PlayerMatTextureCanvas({ texture, style }: { texture: PlayerMatTexture; style: CSSProperties }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const element = canvas.current!;
    element.width = texture.width; element.height = texture.height;
    try {
      const context = element.getContext('2d');
      if (!context) throw new Error('欣赏材质画布不可用');
      const image = context.createImageData(texture.width, texture.height);
      image.data.set(texture.pixels);
      context.putImageData(image, 0, 0);
    } catch (cause) { reportPlayerMatFailure(cause); }
    return () => { element.width = 0; element.height = 0; };
  }, [texture]);
  return <canvas ref={canvas} width={texture.width} height={texture.height} style={style} />;
}

function PlayerMat({ scene, samples }: {
  scene: Scene; samples: Map<string, DecodedFrame>;
}) {
  if (scene.fit === 'cover') return null;
  const { ratios, total, gaps, imageWidth, height, left, top } = sceneGeometry(scene);
  const colors = playerMatColors(scene.frames.map((frame, index) => ({ edges: samples.get(frame.key)?.edges ?? neutralPlayerEdges, ratio: ratios[index] })));
  const rgb = (edge: keyof PlayerEdges) => `rgb(${colors[edge].join(' ')})`;
  const frost = scene.frames.map(frame => samples.get(frame.key)?.frost).find(Boolean);
  // A contain-fit group touches either the horizontal or vertical bounds.
  // Four sized backgrounds cover only its whitespace, remaining transparent
  // behind the photographs; the scene commits its mat and photos together.
  return <>
    <div className="player-mat" data-role="current" aria-hidden="true" style={{
      backgroundImage: `linear-gradient(90deg, #0c0d0e, ${rgb('left')}), linear-gradient(270deg, #0c0d0e, ${rgb('right')}), linear-gradient(180deg, #0c0d0e, ${rgb('top')}), linear-gradient(0deg, #0c0d0e, ${rgb('bottom')})`,
      backgroundSize: `calc(${left}) 100%, calc(${left}) 100%, 100% calc(${top}), 100% calc(${top})`,
      backgroundPosition: 'left center, right center, center top, center bottom', backgroundRepeat: 'no-repeat',
    }}>
      {(['left', 'right', 'top', 'bottom'] as const).map((edge) => {
        const vertical = edge === 'left' || edge === 'right';
        const selection = vertical ? [edge === 'left' ? 0 : scene.frames.length - 1] : scene.frames.map((_, index) => index);
        const position: CSSProperties = vertical
          ? { width: `calc(${left})`, height: '100%', top: 0, [edge]: 0 }
          : { width: '100%', height: `calc(${top})`, left: 0, [edge]: 0 };
        return <div key={edge} className="player-mat-wing" data-edge={edge} style={{ ...position, '--player-frost': frost ? `url("${frost}")` : 'none' } as CSSProperties}>
          <div className="player-mat-textures">{selection.map((index) => {
            const texture = samples.get(scene.frames[index].key)?.textures?.[edge];
            if (!texture) return null;
            const leading = vertical ? 0 : ratios.slice(0, index).reduce((sum, ratio) => sum + ratio, 0) / total;
            return <PlayerMatTextureCanvas key={scene.frames[index].key} texture={texture} style={{ left: `${leading * 100}%`, width: `${vertical ? 100 : ratios[index] / total * 100}%` }} />;
          })}</div>
        </div>;
      })}
    </div>
    {Array.from({ length: gaps }, (_, position) => {
      const leading = ratios.slice(0, position + 1).reduce((sum, ratio) => sum + ratio, 0) / total;
      return <div key={position} className="player-seam" data-role="current" aria-hidden="true" style={{
        left: `calc(${left} + ${imageWidth} * ${leading} + var(--player-gap) * ${position})`,
        top: `calc(${top})`, height: `calc(${height})`,
      }} />;
    })}
  </>;
}

export function PlayerFrames({ presentation, onRelink }: {
  presentation: ReturnType<typeof usePlayerPresentation>; onRelink: (photo: Photo) => Promise<void>;
}) {
  const { displayed, requested, frames, onDecoded, discardThumbnail, decoded } = presentation;
  const thumbnail = displayed?.status === 'thumbnail' ? displayed.frame.photo : undefined;
  const waiting = requested.frames.some((frame) => frame.src) && (displayed?.key !== requested.key || displayed.status === 'thumbnail');
  return <>
    {displayed && <PlayerMat scene={displayed} samples={decoded} />}
    {[...frames.values()].map((frame) => {
      const current = displayed?.status !== 'thumbnail' && displayed?.frames.some((item) => item.key === frame.key);
      const role = current ? 'current' : 'prepared';
      const scene = current ? displayed! : requested;
      const failed = current && decoded.get(frame.key)?.status === 'error';
      return <div key={frame.key} className={`player-frame${failed ? ' image-asset image-unavailable' : ''}`} data-role={role}
        data-fit={current ? scene.fit : undefined} style={current ? placement(scene, frame.key) : undefined}
        aria-hidden={!current} inert={!current}>
        <PlayerFrameImage frame={frame} priority={requested.frames.some((item) => item.key === frame.key) ? 'high' : 'low'} onDecoded={onDecoded} />
        {failed && <PhotoUnavailable photo={frame.photo} onRelink={onRelink} />}
      </div>;
    })}
    {displayed && thumbnail && <div className="player-frame" data-role="current" data-fit={displayed.fit}>
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
  frame: ImageFrame; priority: 'high' | 'low'; onDecoded: (key: string, result: DecodedFrame) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const element = image.current!;
    let mounted = true;
    void element.decode().then(
      () => {
        if (!mounted) return;
        const width = element.naturalWidth, height = element.naturalHeight;
        const ready = width > 0;
        onDecoded(frame.key, { ...(ready ? samplePlayerMat(element) : neutralPlayerMat), status: ready ? 'ready' : 'error', width, height });
      },
      () => { if (mounted) onDecoded(frame.key, { ...neutralPlayerMat, status: 'error', width: 0, height: 0 }); },
    );
    return () => { mounted = false; };
  }, [frame.key, onDecoded]);
  const { photo } = frame;
  return <img ref={image} src={frame.src} width={photo.width} height={photo.height}
    alt={photo.title || photo.originalName} crossOrigin="anonymous" decoding="async" fetchPriority={priority} draggable={false} />;
}
