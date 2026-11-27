import test from 'node:test';import assert from 'node:assert/strict';import {templates,formats,studioModel,wrapStudioText,studioStyle,readStudioStyle,saveStudioStyle,resetStudioStyle,studioPublication,studioZip,studioCrc32,paintStudio,studioBatch,studioLayouts,studioCrop,studioInk,studioPresetList,saveStudioPreset,removeStudioPreset,studioStyleFile,parseStudioStyleFile,studioMatchKit,studioMatchPackage} from '../js/media-studio.js';
test('12 templates and three formats, safe explicit model',()=>{assert.equal(Object.keys(templates).length,12);assert.equal(Object.keys(formats).length,3);const m=studioModel({template:'bad',format:'bad',team:'A\nB',accent:'javascript:',private:'secret'});assert.equal(m.team,'A B');assert.equal(m.template,'matchday');assert.equal(m.accent,'#61e5b0');assert.equal(Object.hasOwn(m,'private'),false);});
test('long words wrap and truncate within width',()=>{const ctx={measureText:s=>({width:s.length})};const lines=wrapStudioText(ctx,'1234567890 second third',4,2);assert.equal(lines.length,2);assert.ok(lines.every(x=>x.length<=4));assert.match(lines.at(-1),/…$/);});

test('Studio styles are device/team scoped and only persist approved presentation fields',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const a=saveStudioStyle('a',{accent:'#ff1234',background:'#000000',footer:'Клуб',format:'story',team:'PRIVATE',photo:'secret',details:'hidden'},storage);
 assert.deepEqual(readStudioStyle('a',storage),a);assert.deepEqual(readStudioStyle('b',storage),studioStyle());
 assert.ok(!JSON.stringify([...map]).includes('PRIVATE'));assert.ok(!JSON.stringify([...map]).includes('secret'));
 resetStudioStyle('a',storage);assert.deepEqual(readStudioStyle('a',storage),studioStyle());
 assert.throws(()=>saveStudioStyle('a',a,{getItem:()=>null,setItem(){}}));
});
test('Publication is a deterministic text draft with no fabricated outcome or credentials',()=>{
 const m={template:'result',team:'A',opponent:'B',score:'2:1',details:'25:20 / 20:25 / 15:12',private:'secret'};
 assert.equal(studioPublication(m),'Итоговый результат\n\nA — B\n\n2:1\n\n25:20 / 20:25 / 15:12');
 const link='https://example.com/live/?db=https%3A%2F%2Fdemo.firebaseio.com&owner=a&team=b&fixture=f&auth=secret#private';
 const text=studioPublication(m,link);assert.ok(text.includes('fixture=f'));assert.ok(!text.includes('secret'));assert.ok(!text.includes('#private'));
 assert.throws(()=>studioPublication(m,'https://example.com/private/'));assert.throws(()=>studioPublication(m,'http://example.com/live/'));
});
test('Stored ZIP has correct headers, offsets, CRC32, filename restrictions and end directory',async()=>{
 assert.equal(studioCrc32(new TextEncoder().encode('123456789')),0xcbf43926);
 const entries=[{name:'test.png',blob:new Blob([Uint8Array.of(1,2,3)])},{name:'publication.txt',blob:new Blob(['Привет'])}];
 const b=new Uint8Array(await (await studioZip(entries)).arrayBuffer()),v=new DataView(b.buffer),decode=new TextDecoder();let offset=0;
 for(const entry of entries){assert.equal(v.getUint32(offset,true),0x04034b50);const n=v.getUint16(offset+26,true),s=v.getUint32(offset+18,true),start=offset+30+n;assert.equal(decode.decode(b.subarray(offset+30,start)),entry.name);assert.equal(s,entry.blob.size);assert.equal(v.getUint32(offset+14,true),studioCrc32(b.subarray(start,start+s)));assert.deepEqual(b.subarray(start,start+s),new Uint8Array(await entry.blob.arrayBuffer()));offset=start+s;}
 const central=offset;for(const entry of entries){assert.equal(v.getUint32(offset,true),0x02014b50);assert.equal(v.getUint32(v.getUint32(offset+42,true),true),0x04034b50);offset+=46+v.getUint16(offset+28,true);}
 assert.equal(v.getUint32(offset,true),0x06054b50);assert.equal(v.getUint16(offset+10,true),2);assert.equal(v.getUint32(offset+16,true),central);assert.equal(offset+22,b.length);
 await assert.rejects(studioZip([entries[0],entries[0]]));await assert.rejects(studioZip([{name:'../bad.txt',blob:new Blob(['x'])}]));
});
test('Batch exports chosen sizes sequentially, releases working canvas and rejects invalid selection',async()=>{
 const sizes=[],ctx={measureText:s=>({width:s.length*20}),fillRect(){},fillText(){},drawImage(){}},canvas={width:0,height:0,getContext:()=>ctx,toBlob(cb){sizes.push([this.width,this.height]);cb(new Blob(['png']));}};
 const blob=await studioBatch(canvas,{team:'A'},['story','wide'],{text:'Draft'});assert.equal(blob.type,'application/zip');assert.deepEqual(sizes,[[1080,1920],[1920,1080]]);assert.equal(canvas.width,1);
 await assert.rejects(studioBatch(canvas,{},['square','square']));await assert.rejects(studioBatch(canvas,{},['square'],{cancelled:()=>true}));
});
test('Studio long team names, logo and scores leave footer separate in every format',()=>{
 for(const format of Object.keys(formats)){const lines=[],ctx={font:'',measureText(s){return {width:s.length*Number(this.font.match(/(\d+)px/)?.[1]||20)*.55};},fillRect(){},fillText(t,x,y){lines.push({t,x,y,font:this.font});},drawImage(){}};
 const canvas={getContext:()=>ctx};
 paintStudio(canvas,{format,title:'Очень длинный заголовок '.repeat(8),team:'Очень длинное название команды '.repeat(8),opponent:'Другая команда '.repeat(8),score:'25 : 23',details:'Подробности '.repeat(40),footer:'Footer'},{logo:{width:100,height:100}});
 assert.ok(lines.every((r,i)=>i===0||r.y>=lines[i-1].y));assert.ok(lines.every(r=>r.y<canvas.height));assert.ok(lines.some(r=>r.t==='Footer'));
 }
});

test('Reusable styles are isolated, bounded, explicit replacement and portable whitelisted JSON',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const raw={layout:'arena',focus:'top',accent:'#ff0000',background:'#ffffff',team:'PRIVATE',photo:'secret'};
 saveStudioPreset('a','Домашний',raw,{storage});assert.equal(studioPresetList('b',storage).length,0);
 assert.throws(()=>saveStudioPreset('a','домашний',raw,{storage}));saveStudioPreset('a','домашний',{...raw,layout:'editorial'},{storage,replace:true});
 assert.equal(studioPresetList('a',storage)[0].style.layout,'editorial');assert.ok(!JSON.stringify([...map]).includes('PRIVATE'));
 for(let i=0;i<11;i++)saveStudioPreset('a','p'+i,raw,{storage});assert.throws(()=>saveStudioPreset('a','13',raw,{storage}));
 removeStudioPreset('a','p0',storage);assert.equal(studioPresetList('a',storage).length,11);
 const serialized=studioStyleFile(raw);assert.deepEqual(parseStudioStyleFile(serialized),studioStyle(raw));assert.ok(!serialized.includes('secret'));
 const invalid=JSON.parse(serialized);invalid.style.photo='secret';assert.throws(()=>parseStudioStyleFile(JSON.stringify(invalid)));assert.throws(()=>parseStudioStyleFile('x'.repeat(4097)));
 assert.equal(studioStyle({}).layout,'classic');assert.equal(studioStyle({}).focus,'center');
});
test('Contrast chooses readable black or white and crop anchors preserve cover dimensions',()=>{
 assert.equal(studioInk('#ffffff'),'#000000');assert.equal(studioInk('#000000'),'#ffffff');
 assert.deepEqual(studioCrop(200,100,100,100,'left'),{x:0,y:0,width:200,height:100});
 assert.deepEqual(studioCrop(200,100,100,100,'right'),{x:-100,y:0,width:200,height:100});
 assert.deepEqual(studioCrop(100,200,100,100,'bottom'),{x:0,y:-100,width:100,height:200});
 assert.throws(()=>studioCrop(0,100,100,100));
});
test('All three designs keep text inside canvas and reserve footer in all formats',()=>{
 for(const layout of Object.keys(studioLayouts))for(const format of Object.keys(formats)){
  const lines=[],ctx={font:'',measureText(s){return {width:s.length*Number(this.font.match(/(\d+)px/)?.[1]||20)*.55};},fillRect(){},fillText(t,x,y){lines.push({t,x,y,font:this.font,fill:this.fillStyle});},drawImage(){}},canvas={getContext:()=>ctx};
  paintStudio(canvas,{layout,format,background:'#ffffff',accent:'#eeeeee',team:'Очень длинное название '.repeat(7),opponent:'Другая команда '.repeat(7),score:'25 : 23',details:'Текст '.repeat(80),footer:'Footer'},{backgroundImage:{width:200,height:100},logo:{width:100,height:100}});
  assert.ok(lines.every((r,i)=>i===0||r.y>=lines[i-1].y));assert.ok(lines.every(r=>r.y<canvas.height));assert.ok(lines.some(r=>r.t==='Footer'&&r.fill==='#000000'));
 }
});

test('Match package separates event and result, preserves explicit score, and produces unique bounded files',async()=>{
 const raw={team:'А',opponent:'Б',score:'3:1',details:'25:19 / 21:25 / 25:20 / 25:18',layout:'arena',private:'SECRET',title:'Не переносить'};
 const cards=studioMatchKit(raw,'12 декабря · зал');assert.equal(cards[0].score,'');assert.equal(cards[0].details,'12 декабря · зал');assert.equal(cards[1].score,'3:1');assert.equal(cards[1].details,raw.details);assert.equal(cards[0].title,'День матча');assert.equal(cards[1].title,'Итоговый результат');assert.ok(!JSON.stringify(cards).includes('SECRET'));
 assert.throws(()=>studioMatchKit({...raw,score:'3:3'},'Зал'));assert.throws(()=>studioMatchKit(raw,''));assert.throws(()=>studioMatchKit({...raw,opponent:''},'Зал'));
 const sizes=[],ctx={measureText:s=>({width:s.length*20}),fillRect(){},fillText(){},drawImage(){}},canvas={width:0,height:0,getContext:()=>ctx,toBlob(cb){sizes.push([this.width,this.height]);cb(new Blob(['png']));}};
 const blob=await studioMatchPackage(canvas,raw,['square','story','wide'],{eventDetails:'Зал',includeText:true});
 const bytes=new Uint8Array(await blob.arrayBuffer()),v=new DataView(bytes.buffer),decode=new TextDecoder();let i=0;const names=[],texts=[];
 while(v.getUint32(i,true)===0x04034b50){const n=v.getUint16(i+26,true),size=v.getUint32(i+18,true),start=i+30+n,name=decode.decode(bytes.subarray(i+30,start));names.push(name);if(name.endsWith('.txt'))texts.push(decode.decode(bytes.subarray(start,start+size)));i=start+size;}
 assert.equal(names.length,8);assert.equal(new Set(names).size,8);assert.equal(sizes.length,6);assert.equal(canvas.width,1);
 assert.ok(!texts[0].includes('3:1'));assert.ok(texts[1].includes('3:1'));assert.ok(!texts[1].includes('Зал'));
 await assert.rejects(studioMatchPackage(canvas,raw,['square'],{eventDetails:'Зал',cancelled:()=>true}));
});

test('Studio photo opacity and logo placement are bounded, portable and backward-compatible',()=>{const raw={photoOpacity:35,logoPosition:'left'};assert.deepEqual(parseStudioStyleFile(studioStyleFile(raw)),studioStyle(raw));const old=JSON.parse(studioStyleFile({}));delete old.style.photoOpacity;delete old.style.logoPosition;assert.equal(parseStudioStyleFile(JSON.stringify(old)).photoOpacity,70);assert.equal(studioStyle({photoOpacity:200}).photoOpacity,100);old.style.photoOpacity=-1;assert.throws(()=>parseStudioStyleFile(JSON.stringify(old)));const pictures=[],lines=[],ctx={globalAlpha:1,measureText:s=>({width:s.length*10}),fillRect(){},fillText(t,x){lines.push({t,x});},drawImage(img,x,y){pictures.push({img,x,y,alpha:this.globalAlpha});}},canvas={getContext:()=>ctx};const logo={width:100,height:100},photo={width:300,height:200};paintStudio(canvas,{...raw,title:'Title'},{logo,backgroundImage:photo});assert.equal(pictures[0].alpha,.35);assert.ok(lines[0].x>pictures[1].x);pictures.length=0;paintStudio(canvas,{logoPosition:'none'},{logo});assert.equal(pictures.length,0);});

import {studioLayers,paintStudioLayers} from '../js/media-studio.js';
test('Transient Studio layers are bounded and ordered; style and match kit never store private layer text',()=>{const raw={team:'A',opponent:'B',score:'2:0',layers:[{kind:'rect',x:95,y:95,width:90,height:50,color:'#123456',opacity:70},{kind:'text',x:5,y:5,width:40,height:20,size:4,text:'PRIVATE'}]};const ls=studioLayers(raw.layers);assert.equal(ls[0].width,5);assert.equal(ls[0].height,5);assert.equal(ls[1].text,'PRIVATE');assert.equal(studioLayers(Array(10).fill(raw.layers[0])).length,6);assert.doesNotMatch(studioStyleFile(raw),/PRIVATE|layers/);assert.ok(studioMatchKit(raw,'Hall').every(x=>x.layers.length===0));const seen=[],ctx={save(){},restore(){},beginPath(){},rect(...x){seen.push(['clip',...x]);},clip(){},fillRect(...x){seen.push(['rect',...x,this.globalAlpha]);},fillText(t,x,y){seen.push(['text',t,x,y]);},measureText(s){return {width:s.length*10};}};paintStudioLayers(ctx,ls,1080,1920);assert.deepEqual(seen[0],['clip',1026,1824,54,96]);assert.equal(seen[1][5],.7);assert.equal(seen[3][1],'PRIVATE');});

import {duplicateStudioLayer} from '../js/media-studio.js';
test('Studio text alignment is backward-compatible, clipped and relative to each layer',()=>{
 const old=studioLayers([{kind:'text',text:'Old'}])[0];assert.equal(old.align,'left');assert.equal(old.vertical,'top');
 const malformed=studioLayers([{kind:'text',align:'start',vertical:'baseline'}])[0];assert.equal(malformed.align,'left');assert.equal(malformed.vertical,'top');
 const seen=[],ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},measureText(s){return {width:s.length*10};},fillText(t,x,y){seen.push({t,x,y,align:this.textAlign});}};
 const layer={kind:'text',text:'Line',x:10,y:20,width:40,height:20,size:5};
 paintStudioLayers(ctx,[{...layer,align:'center',vertical:'middle'},{...layer,align:'right',vertical:'bottom'}],1000,1000);
 assert.equal(seen[0].align,'center');assert.equal(seen[0].x,300);assert.ok(Math.abs(seen[0].y-271)<.001);
 assert.equal(seen[1].align,'right');assert.equal(seen[1].x,500);assert.ok(Math.abs(seen[1].y-342)<.001);
 assert.doesNotMatch(studioStyleFile({layers:[{...layer,align:'center'}]}),/layers|Line/);
});
test('Duplicate Studio layer preserves dimensions and styles without sharing object or exceeding limits',()=>{
 const a={kind:'text',x:60,y:80,width:40,height:20,text:'A',align:'right',vertical:'bottom'},b={kind:'rect',x:10,y:10,width:20,height:20};
 const rows=duplicateStudioLayer([a,b],0);
 assert.equal(rows.length,3);assert.deepEqual(rows[1],rows[0]);assert.notEqual(rows[1],rows[0]);assert.equal(rows[2].kind,'rect');
 const moved=duplicateStudioLayer([{...a,x:10,y:10}],0)[1];assert.equal(moved.x,13);assert.equal(moved.y,13);assert.equal(moved.width,40);assert.equal(moved.align,'right');
 assert.throws(()=>duplicateStudioLayer([a],1),/Слой/);assert.throws(()=>duplicateStudioLayer(Array(6).fill(a),0),/Максимум/);
});

test('Studio photo zoom is portable, bounded and keeps cover alignment in every format',()=>{
 const style=studioStyle({photoZoom:175});assert.equal(style.photoZoom,175);
 assert.equal(studioStyle({photoZoom:5}).photoZoom,100);assert.equal(studioStyle({photoZoom:300}).photoZoom,200);
 const file=JSON.parse(studioStyleFile(style));assert.equal(parseStudioStyleFile(JSON.stringify(file)).photoZoom,175);
 delete file.style.photoZoom;assert.equal(parseStudioStyleFile(JSON.stringify(file)).photoZoom,100);
 file.style.photoZoom=201;assert.throws(()=>parseStudioStyleFile(JSON.stringify(file)));
 assert.deepEqual(studioCrop(200,100,100,100,'right',150),{x:-200,y:-25,width:300,height:150});
 assert.deepEqual(studioCrop(100,200,100,100,'top',200),{x:-50,y:0,width:200,height:400});
 for(const [w,h] of Object.values(formats))for(const focus of ['left','right','top','bottom','center']){
  const r=studioCrop(320,240,w,h,focus,150);assert.ok(r.x<=0&&r.y<=0&&r.x+r.width>=w-1e-8&&r.y+r.height>=h-1e-8);
 }
 assert.throws(()=>studioCrop(100,100,100,100,'center',99));
 const draws=[],ctx={measureText:s=>({width:s.length*10}),fillRect(){},fillText(){},drawImage(...args){draws.push(args);}},canvas={getContext:()=>ctx},img={width:100,height:100};
 paintStudio(canvas,{photoZoom:150,focus:'right'},{backgroundImage:img});
 assert.deepEqual(draws[0],[img,-540,-270,1620,1620]);
 assert.ok(studioMatchKit({team:'A',opponent:'B',score:'2:0',photoZoom:150},'Hall').every(c=>c.photoZoom===150));
});

test('Fine photo positioning is bounded, backward-compatible and used for every render format',()=>{
 const raw={focus:'custom',photoX:25,photoY:75,photoZoom:150};
 assert.deepEqual(studioCrop(200,100,100,100,'custom',150,25,75),{x:-50,y:-37.5,width:300,height:150});
 assert.throws(()=>studioCrop(200,100,100,100,'custom',150,-1,75));
 assert.deepEqual(parseStudioStyleFile(studioStyleFile(raw)),studioStyle(raw));
 const old=JSON.parse(studioStyleFile({}));delete old.style.photoX;delete old.style.photoY;
 assert.equal(parseStudioStyleFile(JSON.stringify(old)).photoX,50);
 old.style.photoY=101;assert.throws(()=>parseStudioStyleFile(JSON.stringify(old)));
 for(const [w,h] of Object.values(formats))for(const x of [0,25,100])for(const y of [0,75,100]){
  const r=studioCrop(320,240,w,h,'custom',150,x,y);
  assert.ok(r.x<=0&&r.y<=0&&r.x+r.width>=w-1e-8&&r.y+r.height>=h-1e-8);
 }
 const draws=[],ctx={measureText:s=>({width:s.length*10}),fillRect(){},fillText(){},drawImage(...args){draws.push(args);}},canvas={getContext:()=>ctx},img={width:200,height:100};
 paintStudio(canvas,raw,{backgroundImage:img});const crop=studioCrop(200,100,1080,1080,'custom',150,25,75);
 assert.deepEqual(draws[0],[img,crop.x,crop.y,crop.width,crop.height]);
 assert.ok(studioMatchKit({...raw,team:'A',opponent:'B',score:'2:0'},'Hall').every(c=>c.photoX===25&&c.photoY===75));
});
test('Ellipse layer stays inside normalized canvas bounds and is excluded from styles and match kits',()=>{
 const ellipse={kind:'ellipse',x:80,y:90,width:50,height:30,opacity:40,color:'#123456'};
 const [l]=studioLayers([ellipse]);assert.equal(l.width,20);assert.equal(l.height,10);
 const draws=[],ctx={save(){},restore(){},beginPath(){},rect(){},clip(){},ellipse(...a){draws.push(a);},fill(){draws.push([this.globalAlpha,this.fillStyle]);}};
 paintStudioLayers(ctx,[ellipse],1000,2000);
 assert.deepEqual(draws,[[900,1900,100,100,0,0,2*Math.PI],[.4,'#123456']]);
 assert.equal(duplicateStudioLayer([ellipse],0)[1].kind,'ellipse');
 assert.doesNotMatch(studioStyleFile({layers:[ellipse]}),/ellipse|123456/);
 assert.ok(studioMatchKit({team:'A',opponent:'B',score:'2:0',layers:[ellipse]},'Hall').every(m=>m.layers.length===0));
});
