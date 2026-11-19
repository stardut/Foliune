import { t } from '../lib/i18n';
import { presentModal } from '../lib/modal-stack';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { isTauri } from '@tauri-apps/api/core';
import { Busy } from '../components/ui';
import { PhotoUnavailable } from '../components/PhotoImage';
import type { Photo } from '../lib/types';
import type { MusicTrack } from '../lib/music-api';
import type { BeatAnalysis } from '../lib/music-beats';
import type { AppreciationPreferences } from '../lib/appreciation-preferences';
import { BUILTIN_MUSIC } from '../lib/player-music';
import { playerCompositionNeighbor, PlayerFrames, usePlayerPresentation } from './PlayerPresentation';
import { usePlayerClock } from './usePlayerClock';
import { useReviewFullscreen } from './use-review-fullscreen';
import './player.css';

export function PhotoPlayer({ photos, photoIds, preferences, music, analysis, onClose, onRelink, onFeedback }: {
  photos: Photo[]; photoIds: string[]; preferences: AppreciationPreferences; music: MusicTrack | null; analysis: BeatAnalysis | null;
  onClose: () => void; onRelink: (photo: Photo) => Promise<void>; onFeedback: (message: string, error?: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [native] = useState(isTauri);
  const [order] = useState(() => {
    const order = [...photoIds];
    if (preferences.random) {
      // Keep the entry photo; shuffle the remaining photos once per visit.
      for (let i = order.length - 1; i > 1; i--) {
        const j = 1 + Math.floor(Math.random() * i);
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    return order;
  });
  const [{ index, accent, direction }, setCursor] = useState({ index: 0, accent: false, direction: 1 as 1 | -1 });
  const requestedIndex = useRef(0);
  const [stageAspect, setStageAspect] = useState(() => {
    if (!native) return 0;
    const { width, height } = window.screen;
    const inset = width <= 700 ? 18 : Math.min(48, Math.max(20, width * .03));
    return (width - inset * 2) / (height - inset * 2);
  });
  const [playing, setPlaying] = useState(photoIds.length > 1);
  const [failedMusic, setFailedMusic] = useState<string | null>(null);
  const notices = useRef(new Map<string, string>());
  const { seconds, volume, loop } = preferences;
  const [entryReady, setEntryReady] = useState(!native);
  const [preparationVisible, setPreparationVisible] = useState(false);
  const screen = useReviewFullscreen(entryReady ? 'direct' : undefined, () => onClose());
  const [revealed, setRevealed] = useState(!native);
  const [leaving, setLeaving] = useState(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photosById = useMemo(() => new Map(photos.map((photo) => [photo.id, photo])), [photos]);
  const presentation = usePlayerPresentation(photosById, order, index, loop, { stageAspect, accent, direction, preloadAdjacent: entryReady });
  const { displayed, requestedVisible, compositions } = presentation;
  const stageVisible = revealed && !screen.transitioning && !leaving;
  const imageFailed = requestedVisible && displayed?.status === 'error';
  const preparationFailures = !entryReady ? presentation.requested.frames.filter((frame) => !frame.src || presentation.decoded.get(frame.key) === 'error') : [];
  const preparationFailed = preparationFailures.length > 0;
  const builtin = BUILTIN_MUSIC.find((track) => track.id === music?.id);
  const activeMusic = music?.id !== failedMusic ? music : null;
  const grid = activeMusic ? builtin?.grid ?? (analysis?.status === 'ready' ? analysis.grid : null) : null;

  const seek = useCallback((next: number, direction: 1 | -1 = 1, accent = false) => {
    requestedIndex.current = next;
    setCursor({ index: next, direction, accent });
  }, []);
  const canNavigate = compositions.length > 1;
  const advance = useCallback((direction: 1 | -1, accent = false) => {
    if (!canNavigate) return false;
    const next = playerCompositionNeighbor(compositions, requestedIndex.current, direction, loop);
    if (next === null) return false;
    setPlaying(true);
    seek(next, direction, accent);
    return true;
  }, [canNavigate, compositions, loop, seek]);
  const advanceOnClock = useCallback((accent: boolean) => {
    if (!advance(1, accent)) setPlaying(false);
  }, [advance]);
  usePlayerClock({
    audioRef: audio, musicId: activeMusic?.id ?? null, grid,
    playing: playing && canNavigate && stageVisible, ready: requestedVisible && displayed?.status === 'ready',
    frameKey: JSON.stringify([index, order[index]]), seconds, onAdvance: advanceOnClock,
  });

  useLayoutEffect(() => {
    if (native && (!entryReady || screen.transitioning || (!screen.fullscreen && !screen.error))) return;
    const element = stage.current!;
    const measure = () => setStageAspect(element.clientHeight ? element.clientWidth / element.clientHeight : 0);
    measure();
    const observer = new window.ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [native, entryReady, screen.fullscreen, screen.error, screen.transitioning]);
  useLayoutEffect(() => {
    if (requestedVisible && displayed?.status === 'ready') setEntryReady(true);
  }, [requestedVisible, displayed?.status]);
  useEffect(() => {
    if (entryReady) return;
    const timer = setTimeout(() => setPreparationVisible(true), 200);
    return () => clearTimeout(timer);
  }, [entryReady]);
  useLayoutEffect(() => {
    const element = stage.current!;
    const measuredAspect = element.clientHeight ? element.clientWidth / element.clientHeight : 0;
    // The completion render can still hold the old window's composition until
    // the measurement above commits. Reveal only a scene built for this size.
    if (entryReady && (!native || screen.fullscreen || screen.error) && !screen.transitioning && stageAspect > 0 && stageAspect === measuredAspect && requestedVisible) setRevealed(true);
  }, [native, entryReady, screen.fullscreen, screen.error, screen.transitioning, stageAspect, requestedVisible]);
  useLayoutEffect(() => {
    if (screen.transitioning || !screen.error) return;
    if (leaving && !screen.fullscreen) onClose();
    else setLeaving(false);
  }, [screen.transitioning, screen.error]);
  useLayoutEffect(() => {
    (stageVisible ? stage.current : dialog.current)?.focus({ preventScroll: true });
  }, [stageVisible]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const musicElement = audio.current;
    const dismissModal = presentModal(dialog.current!);
    (stageVisible ? stage.current : dialog.current)?.focus({ preventScroll: true });
    return () => {
      dismissModal();
      musicElement?.pause();
      if (exitTimer.current !== null) clearTimeout(exitTimer.current);
      previous?.focus();
      // Surface failures after returning, keeping the photo stage free of notifications.
      for (const message of notices.current.values()) onFeedback(message, true);
      notices.current.clear();
    };
  }, []);
  const musicRevealed = useRef(false);
  useLayoutEffect(() => {
    if (!audio.current) return;
    // Begin play in the original user activation, silently prepare through decode
    // and the native Space change, then start the audible track with the work.
    if (stageVisible && !musicRevealed.current) {
      audio.current.currentTime = 0;
      musicRevealed.current = true;
    }
    audio.current.volume = stageVisible ? volume : 0;
  }, [volume, stageVisible]);
  useLayoutEffect(() => {
    const element = audio.current!;
    if (!playing || !activeMusic || imageFailed || leaving) { element.pause(); return; }
    let active = true;
    void element.play().catch(() => {
      if (active) failMusic(t('欣赏配乐未能播放，已按设定时间切换照片。可在设置中更换配乐。', 'Slideshow music could not play. Photos used the selected timing. Choose another track in Settings.'));
    });
    return () => { active = false; };
  }, [playing, activeMusic, imageFailed, leaving]);

  function failMusic(message: string) {
    if (!music || notices.current.has(music.id)) return;
    console.error(message);
    notices.current.set(music.id, message);
    setFailedMusic(music.id);
  }
  function closePlayer() {
    if (leaving) return;
    const complete = () => { onClose(); return true; };
    if (!screen.fullscreen) { complete(); return; }
    flushSync(() => setLeaving(true));
    // Fade the photo and its mat back to the live album before native resizing.
    // Keep a bounded rendering handoff even without motion: Space changes can
    // suspend rAF, so neither exit path may depend on a frame or animation event.
    exitTimer.current = setTimeout(() => {
      exitTimer.current = null;
      if (!screen.exit(complete)) complete();
    }, !stageVisible || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 32 : 160);
  }
  return <dialog ref={dialog} className="photo-player" aria-label={t('照片欣赏', 'Photo Slideshow')} data-fullscreen={screen.fullscreen || undefined}
    onCancel={(event) => { event.preventDefault(); closePlayer(); }} onKeyDown={(event) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) closePlayer();
        return;
      }
      if (!stageVisible || event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); advance(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); advance(1); }
    }}>
    <div className="player-surface" data-visible={stageVisible}>
      <div ref={stage} className="player-stage" aria-hidden={!stageVisible} inert={!stageVisible}
        tabIndex={-1} role="group" aria-label={t('照片预览', 'Photo Preview')} aria-keyshortcuts="ArrowLeft ArrowRight Escape"><PlayerFrames presentation={presentation} onRelink={onRelink} /></div>
    </div>
    {!revealed && !leaving && (preparationVisible || preparationFailed) && <div className="player-preparation">
      {preparationFailed ? <div role="alert">{preparationFailures.map((frame) => frame.photo
        ? <PhotoUnavailable key={frame.key} photo={frame.photo} onRelink={onRelink} />
        : <p key={frame.key}>{t('此照片不在当前图库中', 'This photo is unavailable in the current library')}</p>)}</div>
        : <Busy label={t('正在准备照片…', 'Preparing photos…')} />}
      <button type="button" className="player-preparation-cancel" onClick={closePlayer}>{t('取消', 'Cancel')}</button>
    </div>}
    {screen.error && <p className="player-fullscreen-error" role="alert">{screen.error} {screen.fullscreen
      ? t('按 Escape 重试退出。', 'Press Escape to retry leaving full screen.')
      : t('按 Escape 返回。', 'Press Escape to return.')}</p>}
    <audio ref={audio} src={activeMusic?.url} loop onError={() => failMusic(t('欣赏配乐无法读取或格式不受支持，已按设定时间切换照片。可在设置中更换配乐。', 'Slideshow music could not be read or is unsupported. Photos used the selected timing. Choose another track in Settings.'))} />
  </dialog>;
}
