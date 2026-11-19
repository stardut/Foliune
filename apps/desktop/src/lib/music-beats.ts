export interface MusicBeatGrid {
  duration: number;
  beats: readonly number[];
  downbeats: readonly number[];
}
export type BeatAnalysis = { status: 'ready'; grid: MusicBeatGrid } | {
  status: 'fixed'; reason: 'weak-pulse' | 'too-large' | 'too-long' | 'unsupported' | 'read-failed';
};
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_SECONDS = 600;

/** Conservative fixed-tempo pulse inference. Rubato/ambiguous material stays fixed-time. */
export function detectMusicBeats(samples: Float32Array, sampleRate: number): BeatAnalysis {
  const hop = Math.max(1, Math.round(sampleRate / 100));
  const frameRate = sampleRate / hop;
  const energy = new Float32Array(Math.floor(samples.length / hop));
  let low = 0;
  const smoothing = 1 - Math.exp(-2 * Math.PI * 180 / sampleRate);
  for (let i = 0; i < energy.length; i++) {
    let value = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) {
      low += smoothing * (samples[j] - low);
      value += low * low;
    }
    energy[i] = Math.sqrt(value / hop);
  }
  const novelty = new Float32Array(energy.length);
  let power = 0;
  for (let i = 3; i < energy.length; i++) {
    novelty[i] = Math.max(0, energy[i] - (energy[i - 1] + energy[i - 2] + energy[i - 3]) / 3);
    power += novelty[i] ** 2;
  }
  if (power < 1e-7 || energy.length < frameRate * 12) return { status: 'fixed', reason: 'weak-pulse' };
  const minLag = Math.round(frameRate * 60 / 160), maxLag = Math.round(frameRate * 60 / 60);
  let bestLag = 0, best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let correlation = 0, previousPower = 0, currentPower = 0;
    for (let i = lag; i < novelty.length; i++) {
      correlation += novelty[i] * novelty[i - lag];
      previousPower += novelty[i - lag] ** 2;
      currentPower += novelty[i] ** 2;
    }
    const value = correlation / Math.sqrt(previousPower * currentPower || 1);
    if (value > best) { best = value; bestLag = lag; }
  }
  if (best < .42) return { status: 'fixed', reason: 'weak-pulse' };
  // Refine using nearby actual attack peaks rather than extrapolating a rounded BPM.
  let phase = 0, phaseScore = 0;
  for (let offset = 0; offset < bestLag; offset++) {
    let value = 0;
    for (let i = offset; i < novelty.length; i += bestLag) value += novelty[i];
    if (value > phaseScore) { phaseScore = value; phase = offset; }
  }
  const attacks: number[] = [];
  let captured = 0;
  const radius = Math.max(2, Math.round(bestLag * .12));
  for (let predicted = phase; predicted < novelty.length;) {
    let peak = predicted;
    for (let i = Math.max(0, predicted - radius); i <= Math.min(novelty.length - 1, predicted + radius); i++) {
      if (novelty[i] > novelty[peak]) peak = i;
    }
    if (novelty[peak] > 0) { attacks.push(peak); captured += novelty[peak] ** 2; }
    predicted = peak + bestLag;
  }
  if (attacks.length < 12 || captured / power < .35) return { status: 'fixed', reason: 'weak-pulse' };
  // Reject changing tempo and weak sections instead of manufacturing a regular grid.
  let regular = 0;
  for (let i = 1; i < attacks.length; i++) {
    if (Math.abs(attacks[i] - attacks[i - 1] - bestLag) < bestLag * .17) regular++;
  }
  if (regular / (attacks.length - 1) < .86) return { status: 'fixed', reason: 'weak-pulse' };
  let accent = 0, accentScore = 0;
  const accents: number[] = [];
  for (let offset = 0; offset < 4; offset++) {
    let value = 0;
    for (let i = offset; i < attacks.length; i += 4) value += energy[attacks[i]];
    accents.push(value / Math.ceil((attacks.length - offset) / 4));
    if (accents[offset] > accentScore) { accentScore = accents[offset]; accent = offset; }
  }
  const accentMean = accents.reduce((sum, value) => sum + value, 0) / 4;
  if (accentScore < accentMean * 1.08) return { status: 'fixed', reason: 'weak-pulse' };
  const beats = attacks.map(frame => frame / frameRate);
  return { status: 'ready', grid: {
    duration: samples.length / sampleRate, beats,
    downbeats: beats.filter((_, index) => index % 4 === accent),
  } };
}

function metadataDuration(url: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const finish = (error?: unknown) => {
      audio.onloadedmetadata = null; audio.onerror = null;
      audio.removeAttribute('src'); audio.load();
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
    };
    const abort = () => finish(new DOMException('Aborted', 'AbortError'));
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      finish(); resolve(duration);
    };
    audio.onerror = () => finish(new Error('Unsupported music'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    audio.src = url; audio.load();
  });
}

/** Decodes at 11025 Hz. No uploads, live AudioContext, playback or third-party analysis. */
export async function analyzeMusicBeats(url: string, signal: AbortSignal): Promise<BeatAnalysis> {
  signal.throwIfAborted();
  let duration: number;
  try { duration = await metadataDuration(url, signal); }
  catch (cause) { signal.throwIfAborted(); return { status: 'fixed', reason: 'unsupported' }; }
  if (!Number.isFinite(duration) || duration <= 0) return { status: 'fixed', reason: 'unsupported' };
  if (duration > MAX_SECONDS) return { status: 'fixed', reason: 'too-long' };
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return { status: 'fixed', reason: 'read-failed' };
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel();
      return { status: 'fixed', reason: 'too-large' };
    }
    const reader = response.body?.getReader();
    if (!reader) return { status: 'fixed', reason: 'read-failed' };
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > MAX_BYTES) { await reader.cancel(); return { status: 'fixed', reason: 'too-large' }; }
      chunks.push(chunk.value);
    }
    const combined = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) { combined.set(chunk, at); at += chunk.length; }
    bytes = combined.buffer;
  } catch (cause) { signal.throwIfAborted(); return { status: 'fixed', reason: 'read-failed' }; }
  signal.throwIfAborted();
  let decoded: AudioBuffer;
  try { decoded = await new OfflineAudioContext(1, 1, 11025).decodeAudioData(bytes); }
  catch { signal.throwIfAborted(); return { status: 'fixed', reason: 'unsupported' }; }
  signal.throwIfAborted();
  if (decoded.duration > MAX_SECONDS) return { status: 'fixed', reason: 'too-long' };
  const mono = decoded.getChannelData(0);
  if (decoded.numberOfChannels > 1) {
    for (let i = 0; i < mono.length; i++) mono[i] /= decoded.numberOfChannels;
    for (let channel = 1; channel < decoded.numberOfChannels; channel++) {
      const values = decoded.getChannelData(channel);
      for (let i = 0; i < mono.length; i++) mono[i] += values[i] / decoded.numberOfChannels;
    }
  }
  return detectMusicBeats(mono, decoded.sampleRate);
}
