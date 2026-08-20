// Flags near-greyscale photos: an archival B&W shot among colour photos looks
// wrong on a card, and tells you nothing about the flower's colour.
import { readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
const UA = 'PetalsApp/1.0 (personal gift project)';
const D = '/Users/krishmaheshwari/petals/src/data/';
const rows = [...JSON.parse(readFileSync(D+'flowers.json','utf8')), ...JSON.parse(readFileSync(D+'fillers.json','utf8'))];
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const out = [];
for (const f of rows) {
  const url = f.imageUrl.replace(/\/\d+px-/, '/128px-');
  let buf=null;
  for (let a=0;a<3&&!buf;a++){
    try{ const r=await fetch(url,{headers:{'User-Agent':UA}});
      if(r.status===429||r.status>=500){ await sleep(6000*(a+1)); continue; }
      if(!r.ok) break; buf=Buffer.from(await r.arrayBuffer());
    }catch{ await sleep(4000); }
  }
  if(!buf){ out.push({id:f.id, sat:null}); await sleep(700); continue; }
  let px,w,h;
  try{
    if(url.toLowerCase().endsWith('.png')){ const p=PNG.sync.read(buf); px=p.data;w=p.width;h=p.height; }
    else { const im=jpeg.decode(buf,{useTArray:true}); px=im.data;w=im.width;h=im.height; }
  }catch{ out.push({id:f.id,sat:null}); await sleep(700); continue; }
  let sum=0,n=0;
  for(let i=0;i<w*h;i++){
    const r=px[i*4],g=px[i*4+1],b=px[i*4+2];
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    if(mx<20) continue;
    sum += (mx-mn)/mx; n++;
  }
  out.push({id:f.id, name:f.commonName, sat:n? sum/n : 0});
  await sleep(700);
}
const grey = out.filter(o=>o.sat!==null && o.sat < 0.10).sort((a,b)=>a.sat-b.sat);
console.log('scanned '+out.length);
console.log('LIKELY GREYSCALE (mean saturation < 0.10):');
for(const g of grey) console.log('  '+g.name.padEnd(24)+g.sat.toFixed(3));
console.log('total flagged: '+grey.length);
