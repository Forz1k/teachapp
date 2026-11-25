import test from 'node:test';import assert from 'node:assert/strict';import {templates,formats,studioModel,wrapStudioText,studioStyle,readStudioStyle,saveStudioStyle,resetStudioStyle,studioPublication,studioZip,studioCrc32,paintStudio,studioBatch} from '../js/media-studio.js';
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
