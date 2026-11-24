/* Reproducible local TeachApp icons; no external libraries. */
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export function pngIcon(size,maskable=false){
 const array=n=>new Uint8Array(n),u32=n=>Uint8Array.of(n>>>24,n>>>16&255,n>>>8&255,n&255);
 function concat(parts){const out=array(parts.reduce((n,x)=>n+x.length,0));let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;}
 function crc32(a){let c=0xffffffff;for(const b of a){c^=b;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
 function chunk(name,data){const a=concat([Uint8Array.from(name,x=>x.charCodeAt(0)),data]);return concat([u32(data.length),a,u32(crc32(a))]);}
 const palette=[],mix=(a,b,t)=>a.map((v,i)=>Math.round(v+(b[i]-v)*t));
 for(let layer=0;layer<3;layer++)for(let n=0;n<32;n++){const bg=mix([29,70,173],[106,58,190],n/31);palette.push(...(layer===0?bg:layer===1?mix(bg,[255,255,255],.5):mix(bg,[189,213,255],.85)));}
 palette.push(255,255,255);const white=96;
 const pixels=array((size+1)*size),s=maskable?.86:1;
 function inside(x,y,rx,ry,w,h,r){const dx=Math.max(rx+r-x,0,x-(rx+w-r)),dy=Math.max(ry+r-y,0,y-(ry+h-r));return dx*dx+dy*dy<=r*r;}
 function lineDist(x,y,ax,ay,bx,by){const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));return Math.hypot(x-ax-t*dx,y-ay-t*dy);}
 for(let y=0;y<size;y++){let previous=0;const row=y*(size+1);pixels[row]=1;
  for(let x=0;x<size;x++){const idx=Math.round(31*(x+y)/(2*(size-1)));let hit=0,slash=0;
   for(const [dx,dy] of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){
    const X=((x+dx)/size-.5)/s+.5,Y=((y+dy)/size-.5)/s+.5;
    if(inside(X,Y,.22,.25,.56,.13,.045)||inside(X,Y,.435,.34,.13,.40,.045))hit++;
    else if(lineDist(X,Y,.61,.70,.77,.52)<.049)slash++;
   }
   const p=hit>=3?white:hit?32+idx:slash>=2?64+idx:idx;
   pixels[row+x+1]=(p-previous)&255;previous=p;
  }
 }
 // Deterministic zlib stream, fixed Huffman codes and distance-one runs.
 const bytes=[];let bit=0,bits=0;
 function put(v,n){bit|=v<<bits;bits+=n;while(bits>=8){bytes.push(bit&255);bit>>>=8;bits-=8;}}
 function reverse(v,n){let r=0;while(n--){r=r*2+(v&1);v>>>=1;}return r;}
 function literal(v){if(v<=143)put(reverse(48+v,8),8);else if(v<=255)put(reverse(400+v-144,9),9);else if(v<=279)put(reverse(v-256,7),7);else put(reverse(192+v-280,8),8);}
 const lengths=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258],extra=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
 function repeat(n){let i=lengths.length-1;while(lengths[i]>n)i--;literal(257+i);put(n-lengths[i],extra[i]);put(0,5);}
 put(1,1);put(1,2);
 for(let i=0;i<pixels.length;){const v=pixels[i];literal(v);i++;let n=0;while(i+n<pixels.length&&pixels[i+n]===v)n++;i+=n;while(n>=3){const len=Math.min(258,n);repeat(len);n-=len;}while(n-->0)literal(v);}
 literal(256);if(bits)bytes.push(bit&255);let a=1,b=0;for(const v of pixels){a=(a+v)%65521;b=(b+a)%65521;}
 const z=concat([Uint8Array.of(0x78,0x01),Uint8Array.from(bytes),u32((b<<16)|a)]);
 return concat([Uint8Array.of(137,80,78,71,13,10,26,10),chunk('IHDR',concat([u32(size),u32(size),Uint8Array.of(8,3,0,0,0)])),chunk('PLTE',Uint8Array.from(palette)),chunk('IDAT',z),chunk('IEND',array(0))]);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const dir=new URL('../icons/',import.meta.url);mkdirSync(dir,{recursive:true});for(const [name,size,mask] of [['icon-192.png',192,false],['icon-512.png',512,false],['icon-maskable-512.png',512,true],['apple-touch-icon.png',180,false]])writeFileSync(new URL(name,dir),pngIcon(size,mask));}
