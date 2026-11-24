import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';
import * as M from '../js/model.js';
import * as H from '../js/health.js';
import * as db from '../js/db.js';
test('configured inclusive periods and gaps',()=>{
 const p=[{id:'a',from:'2026-09-01',to:'2026-11-15'},{id:'b',from:'2026-11-23',to:'2027-02-28'},{id:'c',from:'2027-03-01',to:'2027-05-31'}];
 for(const [date,id] of [['2026-08-20','a'],['2026-11-15','a'],['2026-11-20','a'],['2026-11-23','b'],['2027-02-28','b'],['2027-03-01','c'],['2027-07-01','c']])assert.equal(M.schoolPeriodForDate(p,date).id,id);
});
test('current period, manual choice across reload and automatic rollover',async()=>{
 await db.clearAll();await S.load();
 const today=M.todayIso(), before=M.addDays(today,-5), after=M.addDays(today,5);
 const periods=[{id:'old',name:'Первый',kind:'custom',from:before,to:M.addDays(today,-1)},{id:'now',name:'Второй',kind:'custom',from:today,to:after},{id:'future',name:'Третий',kind:'custom',from:M.addDays(after,1),to:M.addDays(after,5)}];
 await S.saveSettings({year:{from:before,to:M.addDays(after,5)},trimesters:periods});
 assert.equal(S.currentTrimester().id,'now');
 assert.equal(S.selectSchoolPeriod('old'),true);
 await S.load();assert.equal(S.currentTrimester().id,'old');
 S.refreshSchoolPeriod(M.addDays(after,1));assert.equal(S.currentTrimester().id,'future');
 S.refreshSchoolPeriod(today);assert.equal(S.currentTrimester().id,'now');
});
test('suggested categories do not mark ordinary exercise as a norm',()=>{
 assert.deepEqual(H.suggestActivityIds('Бег на 60 м с низкого старта'),['sprint']);
 assert.deepEqual(H.suggestActivityIds('Челночный бег 3×10 м. Сдача норматива'),['shuttle','3x10','test']);
 assert.deepEqual(H.suggestActivityIds('Прыжок в длину с места'),['broad']);
 assert.deepEqual(H.suggestActivityIds('История Олимпийских игр'),[]);
});
