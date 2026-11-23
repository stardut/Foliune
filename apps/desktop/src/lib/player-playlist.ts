import type { MusicTrack } from './music-api';

/** Each round visits every usable track once; adjacent rounds never repeat a track. */
export function createPlayerPlaylist(tracks: readonly MusicTrack[]) {
  let remaining: MusicTrack[] = [];
  let previous: string | null = null;
  const failed = new Set<string>();
  return {
    fail(id: string) { failed.add(id); },
    next(): MusicTrack | null {
      while (true) {
        if (!remaining.length) {
          remaining = tracks.filter((track) => !failed.has(track.id));
          if (!remaining.length) return null;
          for (let i = remaining.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
          }
          const last = remaining.length - 1;
          if (last > 0 && remaining[last].id === previous) {
            const next = Math.floor(Math.random() * last);
            [remaining[last], remaining[next]] = [remaining[next], remaining[last]];
          }
        }
        const track = remaining.pop()!;
        if (failed.has(track.id)) continue;
        previous = track.id;
        return track;
      }
    },
  };
}
