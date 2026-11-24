import test from 'node:test';
import assert from 'node:assert/strict';
import {generateTeams,swapPlayers,schoolCandidates,coachCandidates} from '../js/team-generator.js';
import {catalog} from '../js/health.js';
const players=Array.from({length:11},(_,i)=>({id:String(i),rating:i%5+1}));
test('Команды: все игроки ровно один раз, равная численность и закрепление',()=>{
 const input=players.map((p,i)=>i===0?{...p,lock:1}:p);
 for(const mode of ['random','balanced']){
  const t=generateTeams(input,3,mode,()=>0.5);
  assert.equal(new Set(t.flat().map(x=>x.id)).size,11);
  assert.equal(t.flat().length,11);assert.ok(Math.max(...t.map(x=>x.length))-Math.min(...t.map(x=>x.length))<=1);
  assert.ok(t[1].some(x=>x.id==='0'));
  const a=t[0][0],b=t[2][0],next=swapPlayers(t,a.id,b.id);assert.ok(next[2].some(x=>x.id===a.id));assert.ok(t[0].some(x=>x.id===a.id));
  assert.throws(()=>swapPlayers(t,a.id,'0'),/закрепление/);
 }
 assert.throws(()=>generateTeams(players.map(p=>({...p,lock:0})),3),/не помещаются/);
 assert.throws(()=>generateTeams([{id:'a'},{id:'b',rating:5}],2,'balanced'),/уровень/);
 assert.throws(()=>generateTeams([{id:'a',reason:'ОСВ'},{id:'b'}],2),/доступных/);
});
test('Генератор школы исключает Н, ОСВ, ограничения и адаптированную нагрузку',()=>{
 const students=Array.from({length:6},(_,i)=>({id:String(i),classId:'c',fullName:'Ученик '+i}));
 const rows=schoolCandidates({lesson:{id:'l',classId:'c',date:'2026-01-01'},students,activities:catalog,activityId:'standing',
 marks:[{lessonId:'l',studentId:'0',flag:'Н'},{lessonId:'l',studentId:'1',flag:'ОСВ'},{lessonId:'l',studentId:'4',value:'5'}],
 parts:[{lessonId:'l',studentId:'3',mode:'adapted'}],exemptions:[],
 restrictions:[{studentId:'2',activityId:'jump',type:'avoid',dateFrom:'2025-01-01',dateTo:null}]});
 assert.deepEqual(rows.map(r=>!!r.reason),[true,true,true,true,false,false]);assert.equal(rows[4].confirmed,true);assert.equal(rows[5].confirmed,false);
});
test('Тренерский состав: архив, ограничения по предкам и срокам, ручное подтверждение',()=>{
 const players=[{id:'a',name:'А',restrictions:[{activityId:'games',type:'avoid',dateFrom:'2025-01-01'}]},
 {id:'b',name:'Б',restrictions:[{activityId:'volley',type:'adapt',dateFrom:'2024-01-01',dateTo:'2025-01-01'}]},
 {id:'c',name:'В',archived:true,restrictions:[]}];
 const rows=coachCandidates(players,'volley','2026-01-01');assert.equal(rows.length,2);assert.ok(rows[0].reason);assert.equal(rows[1].reason,'');assert.equal(rows[1].confirmed,false);
});
