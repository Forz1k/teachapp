import test from 'node:test';
import assert from 'node:assert/strict';
import {filterHistory,historySummary,compareHistory} from '../js/match-history.js';
const a={id:'a',date:'2026-11-10',opponent:'Ёлочка',competition:'Кубок',sets:[{ours:25,theirs:20},{ours:25,theirs:22}]};
const b={id:'b',date:'2026-11-20',opponent:'Гости',competition:'Кубок',sets:[{ours:20,theirs:25}],imported:true};
test('Фильтры истории и итоги не меняют исходные записи',()=>{assert.deepEqual(filterHistory([a,b],{query:'елочка кубок',outcome:'win'}),[a]);assert.deepEqual(filterHistory([a,b],{source:'imported'}),[b]);assert.deepEqual(filterHistory([a,b],{from:'2026-11-21',to:'2026-11-20'}),[]);const s=historySummary([a,b]);assert.equal(s.wins,1);assert.equal(s.losses,1);assert.equal(s.setsWon,2);assert.equal(s.pointsWon,70);});
test('Сравнение не придумывает проценты из итогового протокола',()=>{const rows=compareHistory(a,b);assert.equal(rows[0].sets,'2:0');assert.equal(rows[0].serve,null);assert.equal(rows[1].source,'imported');assert.equal(compareHistory(a,a),null);});

import {prepareHistory,selectHistory} from '../js/match-history.js';
test('Archive index reads sets once per match and preserves ordering, totals and fresh edits',()=>{
 let scans=0,logReads=0;
 const matches=Array.from({length:1200},(_,i)=>{
  const sets=new Proxy([{ours:i%2?25:20,theirs:i%2?20:25}],{get(target,key,receiver){if(key===Symbol.iterator)scans++;return Reflect.get(target,key,receiver);}});
  const m={id:String(i).padStart(4,'0'),date:'2026-11-'+String(10+i%10).padStart(2,'0'),opponent:i%3?'Гости':'Ёлочка',competition:'Кубок',sets};
  if(i%5===0)m.imported=true;else if(i%5===1)m.detail={startedAt:'2026-11-10T'+String(i%24).padStart(2,'0')+':00:00Z',get events(){logReads++;throw Error('history must not read events');}};
  return m;
 });
 const original=matches.map(m=>m.id),index=prepareHistory(matches);
 assert.equal(scans,1200);assert.equal(logReads,0);assert.deepEqual(matches.map(m=>m.id),original);
 const baseline=filter=>{
  const terms=(filter.query||'').toLocaleLowerCase('ru').replaceAll('ё','е').split(' ').filter(Boolean);
  return matches.filter(m=>(!filter.from||m.date>=filter.from)&&(!filter.to||m.date<=filter.to)&&(!filter.outcome||(Number(m.id)%2?'win':'loss')===filter.outcome)&&(!filter.source||(m.imported?'imported':m.detail?'live':'manual')===filter.source)&&terms.every(t=>(m.opponent+' '+m.competition).toLocaleLowerCase('ru').replaceAll('ё','е').includes(t))).sort((a,b)=>b.date.localeCompare(a.date)||String(b.detail?.startedAt||'').localeCompare(String(a.detail?.startedAt||''))||String(a.id).localeCompare(String(b.id)));
 };
 for(const filter of [{},{query:'елочка кубок',outcome:'win'},{source:'live',from:'2026-11-12',to:'2026-11-15'},{query:'нет'},{source:'imported',outcome:'loss'}]){
  const {entries,summary}=selectHistory(index,filter),expected=baseline(filter);
  assert.deepEqual(entries.map(e=>e.match),expected);assert.equal(summary.matches,expected.length);
  const wins=expected.filter(m=>Number(m.id)%2).length;assert.equal(summary.wins,wins);assert.equal(summary.losses,expected.length-wins);assert.equal(summary.setsWon,wins);assert.equal(summary.pointsWon,25*wins+20*(expected.length-wins));
 }
 assert.equal(selectHistory(index,{from:'2026-11-20',to:'2026-11-10'}).summary.matches,0);assert.equal(scans,1200);assert.equal(logReads,0);
 matches[0].sets[0].ours=30;assert.equal(selectHistory(prepareHistory(matches),{outcome:'win'}).summary.wins,601);assert.equal(scans,2400);
});
