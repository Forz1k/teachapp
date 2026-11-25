// Local graphics studio. No asset upload or network request.
import {viewerTarget} from './public-portal.js';
export const templates=Object.freeze({matchday:'День матча',next:'Следующая встреча',lineup:'Стартовый состав',result:'Итоговый результат',win:'Победа',streak:'Серия побед',mvp:'Игрок матча',tournament:'Итоги турнира',poster:'Спортивная афиша',diploma:'Грамота',certificate:'Сертификат',achievement:'Достижение команды'});
export const formats=Object.freeze({square:[1080,1080],story:[1080,1920],wide:[1920,1080]});
export const studioLayouts=Object.freeze({classic:'Классика',arena:'Арена',editorial:'Редакционный'});
export const studioFocus=Object.freeze({center:'Центр',top:'Верх',bottom:'Низ',left:'Слева',right:'Справа'});
const clean=(v,n)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
const color=(v,f)=>typeof v==='string'&&/^#[a-fA-F0-9]{6}$/.test(v)?v:f;
export function studioStyle(raw={}){
 return {accent:color(raw?.accent,'#61e5b0'),background:color(raw?.background,'#101b31'),footer:clean(raw?.footer??'TeachApp · Волейбол',100),format:Object.hasOwn(formats,raw?.format)?raw.format:'square',layout:Object.hasOwn(studioLayouts,raw?.layout)?raw.layout:'classic',focus:Object.hasOwn(studioFocus,raw?.focus)?raw.focus:'center'};
}
const styleKey=scope=>'teachapp:studio-style:v1:'+encodeURIComponent(String(scope||'default').slice(0,200));
export function readStudioStyle(scope,storage=localStorage){
 try{return studioStyle(JSON.parse(storage.getItem(styleKey(scope))||'null'));}catch{return studioStyle();}
}
export function saveStudioStyle(scope,raw,storage=localStorage){
 const style=studioStyle(raw),value=JSON.stringify(style),key=styleKey(scope);storage.setItem(key,value);
 if(storage.getItem(key)!==value)throw Error('Не удалось сохранить оформление');return style;
}
export function resetStudioStyle(scope,storage=localStorage){storage.removeItem(styleKey(scope));return studioStyle();}
// Named, device-local presets contain only presentation fields. Never save assets.
const presetKey=scope=>'teachapp:studio-presets:v1:'+encodeURIComponent(String(scope||'default').slice(0,200));
const presetName=value=>clean(value,48);
export function studioPresetList(scope,storage=localStorage){
 try{const raw=JSON.parse(storage.getItem(presetKey(scope))||'[]');if(!Array.isArray(raw))return [];const list=[],seen=new Set();for(const row of raw.slice(0,12)){const name=presetName(row?.name);if(!name||seen.has(name.toLocaleLowerCase('ru')))continue;seen.add(name.toLocaleLowerCase('ru'));list.push({name,style:studioStyle(row.style)});}return list;}catch{return [];}
}
function persistPresets(scope,rows,storage){const k=presetKey(scope),value=JSON.stringify(rows);storage.setItem(k,value);if(storage.getItem(k)!==value)throw Error('Не удалось сохранить пресеты');return rows;}
export function saveStudioPreset(scope,name,raw,{replace=false,storage=localStorage}={}){
 name=presetName(name);if(!name)throw Error('Укажите название оформления');const rows=studioPresetList(scope,storage),i=rows.findIndex(x=>x.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru'));
 if(i>=0&&!replace)throw Error('Такое название уже существует');if(i<0&&rows.length>=12)throw Error('Не более 12 оформлений для команды');
 const row={name,style:studioStyle(raw)};if(i>=0)rows[i]=row;else rows.push(row);return persistPresets(scope,rows,storage);
}
export function removeStudioPreset(scope,name,storage=localStorage){return persistPresets(scope,studioPresetList(scope,storage).filter(x=>x.name!==name),storage);}
export function studioStyleFile(raw){return JSON.stringify({schema:1,kind:'teachapp-studio-style',style:studioStyle(raw)},null,2);}
export function parseStudioStyleFile(text){
 if(typeof text!=='string'||text.length>4096)throw Error('Некорректный файл оформления');
 let value;try{value=JSON.parse(text);}catch{throw Error('Не удалось прочитать JSON оформления');}
 if(!value||value.schema!==1||value.kind!=='teachapp-studio-style'||!value.style||typeof value.style!=='object'||Array.isArray(value.style))throw Error('Неподдерживаемый формат оформления');
 const s=value.style,allowed=['accent','background','footer','format','layout','focus'];
 if(Object.keys(value).some(k=>!['schema','kind','style'].includes(k))||Object.keys(s).some(k=>!allowed.includes(k)))throw Error('Файл содержит посторонние поля');
 if(!/^#[a-fA-F0-9]{6}$/.test(s.accent)||!/^#[a-fA-F0-9]{6}$/.test(s.background)||typeof s.footer!=='string'||s.footer.length>100||!Object.hasOwn(formats,s.format)||!Object.hasOwn(studioLayouts,s.layout)||!Object.hasOwn(studioFocus,s.focus))throw Error('Некорректные параметры оформления');
 return studioStyle(s);
}
export function studioInk(background){
 const luminance=c=>{const x=c.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*x[0]+.7152*x[1]+.0722*x[2];};
 const bg=luminance(color(background,'#101b31'));return (bg+.05)/.05>=1.05/(bg+.05)?'#000000':'#ffffff';
}
export function studioCrop(width,height,w,h,focus='center'){
 if(![width,height,w,h].every(x=>Number.isFinite(x)&&x>0))throw Error('Некорректные размеры фотографии');
 const k=Math.max(w/width,h/height),x=focus==='left'?0:focus==='right'?1:.5,y=focus==='top'?0:focus==='bottom'?1:.5;
 return {x:(w-width*k)*x,y:(h-height*k)*y,width:width*k,height:height*k};
}
export function studioModel(raw={}){
 const template=Object.hasOwn(templates,raw.template)?raw.template:'matchday';
 return {...studioStyle(raw),template,title:clean(raw.title||templates[template],80),team:clean(raw.team,100),opponent:clean(raw.opponent,100),score:clean(raw.score,24),details:clean(raw.details,500)};
}
export function studioPublication(raw={},link=''){
 const m=studioModel(raw),rows=[m.title,[m.team,m.opponent].filter(Boolean).join(' — '),m.score,m.details].filter(Boolean);
 if(link){
  // Accept only explicit HTTPS viewer links; no auth or arbitrary URL parameters.
  const u=new URL(link);if(u.protocol!=='https:'||!u.pathname.endsWith('/live/')||u.username||u.password)throw Error('Ссылка должна вести на публичную страницу TeachApp');
  rows.push(viewerTarget(u.href).share);
 }
 return rows.join('\n\n');
}
export function wrapStudioText(ctx,value,maxWidth,maxLines=4){
 const lines=[];let line='';for(const word of String(value).split(/\s+/).filter(Boolean)){let parts=[];let piece='';for(const ch of word){if(piece&&ctx.measureText(piece+ch).width>maxWidth){parts.push(piece);piece='';}piece+=ch;}if(piece)parts.push(piece);for(const p of parts){const candidate=line?line+' '+p:p;if(line&&ctx.measureText(candidate).width>maxWidth){lines.push(line);line=p;}else line=candidate;}}
 if(line)lines.push(line);if(lines.length<=maxLines)return lines;const result=lines.slice(0,maxLines);while(result.at(-1)&&ctx.measureText(result.at(-1)+'…').width>maxWidth)result[maxLines-1]=Array.from(result.at(-1)).slice(0,-1).join('');result[maxLines-1]+='…';return result;
}
export function paintStudio(canvas,raw,{logo=null,backgroundImage=null}={}){
 const d=studioModel(raw),[w,h]=formats[d.format];canvas.width=w;canvas.height=h;
 const x=canvas.getContext('2d');if(!x)throw Error('Canvas недоступен');
 const scale=Math.min(w,h),margin=w*.075,max=w-2*margin;
 x.fillStyle=d.background;x.fillRect(0,0,w,h);
 if(backgroundImage){const crop=studioCrop(backgroundImage.width,backgroundImage.height,w,h,d.focus);x.globalAlpha=.35;x.drawImage(backgroundImage,crop.x,crop.y,crop.width,crop.height);x.globalAlpha=1;}
 // An opaque text region guarantees contrast even with an arbitrary photo.
 const ink=studioInk(d.background),accentInk=studioInk(d.accent);
 if(backgroundImage){x.fillStyle=d.background;x.fillRect(margin*.55,h*.085,w-margin*1.1,h*.91);}
 x.fillStyle=d.accent;
 if(d.layout==='arena'){x.fillRect(0,0,w,h*.065);x.fillRect(0,0,scale*.022,h);}
 else if(d.layout==='editorial'){x.fillRect(margin,h*.065,max,Math.max(3,scale*.006));x.fillRect(margin,h*.875,max,Math.max(3,scale*.004));}
 else x.fillRect(margin,h*.07,w*.12,8);
 x.textAlign='left';x.textBaseline='top';
 const text=(str,y,size,weight,fill,maxLines=3,width=max)=>{
  x.font=weight+' '+Math.round(size)+'px system-ui, sans-serif';x.fillStyle=fill;
  const lines=wrapStudioText(x,str,width,maxLines);lines.forEach((l,i)=>x.fillText(l,margin,y+i*size*1.16));return y+lines.length*size*1.16;
 };
 const badge=scale*.105,gap=scale*.028,titleWidth=logo?max-badge-gap:max;
 let y=h*.11;
 if(logo){const k=Math.min(badge/logo.width,badge/logo.height);x.drawImage(logo,w-margin-logo.width*k,y,logo.width*k,logo.height*k);}
 y=Math.max(text(d.title,y,scale*.046,'700',ink,2,titleWidth),logo?y+badge:0)+scale*.024;
 y=text([d.team,d.opponent].filter(Boolean).join(' — '),y,scale*.065,'800',ink,3)+scale*.02;
 if(d.score){
  if(d.layout==='arena'){x.fillStyle=d.accent;x.fillRect(margin,y,max,scale*.145);y=text(d.score,y+scale*.008,scale*.101,'900',accentInk,1,max-scale*.02)+scale*.04;}
  else y=text(d.score,y,scale*.112,'900',ink,1)+scale*.025;
 }
 // Never move details back over the headline; reserve the footer's own space.
 const size=scale*.031,end=h*.855,available=Math.floor((end-y)/(size*1.16));
 if(d.details&&available>0)text(d.details,y,size,'500',ink,available);
 text(d.footer||'TeachApp Studio',h*.905,scale*.023,'600',ink,2);return d;
}
export function canvasPng(canvas){
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob&&blob.size?resolve(blob):reject(Error('Не удалось создать PNG')),'image/png'));
}
// ZIP32 stored entries, no external dependency or compression of already-compressed PNGs.
// Names restricted to simple ASCII, sizes bounded; a single file works on iOS and PC.
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function studioCrc32(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
export async function studioZip(entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>4)throw Error('Выберите до четырёх файлов');
 const encoder=new TextEncoder(),parts=[],central=[],names=new Set();let offset=0,centralSize=0,total=0;
 for(const {name,blob} of entries){
  if(typeof name!=='string'||!/^[-a-z0-9_]{1,80}\.(?:png|txt)$/.test(name)||names.has(name)||!(blob instanceof Blob))throw Error('Некорректный файл архива');
  names.add(name);total+=blob.size;if(total>32*1024*1024)throw Error('Архив превышает 32 МБ');
  const filename=encoder.encode(name),crc=studioCrc32(new Uint8Array(await blob.arrayBuffer())),size=blob.size;
  const local=new Uint8Array(30+filename.length),l=new DataView(local.buffer);
  l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,size,true);l.setUint32(22,size,true);l.setUint16(26,filename.length,true);local.set(filename,30);
  const header=new Uint8Array(46+filename.length),c=new DataView(header.buffer);
  c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,size,true);c.setUint32(24,size,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);header.set(filename,46);
  parts.push(local,blob);central.push(header);offset+=local.length+size;centralSize+=header.length;
 }
 const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
 return new Blob([...parts,...central,end],{type:'application/zip'});
}
export async function studioBatch(canvas,raw,selected,{logo=null,backgroundImage=null,text='',cancelled=()=>false}={}){
 if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some(k=>!Object.hasOwn(formats,k)))throw Error('Выберите форматы экспорта');
 const model=studioModel(raw),entries=[];
 try{
  for(const format of selected){
   if(cancelled())throw Error('Экспорт отменён');
   paintStudio(canvas,{...model,format},{logo,backgroundImage});
   entries.push({name:'teachapp-'+model.template+'-'+format+'.png',blob:await canvasPng(canvas)});
  }
  if(cancelled())throw Error('Экспорт отменён');
  if(text.trim())entries.push({name:'publication.txt',blob:new Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'})});
  return await studioZip(entries);
 }finally{canvas.width=1;canvas.height=1;}
}
