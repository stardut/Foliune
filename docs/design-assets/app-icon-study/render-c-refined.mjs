import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const sharp = createRequire(import.meta.url)(process.argv[2] || 'sharp');
const directory = dirname(fileURLToPath(import.meta.url));
const refined = await readFile(join(directory, 'c-refined.svg'), 'utf8');
const original = await readFile(join(directory, 'c-monogram.svg'), 'utf8');
const oldPath = original.match(/<path d="([^"]+)"/)[1];
const oldDark = refined.replace(/<title[^>]*>[^<]+<\/title>/, '<title id="title">旧 C · 同色轮廓对照</title>')
  .replace(/<desc[^>]*>[^<]+<\/desc>/, '<desc id="desc">仅作形态比较：旧C原始路径，采用新稿相同的底色与标记颜色。</desc>')
  .replace(/<!--[^]*?-->/, '')
  .replace(/<path d="[^"]+"/, `<path d="${oldPath}"`);
await writeFile(join(directory, 'c-original-dark.svg'), oldDark);
const checks = [];
for (const [name, source, sizes] of [['c-refined', refined, [1024,128,64,32]], ['c-original-dark', oldDark, [1024]]]) {
  if (/<text\b|<image\b|<script\b|<linearGradient\b|<filter\b/.test(source)) throw Error('Unexpected glyph/font/raster/gradient dependency');
  for (const size of sizes) {
    const path = join(directory, `${name}${size === 1024 ? '' : `-${size}`}.png`);
    await sharp(Buffer.from(source), { density: 144 }).resize(size,size).png().toFile(path);
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const corner = [...data.subarray(0,4)];
    if (info.width !== size || info.height !== size || corner[3] !== 0) throw Error('Size or transparency mismatch');
    checks.push({ name, size, rgba: info.channels === 4, transparentCorners: true });
  }
}
await writeFile(join(directory, 'c-refined-checks.json'), JSON.stringify({ renderer: `sharp ${sharp.versions.sharp} / librsvg ${sharp.versions.rsvg}`, tile: '#15171a', glyph: '#e2e5e9', checks }, null, 2) + '\n');
console.log('C refined + fair-color original rendered; size/RGBA/transparency checks passed.');
