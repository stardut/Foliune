import { useEffect, useRef, type RefObject } from 'react';
import type { MusicBeatGrid } from '../lib/music-beats';

/** Next bar accent close to the requested dwell, including the following audio loop. */
export function nextMusicAccent(grid: MusicBeatGrid, now: number, seconds: number): number | null {
  if (grid.duration <= 0 || !grid.downbeats.length) return null;
  const earliest = now + seconds * .6, desired = now + seconds;
  const cycle = Math.floor(earliest / grid.duration);
  let target: number | null = null;
  const finalCycle = Math.ceil((desired + grid.duration) / grid.duration);
  for (let loop = cycle; loop <= finalCycle; loop++) {
    for (const beat of grid.downbeats) {
      const candidate = loop * grid.duration + beat;
      if (candidate < earliest) continue;
      if (target === null || Math.abs(candidate - desired) < Math.abs(target - desired)) target = candidate;
    }
  }
  return target;
}

interface PlayerClockOptions {
  audioRef: RefObject<HTMLAudioElement | null>;
  musicId: string | null;
  grid: MusicBeatGrid | null;
  playing: boolean;
  ready: boolean;
  nextReady: boolean;
  frameKey: string;
  seconds: number;
  onAdvance: () => void;
}

/** Audio is the only clock in beat mode; timers sample it and never accumulate time. */
export function usePlayerClock({ audioRef, musicId, grid, playing, ready, nextReady, frameKey, seconds, onAdvance }: PlayerClockOptions): void {
  const advance = useRef(onAdvance), readyRef = useRef(ready), nextReadyRef = useRef(nextReady);
  const sourceRef = useRef({ musicId, grid });
  const wake = useRef<(() => void) | null>(null);
  advance.current = onAdvance;
  readyRef.current = ready;
  nextReadyRef.current = nextReady;
  sourceRef.current = { musicId, grid };
  useEffect(() => {
    if (!playing) return;
    const audio = audioRef.current;
    let source = sourceRef.current;
    let beatMode = Boolean(source.musicId && source.grid?.downbeats.length && audio);
    let previous = audio?.currentTime ?? 0, loops = 0;
    let target: number | null = null;
    let elapsed = 0, started = false, sourceStarted = false, wallTime = Date.now();
    let fired = false, waitingForFrame = false, wasPaused = audio?.paused ?? false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule(delay = 20) { timer = setTimeout(sample, delay); }
    function sample() {
      if (timer !== undefined) clearTimeout(timer);
      if (fired) return;
      const currentSource = sourceRef.current;
      if (source.musicId !== currentSource.musicId || source.grid !== currentSource.grid) {
        // A song change replaces only its accent target, never the photo's dwell.
        if (!beatMode && started) elapsed += (Date.now() - wallTime) / 1000;
        source = currentSource;
        beatMode = Boolean(source.musicId && source.grid?.downbeats.length && audio);
        previous = audio?.currentTime ?? 0;
        loops = 0;
        target = null;
        wasPaused = false;
        sourceStarted = false;
        wallTime = Date.now();
      }
      if (!beatMode) {
        if (!readyRef.current) return;
        if (started) elapsed += (Date.now() - wallTime) / 1000;
        started = true;
        wallTime = Date.now();
        const remaining = (seconds - elapsed) * 1000;
        if (remaining > 0) schedule(remaining);
        else { fired = true; advance.current(); }
        return;
      }
      const grid = source.grid!;
      const position = audio!.currentTime;
      const looped = sourceStarted && position < previous - .1;
      if (looped) loops++;
      if (started && sourceStarted && !wasPaused) elapsed += Math.max(0, position - previous + (looped ? grid.duration : 0));
      previous = position;
      const absolute = loops * grid.duration + position;
      if (!readyRef.current) {
        waitingForFrame = true;
      } else if (audio!.paused && !audio!.ended) {
        if (sourceStarted) wasPaused = true;
      } else if (!audio!.seeking && audio!.readyState >= 2) {
        sourceStarted = true;
        if (!started || wasPaused) {
          elapsed = 0;
          started = true;
        }
        if (target === null || wasPaused) {
          target = nextMusicAccent(grid, absolute, Math.max(.08, seconds - elapsed));
          wasPaused = false;
        }
        if (target !== null && absolute >= target) {
          if (!nextReadyRef.current || waitingForFrame || absolute - target > .16) {
            // Wait for a decoded target or the next real accent; never deliver a stale cut.
            target = nextMusicAccent(grid, absolute, .08);
          } else { fired = true; advance.current(); return; }
        }
        waitingForFrame = false;
      }
      schedule();
    }
    wake.current = sample;
    audio?.addEventListener('ended', sample);
    sample();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      audio?.removeEventListener('ended', sample);
      wake.current = null;
    };
  }, [audioRef, playing, frameKey, seconds]);
  // Readiness may change while the same frame is recomposed at another window size.
  // Wake the existing clock rather than restarting its target/deadline.
  useEffect(() => { wake.current?.(); }, [ready, nextReady, musicId, grid]);
}
