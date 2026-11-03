import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const sharp=createRequire(import.meta.url)(process.argv[2]||'sharp');
const directory=dirname(fileURLToPath(import.meta.url));
const svg=await readFile(join(directory,'c-clean-planes.svg'),'utf8');
const flat=await readFile(join(directory,'c-refined.svg'),'utf8');
if(svg.match(/id="glyph" d="([^"]+)"/)[1]!==flat.match(/<path d="([^"]+)"/)[1])throw Error('Outer F changed');
if(/<filter\b|<linearGradient\b|<radialGradient\b|<text\b|<image\b|<script\b|transform=|stroke=|href="(?!#)/.test(svg))throw Error('Unexpected shading/dependency');
const checks=[];
for(const size of [1024,128,64,32]){
 const path=join(directory,`c-clean-planes${size===1024?'':`-${size}`}.png`);
 await sharp(Buffer.from(svg),{density:144}).resize(size,size).png().toFile(path);
 const {data,info}=await sharp(path).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const corners=[0,size-1,(size-1)*size,size*size-1];
 if(info.width!==size||info.height!==size||info.channels!==4||corners.some(p=>data[p*4+3]!==0))throw Error('RGBA/transparency check failed');
 checks.push({size,rgba:true,transparentCorners:true});
}
await writeFile(join(directory,'c-clean-planes-checks.json'),JSON.stringify({renderer:`sharp ${sharp.versions.sharp} / librsvg ${sharp.versions.rsvg}`,unchangedSilhouette:true,base:'#15171a',planes:['#e7e7e4','#b4b4b2'],offsets:false,shadows:false,gradients:false,strokes:false,checks},null,2)+'\n');
console.log('Clean planes: unchanged silhouette, two neutral solid planes, no offset/filter/gradient/stroke; 4 RGBA sizes passed.');
