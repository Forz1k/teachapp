// Strict text-layer reader for the Dart PDF format exported by VolleyPoint.
const bad=()=>{throw Error('Неподдерживаемый PDF VolleyPoint: требуется исходный PDF с текстовым слоем.');};
const limit=8*1024*1024;
async function inflate(bytes){
 if(!globalThis.DecompressionStream)throw Error('Этот браузер не поддерживает локальное распаковывание PDF.');
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
 const chunks=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)bad();chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const out=new Uint8Array(size);let p=0;for(const c of chunks){out.set(c,p);p+=c.length;}return new TextDecoder('latin1').decode(out);
}
export async function extractVolleyPdf(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length>limit)bad();
 const raw=new TextDecoder('latin1').decode(bytes);if(!raw.startsWith('%PDF-')||!/\/Creator\s*\(VolleyPoint\)/.test(raw)||/\/Encrypt\b|\/ObjStm\b/.test(raw))bad();
 const objects=new Map();const header=/(?:^|[\r\n])(\d+) 0 obj\s*/g;let m;
 while((m=header.exec(raw))){const start=header.lastIndex,end=raw.indexOf('endobj',start),stream=/stream\r?\n/g;stream.lastIndex=start;const s=stream.exec(raw);if(end<0)bad();let dict=raw.slice(start,end),data=null;
  if(s&&s.index<end){dict=raw.slice(start,s.index);const len=/\/Length\s+(\d+)\b(?!\s+0\s+R)/.exec(dict);if(!len||Number(len[1])>limit)bad();const stop=stream.lastIndex+Number(len[1]);if(!/^\r?\n?endstream\s*endobj/.test(raw.slice(stop,stop+80)))bad();data=bytes.slice(stream.lastIndex,stop);header.lastIndex=stop+9;}else header.lastIndex=end+6;
  if(objects.has(+m[1])||objects.size>=2000)bad();objects.set(+m[1],{dict,data});
 }
 const get=id=>{const o=objects.get(+id);if(!o)bad();return o;};
 let total=0;async function read(id){const o=get(id);if(!o.data)bad();if(/\/Filter\s*\/FlateDecode\b/.test(o.dict)){const s=await inflate(o.data);total+=s.length;if(total>limit*2)bad();return s;}if(/\/Filter\b/.test(o.dict))bad();return new TextDecoder('latin1').decode(o.data);}
 const pages=[...objects.values()].filter(o=>/\/Type\s*\/Pages\b/.test(o.dict));if(pages.length!==1)bad();const kids=/\/Kids\s*\[([^\]]+)\]/.exec(pages[0].dict);if(!kids)bad();const ids=[...kids[1].matchAll(/(\d+) 0 R/g)].map(x=>+x[1]);if(!ids.length||ids.length>100)bad();
 const fonts=new Map();async function cmap(id){if(fonts.has(id))return fonts.get(id);const ref=/\/ToUnicode\s+(\d+) 0 R/.exec(get(id).dict);if(!ref)bad();const data=await read(ref[1]);const map=new Map();for(const block of data.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const pair of block[1].matchAll(/<([\da-f]{4})>\s*<([\da-f]{4})>/gi))map.set(pair[1].toUpperCase(),String.fromCharCode(parseInt(pair[2],16)));if(!map.size||/beginbfrange/.test(data))bad();fonts.set(id,map);return map;}
 const rows=[];
 for(const id of ids){const page=get(id).dict;const fontPart=/\/Font\s*<<([\s\S]*?)>>/.exec(page),content=/\/Contents\s+(\d+) 0 R/.exec(page);if(!fontPart||!content)bad();const fm=new Map();for(const f of fontPart[1].matchAll(/\/(F\d+)\s+(\d+) 0 R/g))fm.set(f[1],await cmap(f[2]));const data=await read(content[1]);let x=0,y=0;const stack=[],words=[];const tokens=/\bBT\b([\s\S]*?)\bET\b|(?:^|\s)(q|Q)(?=\s|$)|([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+cm\b/g;
  for(const t of data.matchAll(tokens)){if(t[1]!==undefined){const a=/^\s*\/(F\d+)\s+([\d.]+) Tf\s+0 Tc\s+([+-]?[\d.]+)\s+([+-]?[\d.]+) Td\s*\[<([\da-f]+)>\]TJ\s*$/i.exec(t[1]);if(!a||!fm.has(a[1])||a[5].length%4)bad();let value='';for(const c of a[5].match(/.{4}/g)){const u=fm.get(a[1]).get(c.toUpperCase());if(u===undefined)bad();value+=u;}words.push({x:x+Number(a[3]),y:y+Number(a[4]),value});}else if(t[2]==='q')stack.push([x,y]);else if(t[2]==='Q'){if(!stack.length)bad();[x,y]=stack.pop();}else{if(+t[3]!==1||+t[4]!==0||+t[5]!==0||+t[6]!==1)bad();x+=Number(t[7]);y+=Number(t[8]);}}
  if(stack.length||!words.length||words.length>30000)bad();words.sort((a,b)=>b.y-a.y||a.x-b.x);const lines=[];for(const w of words){let line=lines.at(-1);if(!line||Math.abs(w.y-line.y)>1.5){line={y:w.y,words:[]};lines.push(line);}line.words.push(w);}for(const line of lines){const s=line.words.sort((a,b)=>a.x-b.x).map(w=>w.value).join(' ').trim();if(s)rows.push(s);}
 }
 return rows;
}
