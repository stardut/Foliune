export type Rect = { x: number; y: number; width: number; height: number };
export type TitleRun = { text: string; italic: boolean };
export type TitleLayout = { lines: TitleRun[][]; size: number; width: number; height: number; lineHeight: number; truncated: boolean };
export type CoverSample = { pixels: Uint8ClampedArray; size: number; crop: Rect; sourceWidth: number; sourceHeight: number };
export type TitlePlacement = { x: number; y: number; color: string; outline: string; reinforced: boolean; score: number };
export type MeasureTitle = (text: string, size: number, italic: boolean) => number;
export const coverFontFamily = '"Foliune Cover Latin", "Foliune Cover CJK", serif';

export function validCoverSize(width: number, height: number) {
  return [width, height].every((value) => Number.isFinite(value) && value > 0);
}
export function centerCoverCrop(width: number, height: number): Rect {
  if (!validCoverSize(width, height)) throw new Error('封面照片尺寸不可用');
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, width: side, height: side };
}
function runs(glyphs: TitleRun[]): TitleRun[] {
  const result: TitleRun[] = [];
  for (const glyph of glyphs) {
    const previous = result.at(-1);
    if (previous?.italic === glyph.italic) previous.text += glyph.text;
    else result.push({ ...glyph });
  }
  return result;
}
function titleGlyphs(title: string): TitleRun[] {
  const lastWord = /(?:^|\s)([A-Za-z]+(?:['’\-][A-Za-z]+)*[.!?]?)$/.exec(title);
  const italicStart = lastWord && lastWord.index + lastWord[0].length - lastWord[1].length;
  let offset = 0;
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(title), ({ segment }) => {
    const glyph = { text: segment, italic: italicStart !== null && offset >= italicStart };
    offset += segment.length; return glyph;
  });
}
export function fitCoverTitle(title: string, width: number, measure: MeasureTitle, heightRatio = .52): TitleLayout {
  const glyphs = titleGlyphs(title);
  const pureFourHan = /^\p{Script=Han}{4}$/u.test(title);
  const mixed = /\p{Script=Han}/u.test(title) && /[A-Za-z]/.test(title);
  const maxWidth = width * (pureFourHan ? .31 : mixed ? .7 : .66);
  const maxHeight = width * Math.min(heightRatio, mixed ? .44 : glyphs.length <= 16 ? .36 : .44);
  const widthOf = (line: TitleRun[], size: number) => runs(line).reduce((sum, run) => sum + measure(run.text, size, run.italic), 0);
  function at(size: number): TitleLayout {
    const lines: TitleRun[][] = []; let line: TitleRun[] = [];
    for (const glyph of glyphs) {
      if (glyph.text === '\n') { lines.push(line); line = []; continue; }
      if (line.length && widthOf([...line, glyph], size) > maxWidth) {
        let space = -1;
        for (let index = line.length - 1; index > 0; index--) if (/\s/.test(line[index].text) || /[a-z]/.test(line[index - 1].text) && /[A-Z]/.test(line[index].text)) { space = index; break; }
        if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(/\s/.test(line[space].text) ? space + 1 : space); }
        else { lines.push(line); line = []; }
      }
      if (line.length || !/\s/.test(glyph.text)) line.push(glyph);
      // A carried word plus the new glyph can still exceed the region.
      if (line.length > 1 && widthOf(line, size) > maxWidth) { const last = line.pop()!; lines.push(line); line = [last]; }
    }
    if (line.length || !lines.length) lines.push(line);
    return { lines: lines.map(runs), size, width: Math.max(...lines.map((item) => widthOf(item, size))), height: lines.length * size * 1.12, lineHeight: size * 1.12, truncated: false };
  }
  const maximum = mixed ? 32 : /\p{Script=Han}/u.test(title) ? (Array.from(title).length <= 2 ? 40 : 36) : /[A-Za-z]{24}/.test(title) ? 30 : 36;
  let low = 12; let high = maximum; let best = at(low);
  while (low <= high) {
    const size = Math.floor((low + high) / 2); const result = at(size);
    if (result.width <= maxWidth && result.height <= maxHeight) { best = result; low = size + 1; }
    else high = size - 1;
  }
  if (best.height > maxHeight || best.width > maxWidth) {
    const count = Math.max(1, Math.floor(maxHeight / best.lineHeight));
    const kept = best.lines.slice(0, count);
    const tail = kept[kept.length - 1].flatMap((run) => Array.from(run.text, (text) => ({ text, italic: run.italic })));
    while (tail.length && widthOf([...tail, { text: '…', italic: false }], best.size) > maxWidth) tail.pop();
    kept[kept.length - 1] = runs([...tail, { text: '…', italic: false }]);
    best = { ...best, lines: kept, width: Math.max(...kept.map((line) => widthOf(line, best.size))), height: kept.length * best.lineHeight, truncated: true };
  }
  return best;
}
function overlap(a: Rect, b: Rect) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}
export function mapCoverRegions(regions: Rect[], crop: Rect, sourceWidth: number, sourceHeight: number): Rect[] {
  return regions.map((region) => {
    const left = Math.max(crop.x, region.x * sourceWidth); const top = Math.max(crop.y, region.y * sourceHeight);
    const right = Math.min(crop.x + crop.width, (region.x + region.width) * sourceWidth);
    const bottom = Math.min(crop.y + crop.height, (region.y + region.height) * sourceHeight);
    return { x: (left - crop.x) / crop.width, y: (top - crop.y) / crop.height, width: Math.max(0, right - left) / crop.width, height: Math.max(0, bottom - top) / crop.height };
  }).filter((region) => region.width > 0 && region.height > 0);
}
function coverLightness(sample: CoverSample) {
  const { size, pixels } = sample;
  if (pixels.length !== size * size * 4) throw new Error('封面分析样本无效');
  const values = new Float64Array(size * size);
  for (let index = 0; index < values.length; index++) {
    const linear = (channel: number) => { const c = channel / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
    const alpha = pixels[index * 4 + 3] / 255;
    // CSS renders transparent thumbnails over the real #1d1e20 stage.
    const channels = [29, 30, 32].map((background, channel) => pixels[index * 4 + channel] * alpha + background * (1 - alpha));
    values[index] = .2126 * linear(channels[0]) + .7152 * linear(channels[1]) + .0722 * linear(channels[2]);
  }
  const globalMean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { values, globalMean };
}
export function placeCoverTitle(sample: CoverSample, layout: TitleLayout, coverWidth: number, regions: Rect[] = []): TitlePlacement {
  return placeAnalyzedTitle(sample, layout, coverWidth, regions, coverLightness(sample));
}
function placeAnalyzedTitle(sample: CoverSample, layout: TitleLayout, coverWidth: number, regions: Rect[], lightness: ReturnType<typeof coverLightness>): TitlePlacement {
  const { size } = sample;
  const { values, globalMean } = lightness;
  const width = layout.width / coverWidth; const height = layout.height / coverWidth;
  const annotated = mapCoverRegions(regions, sample.crop, sample.sourceWidth, sample.sourceHeight);
  const candidates: TitlePlacement[] = [];
  for (const y of new Set([.07, .2, .32, .42, .52, .92 - height].filter((value) => value >= .06 && value + height <= .94))) for (const x of [.08, .92 - width]) {
    const rect = { x, y, width, height }; let total = 0; let square = 0; let edges = 0; let count = 0;
    const contrasts = [0, 0]; const softContrasts = [0, 0]; const shades = [.91, .009];
    for (let row = Math.max(0, Math.floor(y * size)); row < Math.min(size, Math.ceil((y + height) * size)); row++) {
      for (let column = Math.max(0, Math.floor(x * size)); column < Math.min(size, Math.ceil((x + width) * size)); column++) {
        const index = row * size + column; const light = values[index]; total += light; square += light * light; count++;
        if (column + 1 < size) edges += Math.abs(light - values[index + 1]) / (.08 + light + values[index + 1]);
        if (row + 1 < size) edges += Math.abs(light - values[index + size]) / (.08 + light + values[index + size]);
        for (let shade = 0; shade < 2; shade++) {
          const ratio = (Math.max(light, shades[shade]) + .05) / (Math.min(light, shades[shade]) + .05);
          if (ratio >= 3) contrasts[shade]++;
          if (ratio >= (layout.size >= 24 ? 3 : 4.5)) softContrasts[shade]++;
        }
      }
    }
    const mean = total / count; const variance = square / count - mean * mean;
    const center = overlap(rect, { x: .3, y: .25, width: .4, height: .5 }) / (width * height);
    const annotation = annotated.reduce((sum, region) => sum + overlap(rect, region) / (width * height), 0);
    for (let shade = 0; shade < 2; shade++) {
      const structure = Math.min(1, edges / count * 5 + Math.abs(mean - globalMean));
      const score = edges / count * 10 + variance * 2 + (1 - contrasts[shade] / count) * 1.2 + center * structure * 1.5 + annotation * 10 + y * .4 + x * .02;
      candidates.push({ x, y, color: shade === 0 ? '#f8f4eb' : '#171716', outline: shade === 0 ? '#171716' : '#f8f4eb', reinforced: softContrasts[shade] / count < .8, score });
    }
  }
  return candidates.sort((a, b) => a.score - b.score)[0];
}
export function designCoverTitle(sample: CoverSample, title: string, width: number, measure: MeasureTitle, regions: Rect[] = []) {
  const base = fitCoverTitle(title, width, measure);
  const lightness = coverLightness(sample);
  const sizes = new Set([1, .8, .65].map((factor) => Math.min(base.size, Math.max(18, Math.floor(base.size * factor)))));
  return [...sizes].map((size) => {
    const layout = { ...base, size, lineHeight: size * 1.12, height: base.lines.length * size * 1.12,
      width: Math.max(...base.lines.map((line) => line.reduce((sum, run) => sum + measure(run.text, size, run.italic), 0))) };
    const placement = placeAnalyzedTitle(sample, layout, width, regions, lightness);
    return { layout, placement, score: placement.score + (1 - size / base.size) * 1.2 };
  }).sort((a, b) => a.score - b.score)[0];
}
export function loadCoverSample(url: string, signal?: AbortSignal): Promise<CoverSample> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('封面分析已取消', 'AbortError')); return; }
    const image = new Image(); image.crossOrigin = 'anonymous';
    const cleanup = () => { image.onload = null; image.onerror = null; signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('封面分析已取消', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    image.onload = () => {
      const canvas = document.createElement('canvas');
      try {
        const crop = centerCoverCrop(image.naturalWidth, image.naturalHeight);
        canvas.width = 96; canvas.height = 96;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('封面分析画布不可用');
        context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, 96, 96);
        resolve({ pixels: context.getImageData(0, 0, 96, 96).data, size: 96, crop, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight });
      } catch { reject(new Error('封面分析不可用')); }
      finally { canvas.width = 0; canvas.height = 0; cleanup(); }
    };
    image.onerror = () => { cleanup(); reject(new Error('封面分析不可用')); };
    image.src = url;
  });
}
