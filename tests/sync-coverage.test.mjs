import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {projectScope,mergeScopes} from '../js/sync.js';
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
