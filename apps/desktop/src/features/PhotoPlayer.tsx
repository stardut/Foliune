import { presentModal } from '../lib/modal-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Maximize2, Music2, Pause, Play, Repeat2, Settings2, Shuffle, Volume2, X } from 'lucide-react';
import type { Photo } from '../lib/types';
import { pickMusic, releaseMusic, type MusicTrack } from '../lib/music-api';
import { PhotoImage } from '../components/PhotoImage';
import { IconButton } from '../components/ui';
import './player.css';

export function PhotoPlayer({ photos, photoIds, onClose, onRelink, onFeedback }: { photos: Photo[]; photoIds: string[]; onClose: () => void; onRelink: (photo: Photo) => Promise<void>; onFeedback: (message: string, error?: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [order, setOrder] = useState(photoIds);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(photoIds.length > 1);
  const [random, setRandom] = useState(false);
  const [loop, setLoop] = useState(true);
  const [seconds, setSeconds] = useState(6);
  const [settings, setSettings] = useState(false);
  const [visible, setVisible] = useState(true);
  const [music, setMusic] = useState<MusicTrack | null>(null);
  const musicRef = useRef<MusicTrack | null>(null);
  const alive = useRef(true);
  const [volume, setVolume] = useState(.45);
  const [error, setError] = useState('');
  const [pickingMusic, setPickingMusic] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = photos.find((photo) => photo.id === order[index]);
  const advance = useCallback((direction: number) => {
    const next = index + direction;
    if (next >= 0 && next < order.length) setIndex(next);
    else if (loop && order.length) setIndex((next + order.length) % order.length);
    else setPlaying(false);
  }, [index, order.length, loop]);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const musicElement = audio.current;
    const dismissModal = presentModal(dialog.current!);
    return () => {
      alive.current = false;
      if (hideTimer.current) clearTimeout(hideTimer.current);
      dismissModal();
      if (musicElement) { musicElement.pause(); musicElement.removeAttribute('src'); musicElement.load(); }
      const old = musicRef.current; musicRef.current = null;
      if (old) void releaseMusic(old.id).catch((cause) => onFeedback(`清理欣赏配乐失败：${errorMessage(cause)}`, true));
      previous?.focus();
    };
  }, []);
  useEffect(() => { if (current && !current.originalAvailable) setPlaying(false); }, [current?.id, current?.originalAvailable]);
  useEffect(() => {
    if (!playing || order.length < 2) return;
    const timer = setTimeout(() => advance(1), seconds * 1000); return () => clearTimeout(timer);
  }, [playing, index, seconds, order.length, advance]);
  useEffect(() => {
    const element = audio.current; if (!element) return;
    element.volume = volume;
    if (playing && music) void element.play().catch(() => { if (alive.current && musicRef.current?.id === music.id) setError('音乐未能开始播放，请点击播放重试。'); });
    else element.pause();
  }, [playing, music, volume]);
  function reveal() { setVisible(true); if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setVisible(false), 2800); }
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await dialog.current?.requestFullscreen(); }
    catch { setError('当前系统窗口不支持全屏，请使用系统窗口的全屏入口。'); }
  }
  function shuffle() {
    const next = !random; setRandom(next);
    if (next) { const others = [...photoIds]; if (current) others.splice(others.indexOf(current.id), 1); for (let i = others.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [others[i], others[j]] = [others[j], others[i]]; } setOrder(current ? [current.id, ...others] : others); setIndex(0); }
    else { setOrder(photoIds); setIndex(Math.max(0, photoIds.indexOf(current?.id || ''))); }
  }
  async function chooseMusic() {
    setPickingMusic(true); setError('');
    try {
      const chosen = await pickMusic(); if (!chosen) return;
      if (!alive.current) { await releaseMusic(chosen.id); return; }
      const old = musicRef.current;
      stopMusic(); musicRef.current = chosen; setMusic(chosen);
      if (old) await releaseMusic(old.id);
    }
    catch (cause) { if (alive.current) setError(errorMessage(cause)); else onFeedback(`清理欣赏配乐失败：${errorMessage(cause)}`, true); }
    finally { if (alive.current) setPickingMusic(false); }
  }
  function stopMusic() { const element = audio.current; if (element) { element.pause(); element.removeAttribute('src'); element.load(); } }
  async function removeMusic() { const old = musicRef.current; stopMusic(); musicRef.current = null; setMusic(null); if (old) { try { await releaseMusic(old.id); } catch (cause) { setError(`清理欣赏配乐失败：${errorMessage(cause)}`); } } }
  return <dialog ref={dialog} className={`photo-player ${visible || !playing || settings ? 'player-awake' : ''}`} aria-label="照片欣赏播放器" onCancel={(event) => { event.preventDefault(); onClose(); }} onPointerMove={reveal} onKeyDown={(event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.code === 'Space') { event.preventDefault(); setPlaying((value) => !value); reveal(); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); advance(-1); reveal(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); advance(1); reveal(); }
    if (event.key.toLowerCase() === 'f') void fullscreen();
  }}>
    <div className="player-top"><button className="text-button" type="button" onClick={onClose}><X size={17} />返回</button><span>{current?.title || '照片欣赏'}</span><IconButton label="切换全屏" onClick={() => void fullscreen()}><Maximize2 size={17} /></IconButton></div>
    <div className="player-stage">{current ? <PhotoImage key={current.id} photo={current} original onRelink={onRelink} onUnavailable={() => setPlaying(false)} /> : <p role="alert">此照片不在当前图库中</p>}</div>
    {error && <div className="player-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')}>关闭</button></div>}
    <div className="player-controls" onFocus={() => setVisible(true)}><IconButton label="上一张" disabled={!loop && index === 0} onClick={() => advance(-1)}><ArrowLeft size={18} /></IconButton><IconButton label={playing ? '暂停' : '播放'} onClick={() => { setPlaying(!playing); reveal(); }}>{playing ? <Pause size={18} /> : <Play size={18} />}</IconButton><IconButton label="下一张" disabled={!loop && index === order.length - 1} onClick={() => advance(1)}><ArrowRight size={18} /></IconButton><span className="player-counter">{String(index + 1).padStart(2, '0')} / {order.length}</span><span className="player-divider" /><IconButton label={random ? '关闭随机播放' : '随机播放'} active={random} onClick={shuffle}><Shuffle size={16} /></IconButton><IconButton label={loop ? '关闭循环' : '循环播放'} active={loop} onClick={() => setLoop(!loop)}><Repeat2 size={17} /></IconButton><IconButton label="播放与音乐设置" active={settings} onClick={() => setSettings(!settings)}><Settings2 size={17} /></IconButton></div>
    {settings && <section className="player-settings" aria-label="播放设置"><div className="player-settings-title"><h2>播放与音乐</h2><IconButton label="关闭播放设置" onClick={() => setSettings(false)}><X size={15} /></IconButton></div><label>每张停留<select value={seconds} onChange={(event) => setSeconds(Number(event.target.value))}>{[3, 5, 6, 10, 15, 30, 60].map((value) => <option key={value} value={value}>{value} 秒</option>)}</select></label><button type="button" className="button" disabled={pickingMusic} onClick={() => void chooseMusic()}><Music2 size={14} />{pickingMusic ? '正在选择…' : '选择本地音乐'}</button>{music && <><p className="player-music-name">{music.name}</p><label className="volume-label"><Volume2 size={14} /><input aria-label="音乐音量" type="range" min="0" max="1" step=".05" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /><span>{Math.round(volume * 100)}%</span></label><button type="button" className="text-button" onClick={() => void removeMusic()}>移除音乐</button></>}<p className="muted">配乐仅用于当前欣赏会话。</p></section>}
    <audio ref={audio} src={music?.url} loop onError={() => setError('音乐无法读取或格式不受当前系统支持，请重新选择。')} />
  </dialog>;
}
function errorMessage(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
