import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { readAppreciationPreferences, saveAppreciationPreferences, type AppreciationPreferences } from '../lib/appreciation-preferences';
import { pickMusic, releaseMusic, type MusicTrack } from '../lib/music-api';
import { analyzeMusicBeats, type BeatAnalysis } from '../lib/music-beats';
import { BUILTIN_MUSIC } from '../lib/player-music';

export type MusicSource = 'builtin' | 'local' | 'off';

export function useAppreciationSettings(onFeedback: (message: string, error?: boolean) => void) {
  const [preferences, setPreferences] = useState(readAppreciationPreferences);
  const [localMusic, setLocalMusic] = useState<readonly MusicTrack[]>([]);
  const [useLocalMusic, setUseLocalMusic] = useState(false);
  const [analysis, setAnalysis] = useState<ReadonlyMap<string, BeatAnalysis>>(new Map());
  const [picking, setPicking] = useState(false);
  const preferencesRef = useRef(preferences);
  const localRef = useRef<readonly MusicTrack[]>([]);
  const analysisRef = useRef(new Map<string, BeatAnalysis>());
  const analysisQueue = useRef(Promise.resolve());
  const importController = useRef<AbortController | null>(null);
  const feedback = useRef(onFeedback);
  feedback.current = onFeedback;
  const musicSource: MusicSource = !preferences.musicEnabled ? 'off' : useLocalMusic && localMusic.length ? 'local' : 'builtin';
  const playlist: readonly MusicTrack[] = musicSource === 'off' ? [] : musicSource === 'local' ? localMusic : BUILTIN_MUSIC;

  useEffect(() => () => {
    importController.current?.abort();
    const old = localRef.current;
    localRef.current = [];
    for (const track of old) void release(track);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // A cancelled decode may still be finishing; wait before decoding another whole file.
    analysisQueue.current = analysisQueue.current.then(async () => {
      for (const track of localMusic) {
        if (controller.signal.aborted) break;
        if (analysisRef.current.has(track.id)) continue;
        let result: BeatAnalysis;
        try { result = await analyzeMusicBeats(track.url, controller.signal); }
        catch (cause) {
          if (controller.signal.aborted) break;
          console.error('无法分析欣赏配乐：', cause);
          result = { status: 'fixed', reason: 'read-failed' };
        }
        if (controller.signal.aborted) break;
        analysisRef.current.set(track.id, result);
        setAnalysis(new Map(analysisRef.current));
      }
    });
    return () => controller.abort();
  }, [localMusic]);

  async function release(track: MusicTrack) {
    try { await releaseMusic(track.id); }
    catch (cause) { feedback.current(t(`清理欣赏配乐失败：${errorMessage(cause)}`, `Could not remove slideshow music: ${errorMessage(cause)}`), true); }
  }
  function change(patch: Partial<AppreciationPreferences>) {
    const next = { ...preferencesRef.current, ...patch };
    try { saveAppreciationPreferences(next); }
    catch { feedback.current(t('无法保存欣赏设置', 'Could not save slideshow settings.'), true); return false; }
    preferencesRef.current = next;
    setPreferences(next);
    return true;
  }
  function changeMusic(source: MusicSource) {
    if (source === 'local' && !localRef.current.length) return;
    if (!change({ musicEnabled: source !== 'off' })) return;
    if (source !== 'off') setUseLocalMusic(source === 'local');
  }
  async function chooseMusic() {
    if (importController.current) return;
    const controller = new AbortController();
    importController.current = controller;
    setPicking(true);
    try {
      const chosen = await pickMusic(controller.signal);
      if (controller.signal.aborted) {
        for (const track of chosen.tracks) await release(track);
        return;
      }
      if (chosen.tracks.length) {
        localRef.current = [...localRef.current, ...chosen.tracks];
        setLocalMusic(localRef.current);
        if (preferencesRef.current.musicEnabled || change({ musicEnabled: true })) setUseLocalMusic(true);
      }
      if (chosen.failures.length) feedback.current(t('音乐未能添加：', 'Could not add music: ') + chosen.failures.map(({ name, message }) => `${name}：${message}`).join('\n'), true);
    } catch (cause) { if (!controller.signal.aborted) feedback.current(errorMessage(cause), true); }
    finally {
      if (importController.current === controller) importController.current = null;
      if (!controller.signal.aborted) setPicking(false);
    }
  }
  function clearLocalMusic() {
    const old = localRef.current;
    localRef.current = [];
    setLocalMusic([]);
    setUseLocalMusic(false);
    analysisRef.current.clear();
    setAnalysis(new Map());
    for (const track of old) void release(track);
  }
  return { preferences, playlist, musicSource, localMusic, analysis, picking, change, changeMusic, chooseMusic, clearLocalMusic };
}
function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
