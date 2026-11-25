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
