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
  frameKey: string;
  seconds: number;
  onAdvance: (accent: boolean) => void;
}

/** Audio is the only clock in beat mode; timers sample it and never accumulate time. */
export function usePlayerClock({ audioRef, musicId, grid, playing, ready, frameKey, seconds, onAdvance }: PlayerClockOptions): void {
  const advance = useRef(onAdvance), readyRef = useRef(ready);
  const wake = useRef<(() => void) | null>(null);
  advance.current = onAdvance;
  readyRef.current = ready;
  useEffect(() => {
    if (!playing) return;
    const audio = audioRef.current;
    if (musicId && grid && !audio) return;
    const beatMode = Boolean(musicId && grid);
    let previous = audio?.currentTime ?? 0, loops = 0;
    let target: number | null = null, deadline: number | null = null;
    let fired = false, waitingForFrame = false, wasPaused = audio?.paused ?? false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule(delay = 20) { timer = setTimeout(sample, delay); }
    function sample() {
      if (timer !== undefined) clearTimeout(timer);
      if (fired) return;
      if (!beatMode) {
        if (!readyRef.current) return;
        if (deadline === null) deadline = Date.now() + seconds * 1000;
        const remaining = deadline - Date.now();
        if (remaining > 0) schedule(remaining);
        else { fired = true; advance.current(false); }
        return;
      }
      const position = audio!.currentTime;
      if (position < previous - .1) loops++;
      previous = position;
      const absolute = loops * grid!.duration + position;
      if (!readyRef.current) {
        waitingForFrame = true;
      } else if (audio!.paused) {
        wasPaused = true;
      } else if (!audio!.seeking && audio!.readyState >= 2) {
        if (target === null || wasPaused) {
          target = nextMusicAccent(grid!, absolute, seconds);
          wasPaused = false;
        }
        if (target !== null && absolute >= target) {
          if (waitingForFrame || absolute - target > .16) {
            // Resume at an upcoming real accent; never deliver a stale synchronized cut.
            target = nextMusicAccent(grid!, absolute, .08);
          } else { fired = true; advance.current(true); return; }
        }
        waitingForFrame = false;
      }
      schedule();
    }
    wake.current = sample;
    sample();
    return () => { if (timer !== undefined) clearTimeout(timer); wake.current = null; };
  }, [audioRef, musicId, grid, playing, frameKey, seconds]);
  // Readiness may change while the same frame is recomposed at another window size.
  // Wake the existing clock rather than restarting its target/deadline.
  useEffect(() => { wake.current?.(); }, [ready]);
}
