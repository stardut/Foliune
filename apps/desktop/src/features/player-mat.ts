type RGB = readonly [number, number, number];
export type PlayerMatTexture = { width: number; height: number; pixels: Uint8ClampedArray };
export type PlayerMatTextures = Record<'left' | 'right' | 'top' | 'bottom', PlayerMatTexture>;
export type PlayerMatSample = { edges: PlayerEdges; textures: PlayerMatTextures | null; frost?: string };
export type PlayerEdges = { left: RGB; right: RGB; top: RGB; bottom: RGB };
const charcoal: RGB = [20, 21, 22];
export const neutralPlayerEdges: PlayerEdges = { left: charcoal, right: charcoal, top: charcoal, bottom: charcoal };

/** Use only the adjacent edge bands; a bright subject in the middle must not tint the mat. */
export function playerEdgesFromPixels(pixels: Uint8ClampedArray, size: number): PlayerEdges {
  if (size < 4 || pixels.length !== size * size * 4) throw new Error('欣赏边色样本无效');
  const band = Math.max(1, Math.floor(size / 16));
  function edge(x: number, y: number, width: number, height: number): RGB {
    const sum = [0, 0, 0];
    for (let row = y; row < y + height; row++) for (let column = x; column < x + width; column++) {
      const offset = (row * size + column) * 4;
      const alpha = pixels[offset + 3] / 255;
      for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[offset + channel] * alpha + charcoal[channel] * (1 - alpha);
    }
    const average = sum.map(value => value / (width * height));
    const light = average[0] * .2126 + average[1] * .7152 + average[2] * .0722;
    // Keep hue as a quiet echo of the edge, with a narrow dark luminance range.
    const tint = (value: number) => Math.round(Math.max(12, Math.min(42, 18 + light * .075 + (value - light) * .08)));
    return [tint(average[0]), tint(average[1]), tint(average[2])];
  }
  return {
    left: edge(0, band, band, size - band * 2), right: edge(size - band, band, band, size - band * 2),
    top: edge(band, 0, size - band * 2, band), bottom: edge(band, size - band, size - band * 2, band),
  };
}

export const neutralPlayerMat: PlayerMatSample = { edges: neutralPlayerEdges, textures: null };

/** Narrow edge bands keep spatial light/color, without repeating the complete subject. */
export function playerTexturesFromPixels(pixels: Uint8ClampedArray, size: number): PlayerMatTextures {
  if (size < 12 || pixels.length !== size * size * 4) throw new Error('欣赏材质样本无效');
  const band = Math.max(2, Math.floor(size * .10));
  function strip(edge: keyof PlayerMatTextures): PlayerMatTexture {
    const vertical = edge === 'left' || edge === 'right';
    const width = vertical ? band : size, height = vertical ? size : band;
    const output = new Uint8ClampedArray(width * height * 4);
    const xMin = edge === 'right' ? size - band : 0, xMax = edge === 'left' ? band - 1 : size - 1;
    const yMin = edge === 'bottom' ? size - band : 0, yMax = edge === 'top' ? band - 1 : size - 1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sourceX = edge === 'left' ? band - 1 - x : edge === 'right' ? size - 1 - x : x;
      const sourceY = edge === 'top' ? band - 1 - y : edge === 'bottom' ? size - 1 - y : y;
      const sum = [0, 0, 0];
      let count = 0;
      // Remove small recognizable detail before the spatial field is enlarged.
      for (let row = Math.max(yMin, sourceY - 2); row <= Math.min(yMax, sourceY + 2); row++) {
        for (let column = Math.max(xMin, sourceX - 2); column <= Math.min(xMax, sourceX + 2); column++) {
          const offset = (row * size + column) * 4, alpha = pixels[offset + 3] / 255;
          for (let channel = 0; channel < 3; channel++) sum[channel] += pixels[offset + channel] * alpha + charcoal[channel] * (1 - alpha);
          count++;
        }
      }
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) output[offset + channel] = sum[channel] / count;
      output[offset + 3] = 255;
    }
    return { width, height, pixels: output };
  }
  return { left: strip('left'), right: strip('right'), top: strip('top'), bottom: strip('bottom') };
}

let frostTexture: string | undefined;
function prepareFrost(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  if (frostTexture) return frostTexture;
  canvas.width = 96; canvas.height = 96;
  const image = context.createImageData(96, 96);
  let seed = 731;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const value = seed >>> 24;
    image.data.set([value, value, value, 255], offset);
  }
  context.putImageData(image, 0, 0);
  frostTexture = canvas.toDataURL('image/png');
  return frostTexture;
}

let reportedSamplingFailure = false;
export function reportPlayerMatFailure(cause: unknown) {
  if (reportedSamplingFailure) return;
  console.warn('欣赏材质无法读取，使用中性哑光底色。', cause);
  reportedSamplingFailure = true;
}
export function samplePlayerMat(image: HTMLImageElement): PlayerMatSample {
  const canvas = document.createElement('canvas');
  canvas.width = 96; canvas.height = 96;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('欣赏边色画布不可用');
    // Reuse the actual decoded image; never allocate another full-resolution decoder.
    context.drawImage(image, 0, 0, 96, 96);
    const pixels = context.getImageData(0, 0, 96, 96).data;
    const edges = playerEdgesFromPixels(pixels, 96);
    const textures = playerTexturesFromPixels(pixels, 96);
    return { edges, textures, frost: prepareFrost(canvas, context) };
  } catch (cause) {
    // A decorative canvas must not turn an otherwise readable photo into an error.
    reportPlayerMatFailure(cause);
    return neutralPlayerMat;
  } finally { canvas.width = 0; canvas.height = 0; }
}

export function playerMatColors(samples: readonly { edges: PlayerEdges; ratio: number }[]): PlayerEdges {
  const width = samples.reduce((sum, sample) => sum + sample.ratio, 0);
  const average = (edge: 'top' | 'bottom'): RGB => {
    const channel = (index: number) => Math.round(samples.reduce((sum, sample) => sum + sample.edges[edge][index] * sample.ratio, 0) / width);
    return [channel(0), channel(1), channel(2)];
  };
  return { left: samples[0].edges.left, right: samples.at(-1)!.edges.right, top: average('top'), bottom: average('bottom') };
}
