// Local graphics studio. No asset upload or network request.
import {viewerTarget} from './public-portal.js';
export const templates=Object.freeze({matchday:'День матча',next:'Следующая встреча',lineup:'Стартовый состав',result:'Итоговый результат',win:'Победа',streak:'Серия побед',mvp:'Игрок матча',tournament:'Итоги турнира',poster:'Спортивная афиша',diploma:'Грамота',certificate:'Сертификат',achievement:'Достижение команды'});
export const formats=Object.freeze({square:[1080,1080],story:[1080,1920],wide:[1920,1080]});
export const studioLayouts=Object.freeze({classic:'Классика',arena:'Арена',editorial:'Редакционный'});
export const studioLogoPositions=Object.freeze({right:'Справа',left:'Слева',none:'Скрыть'});
export const studioFocus=Object.freeze({center:'Центр',top:'Верх',bottom:'Низ',left:'Слева',right:'Справа',custom:'Точная настройка'});
const clean=(v,n)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
const color=(v,f)=>typeof v==='string'&&/^#[a-fA-F0-9]{6}$/.test(v)?v:f;
export function studioStyle(raw={}){
 return {accent:color(raw?.accent,'#61e5b0'),background:color(raw?.background,'#101b31'),footer:clean(raw?.footer??'TeachApp · Волейбол',100),format:Object.hasOwn(formats,raw?.format)?raw.format:'square',layout:Object.hasOwn(studioLayouts,raw?.layout)?raw.layout:'classic',focus:Object.hasOwn(studioFocus,raw?.focus)?raw.focus:'center',logoPosition:Object.hasOwn(studioLogoPositions,raw?.logoPosition)?raw.logoPosition:'right',photoOpacity:Number.isFinite(raw?.photoOpacity)?Math.max(0,Math.min(100,Math.round(raw.photoOpacity))):70,photoZoom:clamp(raw?.photoZoom,100,200,100),photoX:clamp(raw?.photoX,0,100,50),photoY:clamp(raw?.photoY,0,100,50)};
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
 const s=value.style,allowed=['accent','background','footer','format','layout','focus','logoPosition','photoOpacity','photoZoom','photoX','photoY'];
 if(Object.keys(value).some(k=>!['schema','kind','style'].includes(k))||Object.keys(s).some(k=>!allowed.includes(k)))throw Error('Файл содержит посторонние поля');
 if(!/^#[a-fA-F0-9]{6}$/.test(s.accent)||!/^#[a-fA-F0-9]{6}$/.test(s.background)||typeof s.footer!=='string'||s.footer.length>100||!Object.hasOwn(formats,s.format)||!Object.hasOwn(studioLayouts,s.layout)||!Object.hasOwn(studioFocus,s.focus)||(Object.hasOwn(s,'logoPosition')&&!Object.hasOwn(studioLogoPositions,s.logoPosition))||(Object.hasOwn(s,'photoOpacity')&&(!Number.isInteger(s.photoOpacity)||s.photoOpacity<0||s.photoOpacity>100))||(Object.hasOwn(s,'photoZoom')&&(!Number.isInteger(s.photoZoom)||s.photoZoom<100||s.photoZoom>200))||['photoX','photoY'].some(k=>Object.hasOwn(s,k)&&(!Number.isInteger(s[k])||s[k]<0||s[k]>100)))throw Error('Некорректные параметры оформления');
 return studioStyle(s);
}
export function studioInk(background){
 const luminance=c=>{const x=c.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*x[0]+.7152*x[1]+.0722*x[2];};
 const bg=luminance(color(background,'#101b31'));return (bg+.05)/.05>=1.05/(bg+.05)?'#000000':'#ffffff';
}
export function studioCrop(width,height,w,h,focus='center',zoom=100,photoX=50,photoY=50){
 if(![width,height,w,h].every(x=>Number.isFinite(x)&&x>0))throw Error('Некорректные размеры фотографии');
 if(!Number.isFinite(zoom)||zoom<100||zoom>200)throw Error('Масштаб фотографии должен быть от 100 до 200%');
 if(focus==='custom'&&(![photoX,photoY].every(v=>Number.isFinite(v)&&v>=0&&v<=100)))throw Error('Положение фотографии должно быть от 0 до 100%');
 const k=Math.max(w/width,h/height)*zoom/100,x=focus==='custom'?photoX/100:focus==='left'?0:focus==='right'?1:.5,y=focus==='custom'?photoY/100:focus==='top'?0:focus==='bottom'?1:.5;
 return {x:(w-width*k)*x||0,y:(h-height*k)*y||0,width:width*k,height:height*k};
}
const clamp=(value,min,max,fallback)=>Number.isFinite(value)?Math.min(max,Math.max(min,Math.round(value))):fallback;
export const studioLayerLimit=6;
export const studioLayerAlign=Object.freeze({left:'Слева',center:'По центру',right:'Справа'});
export const studioLayerVertical=Object.freeze({top:'Сверху',middle:'По центру',bottom:'Снизу'});
export function studioLayers(raw){
 if(!Array.isArray(raw))return [];
 return raw.slice(0,studioLayerLimit).filter(l=>l&&['text','rect','ellipse'].includes(l.kind)).map(l=>{
  const x=clamp(l.x,0,95,10),y=clamp(l.y,0,95,70),width=clamp(l.width,5,100-x,40),height=clamp(l.height,5,100-y,12);
  return {kind:l.kind,x,y,width:Math.min(width,100-x),height:Math.min(height,100-y),color:color(l.color,'#ffffff'),opacity:clamp(l.opacity,0,100,100),...(l.kind==='text'?{text:clean(l.text,160),size:clamp(l.size,1,12,4),align:Object.hasOwn(studioLayerAlign,l.align)?l.align:'left',vertical:Object.hasOwn(studioLayerVertical,l.vertical)?l.vertical:'top'}:{})};
 });
}
/** Duplicate only an existing transient layer, immediately above the original.
 * Keep its size; offset by up to 3 percentage points within the canvas. */
export function duplicateStudioLayer(raw,index){
 const layers=studioLayers(raw);
 if(!Number.isInteger(index)||index<0||index>=layers.length)throw Error('Слой не найден');
 if(layers.length>=studioLayerLimit)throw Error('Максимум '+studioLayerLimit+' слоёв');
 const l=layers[index],copy={...l,x:Math.min(100-l.width,l.x+3),y:Math.min(100-l.height,l.y+3)};
 layers.splice(index+1,0,copy);return layers;
}
/** Extra layers are transient, rendered in list order, and never stored in style presets. */
export function paintStudioLayers(ctx,layers,w,h){
 for(const l of studioLayers(layers)){
  const x=w*l.x/100,y=h*l.y/100,width=w*l.width/100,height=h*l.height/100;
  ctx.save();
  try{
   ctx.globalAlpha=l.opacity/100;ctx.fillStyle=l.color;
   ctx.beginPath();ctx.rect(x,y,width,height);ctx.clip();
   if(l.kind==='rect'){ctx.fillRect(x,y,width,height);continue;}
   if(l.kind==='ellipse'){ctx.beginPath();ctx.ellipse(x+width/2,y+height/2,width/2,height/2,0,0,2*Math.PI);ctx.fill();continue;}
   const size=Math.max(1,Math.round(Math.min(w,h)*l.size/100)),lineHeight=size*1.16;
   ctx.font='700 '+size+'px system-ui, sans-serif';ctx.textAlign=l.align;ctx.textBaseline='top';
   const maxLines=Math.floor(height/lineHeight);if(!maxLines)continue;
   const lines=wrapStudioText(ctx,l.text,width,maxLines),free=Math.max(0,height-lines.length*lineHeight);
   const anchor=x+(l.align==='center'?width/2:l.align==='right'?width:0);
   const start=y+(l.vertical==='middle'?free/2:l.vertical==='bottom'?free:0);
   lines.forEach((line,i)=>ctx.fillText(line,anchor,start+i*lineHeight));
  }finally{ctx.restore();}
 }
}
export function studioModel(raw={}){
 const template=Object.hasOwn(templates,raw.template)?raw.template:'matchday';
 return {...studioStyle(raw),template,title:clean(raw.title||templates[template],80),team:clean(raw.team,100),opponent:clean(raw.opponent,100),score:clean(raw.score,24),details:clean(raw.details,500),layers:studioLayers(raw.layers)};
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
 if(backgroundImage){const crop=studioCrop(backgroundImage.width,backgroundImage.height,w,h,d.focus,d.photoZoom,d.photoX,d.photoY);x.globalAlpha=d.photoOpacity/100;x.drawImage(backgroundImage,crop.x,crop.y,crop.width,crop.height);x.globalAlpha=1;}
 // Opaque backing under text guarantees contrast while leaving the rest of a photo visible.
 const ink=studioInk(d.background),accentInk=studioInk(d.accent);
 x.fillStyle=d.accent;
 if(d.layout==='arena'){x.fillRect(0,0,w,h*.065);x.fillRect(0,0,scale*.022,h);}
 else if(d.layout==='editorial'){x.fillRect(margin,h*.065,max,Math.max(3,scale*.006));x.fillRect(margin,h*.875,max,Math.max(3,scale*.004));}
 else x.fillRect(margin,h*.07,w*.12,8);
 x.textAlign='left';x.textBaseline='top';
 const text=(str,y,size,weight,fill,maxLines=3,width=max,panel=d.background,left=margin)=>{
  x.font=weight+' '+Math.round(size)+'px system-ui, sans-serif';
  const lines=wrapStudioText(x,str,width,maxLines);lines.forEach((l,i)=>{
   const top=y+i*size*1.16,pad=scale*.008;
   if(backgroundImage&&panel){x.fillStyle=panel;x.fillRect(left-pad,top-pad,Math.min(width,x.measureText(l).width)+pad*2,size*1.16+pad*2);}
   x.fillStyle=fill;x.fillText(l,left,top);
  });return y+lines.length*size*1.16;
 };
 const visibleLogo=logo&&d.logoPosition!=='none',badge=scale*.105,gap=scale*.028,titleWidth=visibleLogo?max-badge-gap:max;
 const titleLeft=visibleLogo&&d.logoPosition==='left'?margin+badge+gap:margin;
 let y=h*.11;
 if(visibleLogo){const k=Math.min(badge/logo.width,badge/logo.height);x.drawImage(logo,d.logoPosition==='left'?margin:w-margin-logo.width*k,y,logo.width*k,logo.height*k);}
 y=Math.max(text(d.title,y,scale*.046,'700',ink,2,titleWidth,d.background,titleLeft),visibleLogo?y+badge:0)+scale*.024;
 y=text([d.team,d.opponent].filter(Boolean).join(' — '),y,scale*.065,'800',ink,3)+scale*.02;
 if(d.score){
  if(d.layout==='arena'){x.fillStyle=d.accent;x.fillRect(margin,y,max,scale*.145);y=text(d.score,y+scale*.008,scale*.101,'900',accentInk,1,max-scale*.02,null)+scale*.04;}
  else y=text(d.score,y,scale*.112,'900',ink,1)+scale*.025;
 }
 // Never move details back over the headline; reserve the footer's own space.
 const size=scale*.031,end=h*.855,available=Math.floor((end-y)/(size*1.16));
 if(d.details&&available>0)text(d.details,y,size,'500',ink,available);
 text(d.footer||'TeachApp Studio',h*.905,scale*.023,'600',ink,2);paintStudioLayers(x,d.layers,w,h);return d;
}
export function canvasPng(canvas){
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob&&blob.size?resolve(blob):reject(Error('Не удалось создать PNG')),'image/png'));
}
// ZIP32 stored entries, no external dependency or compression of already-compressed PNGs.
// Names restricted to simple ASCII, sizes bounded; a single file works on iOS and PC.
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function studioCrc32(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
export async function studioZip(entries){
 if(!Array.isArray(entries)||!entries.length||entries.length>8)throw Error('Выберите до восьми файлов');
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

/** A match package uses the explicit team names and result, never a guessed winner/date.
 * Matchday and result details are separate to avoid exposing the score on the poster. */
export function studioMatchKit(raw={},eventDetails=''){
 const m=studioModel(raw);
 if(!m.team||!m.opponent)throw Error('Укажите обе команды');
 const score=m.score.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
 if(!score||Number(score[1])===Number(score[2]))throw Error('Укажите итоговый счёт в формате 3:1 (без ничьей)');
 const event=clean(eventDetails,500);
 if(!event)throw Error('Укажите дату, время или место встречи для афиши');
 const base={...studioStyle(m),team:m.team,opponent:m.opponent};
 return [studioModel({...base,template:'matchday',details:event}),studioModel({...base,template:'result',score:m.score,details:m.details})];
}
export async function studioMatchPackage(canvas,raw,selected,{eventDetails='',logo=null,backgroundImage=null,includeText=false,link='',cancelled=()=>false}={}){
 const entries=[],models=studioMatchKit(raw,eventDetails);
 if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some(k=>!Object.hasOwn(formats,k)))throw Error('Выберите форматы экспорта');
 let total=0;
 const add=(name,blob)=>{total+=blob.size;if(total>32*1024*1024)throw Error('Архив превышает 32 МБ. Выберите меньше форматов или другую фотографию.');entries.push({name,blob});};
 try{
  for(const model of models){
   for(const format of selected){
    if(cancelled())throw Error('Экспорт отменён');
    paintStudio(canvas,{...model,format},{logo,backgroundImage});
    add('teachapp-'+model.template+'-'+format+'.png',await canvasPng(canvas));
   }
   if(includeText){const text=studioPublication(model,link);add(model.template+'-publication.txt',new Blob(['\uFEFF'+text],{type:'text/plain;charset=utf-8'}));}
  }
  if(cancelled())throw Error('Экспорт отменён');
  return await studioZip(entries);
 }finally{canvas.width=1;canvas.height=1;}
}
