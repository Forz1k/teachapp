import test from 'node:test';
import assert from 'node:assert/strict';
import {readPresets,savePreset,removePreset,normalizePreset} from '../js/document-presets.js';
import {buildDocument} from '../js/documents.js';
test('document presets are scoped by type and omit personal fields',()=>{
 const m=new Map(),s={getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)};
 savePreset('lesson',{title:'  Урок  ',organization:'Школа',author:'secret',players:['secret'],signatureLabel:'Учитель'},s);
 assert.deepEqual(readPresets(s).lesson,{title:'Урок',organization:'Школа',venue:'',signatures:true,signatureLabel:'Учитель'});
 assert.equal(readPresets(s).training,undefined);
 assert.throws(()=>savePreset('bad',{},s));removePreset('lesson',s);assert.deepEqual(readPresets(s),{});
 assert.equal(normalizePreset(null).signatureLabel,'Ответственный');
});
test('custom signature label is included in document',()=>{
 const r=buildDocument('teamReport',{teamName:'A',matches:[['Дата']],signatureLabel:'Тренер'});
 assert.match(r.sections.at(-1).paragraphs[0],/^Тренер /);
});