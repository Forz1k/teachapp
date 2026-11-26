/* Reproducible calculation-only benchmark; synthetic school, same results. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {attendanceDetails} from '../js/assessment.js';
import {buildAttendanceIndex} from '../js/attendance-index.js';
import {addDays,hasOsv,inRange,sortLessons} from '../js/model.js';
import {syncValuesEqual} from '../js/sync.js';
import {schoolPeriodOverview} from '../js/school-review.js';
const today='2026-11-25',classes=24,pupilsPerClass=30,lessonCount=36,allMarks=[],allParts=[],allLessons=[],allPupils=[];
for(let c=0;c<classes;c++){for(let p=0;p<pupilsPerClass;p++)allPupils.push({id:'p'+c+'_'+p,classId:'c'+c});for(let l=0;l<lessonCount;l++){const lesson={id:'l'+c+'_'+l,classId:'c'+c,date:addDays('2026-09-01',l*2),held:l%4===0};allLessons.push(lesson);for(let p=0;p<pupilsPerClass;p++){const studentId='p'+c+'_'+p;if((l+p)%7===0)allParts.push({lessonId:lesson.id,studentId});else if((l+p)%5!==0)allMarks.push({lessonId:lesson.id,studentId,source:l%4===0?'manual':'auto-osv',...(p%9===0?{flag:'Н'}:{value:'4'})});}}}
const classId='c'+(classes-1),lessons=allLessons.filter(l=>l.classId===classId),students=allPupils.filter(p=>p.classId===classId);
function before(){return students.map(st=>{const classLessons=new Set(allLessons.filter(l=>l.classId===classId).map(l=>l.id)),marks=new Map();for(const m of allMarks)if(classLessons.has(m.lessonId))marks.set(m.lessonId+'|'+m.studentId,m);const parts=new Map(allParts.map(p=>[p.lessonId+'|'+p.studentId,p]));const prepared=lessons.map(l=>({...l,held:l.date<=today&&(l.held||allParts.some(p=>p.lessonId===l.id)||allMarks.some(m=>m.lessonId===l.id&&(m.source==='manual'||m.baseMark?.source==='manual')))}));return attendanceDetails(prepared,[st],marks,parts,today);});}
function after(){const ctx=buildAttendanceIndex(lessons,lessons,allMarks,allParts,today);return students.map(st=>ctx.forStudents([st]));}
assert.deepEqual(after(),before());function median(fn){const times=[];for(let i=0;i<5;i++){const start=performance.now();fn();times.push(performance.now()-start);}return times.sort((a,b)=>a-b)[2];}const old=median(before),next=median(after);console.log('ATTENDANCE BENCHMARK '+JSON.stringify({classes,pupilsPerClass,lessonCount,marks:allMarks.length,participation:allParts.length,beforeMs:+old.toFixed(2),afterMs:+next.toFixed(2),speedup:+(old/next).toFixed(2),identical:true}));

const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const records={lessons:allLessons,students:allPupils,marks:allMarks,participation:allParts};
const equivalent=JSON.parse(JSON.stringify(records)),different=structuredClone(equivalent);different.marks.at(-1).value='1';
const comparisons=[[records,equivalent],[records,different]];
const compareOld=()=>comparisons.map(([a,b])=>canonical(a)===canonical(b)),compareNew=()=>comparisons.map(([a,b])=>syncValuesEqual(a,b));
assert.deepEqual(compareNew(),compareOld());assert.deepEqual(compareNew(),[true,false]);
const eqOld=median(compareOld),eqNew=median(compareNew);
console.log('SYNC EQUALITY BENCHMARK '+JSON.stringify({records:Object.values(records).reduce((n,a)=>n+a.length,0),beforeMs:+eqOld.toFixed(2),afterMs:+eqNew.toFixed(2),speedup:+(eqOld/eqNew).toFixed(2),identical:true}));
const period={from:'2026-09-01',to:'2026-11-25'};
const state={classes:Array.from({length:classes},(_,i)=>({id:'c'+i,name:String(i+1)+'А'})),students:allPupils,lessons:allLessons,marks:allMarks,participation:allParts,settings:{year:{from:period.from,to:'2027-05-31'},holidays:[]},schedule:[],scheduleOverrides:[],finalGrades:allPupils.flatMap((s,i)=>[{studentId:s.id,from:'2025-09-01',to:'2025-11-25',value:'4'},...(i%3?[{studentId:s.id,...period,value:'4'}]:[])])};
function oldPeriod(){
 const pupils=new Map(),marks=new Map(allMarks.map(m=>[m.lessonId+'|'+m.studentId,m])),parts=new Map(allParts.map(m=>[m.lessonId+'|'+m.studentId,m]));
 for(const p of state.students){if(!pupils.has(p.classId))pupils.set(p.classId,[]);pupils.get(p.classId).push(p);}
 return state.classes.map(cls=>{
  const students=pupils.get(cls.id)||[],lessons=sortLessons(state.lessons.filter(l=>l.classId===cls.id&&inRange(l.date,period.from,period.to))),confirmed=lessons.filter(l=>attendanceDetails([l],students,marks,parts,today).held>0);
  const attendanceLessons=confirmed.map(l=>l.held?l:{...l,held:true});
  const issues=lessons.filter(l=>l.date<=today).map(l=>({l,a:attendanceDetails([l],students,marks,parts,today)})).filter(({l,a})=>!l.held||a.unknown);
  const results=students.map(student=>{
   let count=0;for(const l of confirmed){const m=marks.get(l.id+'|'+student.id);if(m?.flag!=='Н'&&!hasOsv(m)&&['1','2','3','4','5'].includes(String(m?.value)))count++;}
   const att=attendanceDetails(attendanceLessons,[student],marks,parts,today),final=state.finalGrades.find(r=>r.studentId===student.id&&r.from===period.from&&r.to===period.to)?.value??null;
   return {count,unknown:att.unknown,final};
  });
  return {classId:cls.id,held:confirmed.length,explicitlyHeld:confirmed.filter(l=>l.held).length,unknown:results.reduce((n,r)=>n+r.unknown,0),unconfirmed:issues.filter(({l})=>!l.held).length,withoutGrades:results.filter(r=>!r.count).length,withoutFinal:results.filter(r=>r.final===null).length};
 }).sort((a,b)=>a.classId.localeCompare(b.classId));
}
function newPeriod(){return schoolPeriodOverview(state,{period,today}).rows.map(r=>({classId:r.classId,held:r.held,explicitlyHeld:r.explicitlyHeld,unknown:r.stats.unknown,unconfirmed:r.stats.unconfirmed,withoutGrades:r.stats.withoutGrades,withoutFinal:r.stats.withoutFinal})).sort((a,b)=>a.classId.localeCompare(b.classId));}
assert.deepEqual(newPeriod(),oldPeriod());
const periodOld=median(oldPeriod),periodNew=median(newPeriod);
console.log('PERIOD REVIEW BENCHMARK '+JSON.stringify({classes,pupils:allPupils.length,lessons:allLessons.length,finals:state.finalGrades.length,beforeMs:+periodOld.toFixed(2),afterMs:+periodNew.toFixed(2),speedup:+(periodOld/periodNew).toFixed(2),identical:true}));

import 'fake-indexeddb/auto';
import * as DB from '../js/db.js';
import {schoolViewStores} from '../js/store.js';
import {loadCoach,loadCoachForView,teamView,indexPlayerRecords,coachStores} from '../js/coach.js';
const teamCount=12,matchCount=100,eventsPerMatch=180,roster=Array.from({length:14},(_,i)=>'p'+i);
const teams=Array.from({length:teamCount},(_,i)=>({id:'team'+i,name:'Synthetic '+i,archived:false}));
const logs=Array.from({length:eventsPerMatch},(_,i)=>({type:'rally',side:i%2?'ours':'theirs',kind:'point',at:'2026-11-01T12:00:00Z'}));
await DB.bulkPut('coachTeams',teams);
await DB.bulkPut('coachMatches',teams.flatMap(t=>Array.from({length:matchCount},(_,i)=>({id:t.id+'_'+i,teamId:t.id,date:'2026-11-01',opponent:'Synthetic',roster,stats:{},sets:[{ours:25,theirs:19}],detail:{events:logs}}))));
await DB.bulkPut('classes',state.classes);await DB.bulkPut('students',allPupils);await DB.bulkPut('lessons',allLessons);await DB.bulkPut('marks',allMarks.map((m,i)=>({...m,id:'m'+i})));await DB.bulkPut('participation',allParts.map((p,i)=>({...p,id:'p'+i})));
const schoolOld=async()=>{const all=await DB.dumpAll();return Object.fromEntries(schoolViewStores.map(n=>[n,all[n]]));};
const schoolNew=()=>DB.readSnapshot(schoolViewStores);
const teamOld=async()=>teamView(await loadCoach(),teams.at(-1).id);
const teamNew=async()=>teamView((await loadCoachForView(teams.at(-1).id)).data,teams.at(-1).id);
assert.deepEqual(await schoolNew(),await schoolOld());assert.deepEqual(await teamNew(),await teamOld());
 // Count actual IndexedDB request results, not just the final filtered view or
 // nominal fixture dimensions. This instrumentation runs outside timing samples.
 async function readFootprint(fn){
  const calls=[],storeGetAll=IDBObjectStore.prototype.getAll,indexGetAll=IDBIndex.prototype.getAll;
  const observe=(req,store,index,query)=>{
   const call={store,index,query:query??null,rows:null};calls.push(call);
   req.addEventListener('success',()=>{call.rows=Array.isArray(req.result)?req.result.length:null;},{once:true});return req;
  };
  IDBObjectStore.prototype.getAll=function(...args){return observe(storeGetAll.apply(this,args),this.name,null,args[0]);};
  IDBIndex.prototype.getAll=function(...args){return observe(indexGetAll.apply(this,args),this.objectStore.name,this.name,args[0]);};
  try{await fn();assert.ok(calls.every(c=>Number.isSafeInteger(c.rows)&&c.rows>=0),'Unobserved IndexedDB result');return calls;}
  finally{IDBObjectStore.prototype.getAll=storeGetAll;IDBIndex.prototype.getAll=indexGetAll;}
 }
 const schoolBaseline=await readFootprint(schoolOld),schoolScoped=await readFootprint(schoolNew);
 const teamBaseline=await readFootprint(teamOld),teamScoped=await readFootprint(teamNew);
 const rowsFor=(calls,store)=>calls.filter(c=>c.store===store).reduce((sum,c)=>sum+c.rows,0);
 const requestedStores=calls=>calls.map(c=>c.store).sort();
 // Deterministic budgets fail on widened snapshots, duplicate reads, or a full
 // scan followed by filtering, even if the UI result and machine timing match.
 assert.deepEqual(requestedStores(schoolScoped),[...schoolViewStores].sort(),'School read-scope budget');
 assert.ok(schoolScoped.every(c=>c.index===null&&c.query===null),'School snapshot must be unfiltered within its scope');
 assert.equal(rowsFor(schoolScoped,'coachMatches'),0,'School must not deserialize match history');
 assert.deepEqual(requestedStores(teamScoped),[...coachStores].sort(),'Team read-scope budget');
 assert.ok(teamScoped.every(c=>c.store==='coachTeams'?c.index===null&&c.query===null:c.index==='teamId'&&c.query===teams.at(-1).id),'Team view must use only selected-team indexes');
 assert.equal(rowsFor(teamScoped,'coachMatches'),matchCount,'Team match history budget');
 assert.equal(rowsFor(teamBaseline,'coachMatches'),teamCount*matchCount,'Full coach benchmark baseline');
 assert.equal(rowsFor(schoolBaseline,'coachMatches'),teamCount*matchCount,'Full backup benchmark baseline');
 console.log('IDB READ BUDGET PASS '+JSON.stringify({schoolRequests:schoolScoped.length,teamRequests:teamScoped.length,schoolMatches:rowsFor(schoolScoped,'coachMatches'),teamMatches:rowsFor(teamScoped,'coachMatches'),baselineMatches:rowsFor(teamBaseline,'coachMatches')}));

async function medianAsync(fn){const times=[];await fn();for(let i=0;i<5;i++){const start=performance.now();await fn();times.push(performance.now()-start);}return times.sort((a,b)=>a-b)[2];}
const schoolBefore=await medianAsync(schoolOld),schoolAfter=await medianAsync(schoolNew),teamBefore=await medianAsync(teamOld),teamAfter=await medianAsync(teamNew);
console.log('SCOPED IDB BENCHMARK '+JSON.stringify({engine:'fake-indexeddb (synthetic, not device latency)',teams:teamCount,matches:teamCount*matchCount,events:teamCount*matchCount*eventsPerMatch,schoolBeforeMs:+schoolBefore.toFixed(2),schoolAfterMs:+schoolAfter.toFixed(2),teamBeforeMs:+teamBefore.toFixed(2),teamAfterMs:+teamAfter.toFixed(2),teamMatchesReadBefore:rowsFor(teamBaseline,'coachMatches'),teamMatchesReadAfter:rowsFor(teamScoped,'coachMatches'),schoolCoachMatchesReadBefore:rowsFor(schoolBaseline,'coachMatches'),schoolCoachMatchesReadAfter:rowsFor(schoolScoped,'coachMatches'),identical:true}));
const archive=Array.from({length:8000},(_,i)=>({id:'r'+i,roster:roster.map((_,j)=>'p'+((i+j)%80))})),ids=Array.from({length:80},(_,i)=>'p'+i);
const rosterOld=()=>ids.map(id=>archive.filter(m=>m.roster.includes(id)));
const rosterNew=()=>{const index=indexPlayerRecords(archive);return ids.map(id=>index.get(id)||[]);};
assert.deepEqual(rosterNew(),rosterOld());const rb=median(rosterOld),ra=median(rosterNew);console.log('ROSTER INDEX BENCHMARK '+JSON.stringify({matches:archive.length,players:ids.length,beforeMs:+rb.toFixed(2),afterMs:+ra.toFixed(2),speedup:+(rb/ra).toFixed(2),identical:true}));
