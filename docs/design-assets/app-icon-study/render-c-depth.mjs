import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const sharp = createRequire(import.meta.url)(process.argv[2] || 'sharp');
const directory = dirname(fileURLToPath(import.meta.url));
const depth = await readFile(join(directory, 'c-depth.svg'), 'utf8');
const flat = await readFile(join(directory, 'c-refined.svg'), 'utf8');
if (depth.match(/<path id="glyph" d="([^"]+)"/)[1] !== flat.match(/<path d="([^"]+)"/)[1]) throw Error('Front silhouette changed');
if (/<text\b|<image\b|<script\b|href="(?!#)/.test(depth)) throw Error('Unexpected dependency');
const checks=[];
for(const size of [1024,128,64,32]) {
 const path=join(directory,`c-depth${size===1024?'':`-${size}`}.png`);
 await sharp(Buffer.from(depth),{density:144}).resize(size,size).png().toFile(path);
 const {data,info}=await sharp(path).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.width!==size||info.height!==size||info.channels!==4||data[3]!==0) throw Error('Raster check failed');
 checks.push({size,rgba:true,transparentCorner:true});
}
await writeFile(join(directory,'c-depth-checks.json'),JSON.stringify({renderer:`sharp ${sharp.versions.sharp} / librsvg ${sharp.versions.rsvg}`,unchangedFrontSilhouette:true,base:'#15171a',front:['#f0f2f5','#dce1e7','#bbc5d0'],projection:[8,18],shadow:{offset:[10,26],blur:10,opacity:.48},checks},null,2)+'\n');
console.log('C depth rendered: unchanged front silhouette, 4 RGBA sizes, transparent margins.');
