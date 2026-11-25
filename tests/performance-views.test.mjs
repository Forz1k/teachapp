import test from 'node:test';import assert from 'node:assert/strict';
import {dayDataIndex} from '../js/dashboard.js';
import {previewRows} from '../js/documents.js';
test('Индекс рабочего дня исключает посторонние уроки и сохраняет неизвестную явку',()=>{const lesson={id:'l',date:'2026-01-01',held:true},rows=[{classId:'c',lesson}],s={students:[{id:'p',classId:'c'},{id:'q',classId:'c'},{id:'other',classId:'b'}],marks:[{lessonId:'l',studentId:'p',value:'5',source:'manual'},{lessonId:'other',studentId:'q',value:'3'}],participation:[],exemptions:[]};const i=dayDataIndex(s,rows,'2026-01-01');assert.equal(i.byLesson.size,1);assert.equal(i.students.get('c').length,2);assert.equal(i.attendance(rows[0]).unknown,1);});
test('Ограничение предпросмотра не изменяет исходную матрицу',()=>{const a=[['Показатель'],...Array.from({length:200},(_,i)=>[i])];const v=previewRows(a);assert.equal(v.rows.length,150);assert.equal(v.omitted,50);assert.equal(a.length,201);});

import {buildAttendanceIndex} from '../js/attendance-index.js';import {attendanceDetails} from '../js/assessment.js';
test('attendance index matches old per-row scan, including unknown and future, with fresh rebuild after mutations',()=>{const today='2026-11-25',lessons=[{id:'a',date:'2026-11-20'},{id:'b',date:'2026-11-21'},{id:'c',date:'2026-11-22'},{id:'d',date:'2026-11-23',held:true},{id:'e',date:'2026-11-26'}],students=[{id:'p'},{id:'q'}],marks=[{lessonId:'a',studentId:'p',value:'5',source:'manual'},{lessonId:'b',studentId:'p',flag:'Н',source:'auto-osv',baseMark:{source:'manual'}},{lessonId:'x',studentId:'q',value:'4',source:'manual'},{lessonId:'e',studentId:'p',value:'5',source:'manual'}],parts=[{lessonId:'c',studentId:'q'}];const original=ps=>attendanceDetails(lessons.map(l=>({...l,held:l.date<=today&&(l.held||parts.some(p=>p.lessonId===l.id)||marks.some(m=>m.lessonId===l.id&&(m.source==='manual'||m.baseMark?.source==='manual')))})),ps,new Map(marks.filter(m=>lessons.some(l=>l.id===m.lessonId)).map(m=>[m.lessonId+'|'+m.studentId,m])),new Map(parts.map(p=>[p.lessonId+'|'+p.studentId,p])),today);let idx=buildAttendanceIndex(lessons,lessons,marks,parts,today);assert.deepEqual(idx.forStudents(students),original(students));for(const p of students)assert.deepEqual(idx.forStudents([p]),original([p]));assert.equal(idx.marks.has('x|q'),false);marks.push({lessonId:'d',studentId:'q',value:'5',source:'manual'});idx=buildAttendanceIndex(lessons,lessons,marks,parts,today);assert.deepEqual(idx.forStudents(students),original(students));});

import 'fake-indexeddb/auto';
import * as DB from '../js/db.js';
import * as S from '../js/store.js';
import * as C from '../js/coach.js';
import {matchComparison} from '../js/coach-season.js';
test('School view reads only school stores; backups retain unrelated coach/work records',async()=>{
 await DB.clearAll();await DB.put('classes',{id:'school-c',name:'7А'});
 await DB.put('coachMatches',{id:'private-m',teamId:'team-b',events:[{at:1}]});await DB.put('workRecords',{id:'work',kind:'synthetic'});
 const full=await DB.dumpAll(),snapshot=await DB.readSnapshot(S.schoolViewStores);
 assert.deepEqual(snapshot,Object.fromEntries(S.schoolViewStores.map(n=>[n,full[n]])));
 const original=IDBObjectStore.prototype.getAll,seen=[];IDBObjectStore.prototype.getAll=function(...a){seen.push(this.name);return original.apply(this,a);};
 try{await S.load();assert.deepEqual(new Set(seen),new Set(S.schoolViewStores));assert.equal(S.state.classes[0].id,'school-c');}
 finally{IDBObjectStore.prototype.getAll=original;}
 assert.equal((await DB.dumpAll()).coachMatches[0].id,'private-m');assert.equal((await DB.dumpAll()).workRecords[0].id,'work');
 assert.throws(()=>DB.readSnapshot(['marks','marks']));assert.throws(()=>DB.readSnapshot(['unknown']));
});
test('Team view uses indexed reads for the selected team in one snapshot and handles archived/empty states',async()=>{
 await DB.clearAll();await DB.bulkPut('coachTeams',[{id:'a',name:'A',archived:false},{id:'b',name:'B',archived:true},{id:'c',name:'C',archived:false}]);
 for(const n of C.coachStores.filter(n=>n!=='coachTeams'))await DB.bulkPut(n,[{id:'a-'+n,teamId:'a',date:'2026-09-01'},{id:'b-'+n,teamId:'b',date:'2026-09-02'},{id:'c-'+n,teamId:'c',date:'2026-09-03'}]);
 const full=await C.loadCoach(),reads=[],original=IDBIndex.prototype.getAll;IDBIndex.prototype.getAll=function(...a){reads.push([this.objectStore.name,this.name,a[0]]);return original.apply(this,a);};
 try{
  const x=await C.loadCoachForView('c');assert.equal(x.selectedTeamId,'c');assert.deepEqual(x.data.coachTeams,full.coachTeams);
  for(const n of C.coachStores.filter(n=>n!=='coachTeams'))assert.deepEqual(x.data[n],full[n].filter(v=>v.teamId==='c'));
  assert.equal(reads.length,6);assert.ok(reads.every(([,index,query])=>index==='teamId'&&query==='c'));
  assert.equal((await C.loadCoachForView('b')).selectedTeamId,'a');assert.equal((await C.loadCoachForView('b',{archived:true})).selectedTeamId,'b');
  await DB.clear('coachTeams');const empty=await C.loadCoachForView('a');assert.equal(empty.selectedTeamId,null);assert.ok(C.coachStores.every(n=>empty.data[n].length===0));
 }finally{IDBIndex.prototype.getAll=original;}
});
test('Player roster index preserves archive order, excludes unlisted stats and rebuilds after edit',()=>{
 const a={id:'m1',date:'2026-09-01',opponent:'X',roster:['p','p','q'],stats:{p:{aces:2},q:{aces:0},z:{aces:99}}},b={id:'m2',date:'2026-09-02',opponent:'Y',roster:['q'],stats:{q:{aces:1}}},players=['p','q','z'].map(id=>({id,name:id,archived:false}));
 const rows=[b,a],idx=C.indexPlayerRecords(rows);assert.deepEqual(idx.get('q'),[b,a]);assert.deepEqual(idx.get('p'),[a]);assert.equal(idx.has('z'),false);
 const view={players,matches:rows};assert.deepEqual(matchComparison(view,'aces').map(x=>[x.player.id,x.total,x.value]),[['p',1,2],['q',2,1],['z',0,null]]);
 a.roster=['z'];assert.deepEqual(matchComparison(view,'aces').map(x=>[x.player.id,x.total,x.value]),[['p',0,null],['q',1,1],['z',1,99]]);
});

import {schoolAnalytics} from '../js/analytics.js';
import {todayIso} from '../js/model.js';
test('Analytics reuses attendance indexes and preserves individual and total attendance',async()=>{await DB.clearAll();const today=todayIso();await DB.put('classes',{id:'c',name:'7A'});await DB.bulkPut('students',[{id:'p',classId:'c',fullName:'P'},{id:'q',classId:'c',fullName:'Q'}]);await DB.put('lessons',{id:'l',classId:'c',date:today,held:true});await DB.put('marks',{id:'m',lessonId:'l',studentId:'p',value:'5',source:'manual'});await S.load();const a=schoolAnalytics('c',today,today);assert.equal(a.held,1);assert.equal(a.rows.length,2);assert.equal(a.rows.find(r=>r.student.id==='p').mean,5);assert.equal(a.rows.find(r=>r.student.id==='q').att.unknown,1);assert.deepEqual(a.att,S.attendanceFor(S.lessonsInRange('c',today,today),S.studentsOfClass('c'),'c'));});
