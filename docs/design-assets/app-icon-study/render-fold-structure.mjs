import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const sharp=createRequire(import.meta.url)(process.argv[2]||'sharp');
const directory=dirname(fileURLToPath(import.meta.url));
const svg=await readFile(join(directory,'c-fold-structure.svg'),'utf8');
if(/<filter\b|<linearGradient\b|<radialGradient\b|<text\b|<image\b|<script\b|transform=|stroke=|href=/.test(svg))throw Error('Unexpected effect or dependency');
const checks=[];
for(const size of [1024,128,64,32]){
 const path=join(directory,`c-fold-structure${size===1024?'':`-${size}`}.png`);
 await sharp(Buffer.from(svg),{density:144}).resize(size,size).png().toFile(path);
 const {data,info}=await sharp(path).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const corners=[0,size-1,(size-1)*size,size*size-1];
 if(info.width!==size||info.height!==size||info.channels!==4||corners.some(p=>data[p*4+3]!==0))throw Error('RGBA/transparency check failed');
 checks.push({size,rgba:true,transparentCorners:true});
}
await writeFile(join(directory,'c-fold-structure-checks.json'),JSON.stringify({renderer:`sharp ${sharp.versions.sharp} / librsvg ${sharp.versions.rsvg}`,base:'#15171a',front:'#e5e5e2',side:'#b2b2af',turn:'#cececa',projection:[-24,-18],frontShaftWidth:100,sideWidth:24,capHeight:18,filters:false,gradients:false,strokes:false,checks},null,2)+'\n');
console.log('Fold structure: 100px front / 24px side / 18px cap; 4 RGBA sizes, no effects/dependencies.');
