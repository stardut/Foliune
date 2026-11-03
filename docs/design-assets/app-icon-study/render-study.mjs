import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const sharp = createRequire(import.meta.url)(process.argv[2] || 'sharp');
const directory = dirname(fileURLToPath(import.meta.url));
const checks = [];
for (const name of ['a-fold', 'b-frames', 'c-monogram']) {
  const svg = await readFile(join(directory, `${name}.svg`));
  if (/<text\b|https?:\/\/(?!www.w3.org\/2000\/svg)|<image\b|<script\b/.test(svg.toString())) throw Error(`${name}: external/font/raster dependency`);
  for (const size of [1024, 128, 64, 32]) {
    const output = join(directory, `${name}${size === 1024 ? '' : `-${size}`}.png`);
    await sharp(svg, { density: 144 }).resize(size, size).png().toFile(output);
    const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x, y) => data[(y * size + x) * 4 + 3];
    if (alpha(0, 0) !== 0 || alpha(size - 1, size - 1) !== 0) throw Error(`${name}: lost transparent margin`);
    checks.push({ name, size, channels: info.channels, transparentCorners: true, centerAlpha: alpha(Math.floor(size / 2), Math.floor(size / 2)) });
  }
}
await writeFile(join(directory, 'render-checks.json'), JSON.stringify({ renderer: `sharp ${sharp.versions.sharp} / librsvg ${sharp.versions.rsvg}`, checks }, null, 2) + '\n');
console.log('Rendered 3 SVG candidates at 1024 / 128 / 64 / 32; RGBA and transparent-corner checks passed.');
