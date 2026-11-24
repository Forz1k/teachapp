import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';
import * as S from '../js/store.js';
import * as C from '../js/coach.js';
import {makeScopedBackup,planSelective,restoreSelective} from '../js/selective-backup.js';
test('Выборочное восстановление класса: только связанные записи, без удаления других',async()=>{
 await db.clearAll();await S.load();await S.setYear('2026-09-01','2027-05-31');
 const a=await S.addClass('7А'),b=await S.addClass('8Б'),p=await S.addStudent(a.id,'Первый',1),q=await S.addStudent(b.id,'Другой',1);
 const l=await S.addLesson(a.id,'2026-11-20');await S.setMark(p.id,l.id,{value:'5'});
 const team=await C.saveTeam({name:'Команда'}),full=await S.makeBackup(),scope={kind:'class',id:a.id},part=makeScopedBackup(full,scope).payload;
 assert.deepEqual(part.data.classes.map(c=>c.id),[a.id]);assert.deepEqual(part.data.students.map(s=>s.id),[p.id]);assert.equal(part.data.coachTeams.length,0);assert.equal(part.data.workRecords.filter(r=>r.kind==='gradeHistory').length,1);
 assert.equal(part.scope.kind,'class');await assert.rejects(S.restoreBackup(part),/выборочная копия/);
 await S.deleteClass(a.id);const preview=planSelective(await db.dumpAll(),part,scope);assert.equal(preview.conflicts.length,0);assert.ok(preview.counts.added>=4);
 await assert.rejects(restoreSelective(part,scope,'stale',true),/изменились/);
 await restoreSelective(part,scope,preview.token,true);await S.load();assert.equal(S.state.classes.length,2);assert.ok(S.state.students.some(s=>s.id===q.id));assert.equal(S.state.marks[0].value,'5');assert.equal((await C.loadCoach()).coachTeams[0].id,team.id);
 await S.setMark(p.id,l.id,{value:'4'});const conflict=planSelective(await db.dumpAll(),part,scope);assert.ok(conflict.conflicts.length);await assert.rejects(restoreSelective(part,scope,conflict.token,true),/конфликт/);assert.equal(S.state.marks[0].value,'4');
});
test('Выборочная копия команды не содержит школьных записей и не перезаписывает конфликт',async()=>{
 await db.clearAll();await S.load();await S.addClass('7А');
 const team=await C.saveTeam({name:'Команда'}),p=await C.savePlayer({teamId:team.id,name:'Игрок',position:'setter'}),full=await S.makeBackup(),scope={kind:'team',id:team.id};
 const part=makeScopedBackup(full,scope).payload;assert.equal(part.data.classes.length,0);assert.equal(part.data.coachPlayers[0].id,p.id);
 const current=await db.dumpAll();current.coachTeams=[];current.coachPlayers=[];const plan=planSelective(current,part,scope);assert.equal(plan.counts.added,2);assert.equal(plan.conflicts.length,0);
 await C.saveTeam({...team,name:'Другая'});assert.ok(planSelective(await db.dumpAll(),part,scope).conflicts.length);
});
