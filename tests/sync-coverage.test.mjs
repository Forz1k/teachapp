import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {projectScope,mergeScopes,syncValuesEqual} from '../js/sync.js';
import {defaultSettings} from '../js/model.js';
const data=()=>({...Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]])),meta:[defaultSettings()],classes:[{id:'c',name:'7А'}],students:[{id:'p',classId:'c',fullName:'Тест',number:1}]});
const lesson={id:'l',classId:'c',date:'2026-10-05',topicId:null};
const exemption={id:'e',studentId:'p',dateFrom:'2026-10-01',dateTo:'2026-10-10'};
test('concurrent lesson creation and exemption must not merge without matching coverage mark',()=>{
 const base=projectScope(data(),'school'),local=projectScope({...data(),lessons:[lesson]},'school'),remote=projectScope({...data(),exemptions:[exemption]},'school');
 assert.throws(()=>mergeScopes(base,local,remote,'school'),/несогласованное освобождение/);
});
test('a coherent one-sided lesson and exemption update is accepted',()=>{
 const base=projectScope(data(),'school'),remote=projectScope({...data(),lessons:[lesson],exemptions:[exemption],marks:[{id:'m',studentId:'p',lessonId:'l',value:null,flag:'ОСВ',source:'auto-osv',baseMark:null}]},'school');
 const result=mergeScopes(base,base,remote,'school');
 assert.equal(result.conflicts.length,0);assert.equal(result.snapshot.marks[0].flag,'ОСВ');
});

test('Structural sync equality agrees with canonical JSON on nested records without relying on key order',()=>{
 const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
 const rows=[null,false,true,0,1,'1','',[],[null],[1,2],[2,1],{}, {a:null},{a:1,b:[{z:2,y:'тест'}]},{b:[{y:'тест',z:2}],a:1},{a:1,b:[{z:2,y:'тест',x:false}]},JSON.parse('{"__proto__":{"a":1}}'),{a:{nested:[1,null,'🏐']}}];
 for(const a of rows)for(const b of rows)assert.equal(syncValuesEqual(a,b),canonical(a)===canonical(b));
 assert.equal(syncValuesEqual({a:undefined},{}),false);assert.equal(syncValuesEqual([null],[]),false);assert.equal(syncValuesEqual({x:1},Object.create({x:1})),false);
});
test('Reordered record properties do not produce false conflicts while changed nested values still do',()=>{
 const base=projectScope(data(),'school'),local=structuredClone(base),remote=structuredClone(base);
 local.classes[0]={name:'7А',id:'c'};remote.classes[0].name='8Б';
 const result=mergeScopes(base,local,remote,'school');assert.equal(result.conflicts.length,0);assert.equal(result.snapshot.classes[0].name,'8Б');
 local.classes[0].name='9В';assert.equal(mergeScopes(base,local,remote,'school').conflicts.length,1);
});
