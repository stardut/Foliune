import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { readAppreciationPreferences, saveAppreciationPreferences, type AppreciationPreferences } from '../lib/appreciation-preferences';
import { pickMusic, releaseMusic, type MusicTrack } from '../lib/music-api';
import { analyzeMusicBeats, type BeatAnalysis } from '../lib/music-beats';
import { BUILTIN_MUSIC } from '../lib/player-music';

export function useAppreciationSettings(onFeedback: (message: string, error?: boolean) => void) {
  const [preferences, setPreferences] = useState(readAppreciationPreferences);
  const [localMusic, setLocalMusic] = useState<MusicTrack | null>(null);
  const [analysisState, setAnalysis] = useState<{ id: string; result: BeatAnalysis } | null>(null);
  const [picking, setPicking] = useState(false);
  const localRef = useRef<MusicTrack | null>(null);
  const alive = useRef(true);
  const feedback = useRef(onFeedback);
  feedback.current = onFeedback;
  const music = localMusic ?? BUILTIN_MUSIC.find((track) => track.id === preferences.musicId) ?? null;
  const analysis = analysisState?.id === localMusic?.id ? analysisState?.result ?? null : null;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const old = localRef.current;
      localRef.current = null;
      if (old) void release(old);
    };
  }, []);
  useEffect(() => {
    setAnalysis(null);
    if (!localMusic) return;
    const controller = new AbortController();
    void analyzeMusicBeats(localMusic.url, controller.signal).then((result) => {
      if (!controller.signal.aborted) setAnalysis({ id: localMusic.id, result });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      console.error('无法分析欣赏配乐：', cause);
      setAnalysis({ id: localMusic.id, result: { status: 'fixed', reason: 'read-failed' } });
    });
    return () => controller.abort();
  }, [localMusic]);

  async function release(track: MusicTrack) {
    try { await releaseMusic(track.id); }
    catch (cause) { feedback.current(t(`清理欣赏配乐失败：${errorMessage(cause)}`, `Could not remove slideshow music: ${errorMessage(cause)}`), true); }
  }
  function change(patch: Partial<AppreciationPreferences>) {
    const next = { ...preferences, ...patch };
    try { saveAppreciationPreferences(next); }
    catch { feedback.current(t('无法保存欣赏设置', 'Could not save slideshow settings.'), true); return false; }
    setPreferences(next);
    return true;
  }
  function changeMusic(id: string) {
    if (id === localRef.current?.id) return;
    if (!change({ musicId: id })) return;
    const old = localRef.current;
    localRef.current = null;
    setAnalysis(null);
    setLocalMusic(null);
    if (old) void release(old);
  }
  async function chooseMusic() {
    if (picking) return;
    setPicking(true);
    try {
      const chosen = await pickMusic();
      if (!chosen) return;
      if (!alive.current) { await release(chosen); return; }
      const old = localRef.current;
      localRef.current = chosen;
      setAnalysis(null);
      setLocalMusic(chosen);
      if (old) await release(old);
    } catch (cause) { feedback.current(errorMessage(cause), true); }
    finally { if (alive.current) setPicking(false); }
  }
  return { preferences, music, localMusic, analysis, picking, change, changeMusic, chooseMusic };
}
function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
