import {BACKUP_VERSION} from '../js/backup.js';
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/coach.js';
import * as S from '../js/store.js';
import * as db from '../js/db.js';
import {testPresets,validateTestResult,testHistory,summarizeTests} from '../js/coach-tests.js';
const skill=(attempts,success,errors,target=null)=>({status:'done',attempts,success,errors,target,value:null,adapted:false,note:''});
const measure=value=>({status:'done',attempts:null,success:null,errors:null,target:null,value,adapted:false,note:''});
test('Тренировочные тесты: проверка попыток, целей и замеров',()=>{
 validateTestResult(skill(10,8,2,5),testPresets.serve);
 assert.throws(()=>validateTestResult(skill(10,8,3),testPresets.serve));
 assert.throws(()=>validateTestResult(skill(10,8,2,9),testPresets.serve));
 assert.throws(()=>validateTestResult(measure(NaN),testPresets.jump));
 validateTestResult(measure(42.5),testPresets.jump);
});
test('Тренировочные тесты: отдельные методики, взвешенные проценты, адаптация и даты',()=>{
 const records=[
 {id:'1',date:'2026-01-01',definition:testPresets.serve,results:{p:skill(10,5,5,4)}},
 {id:'2',date:'2026-02-01',definition:testPresets.serve,results:{p:skill(30,27,3)}},
 {id:'3',date:'2026-03-01',definition:testPresets.serve,results:{p:{...skill(10,10,0),adapted:true}}},
 {id:'4',date:'2026-03-02',definition:{...testPresets.serve,protocol:'Другой критерий'},results:{p:skill(10,1,9)}},
 {id:'5',date:'2026-03-03',definition:testPresets.sprint,results:{p:measure(6)}},
 {id:'6',date:'2026-03-04',definition:testPresets.sprint,results:{p:measure(5)}}
 ];
 const g=summarizeTests(testHistory(records,'p'));assert.equal(g.length,3);assert.equal(g[0].pct,80);assert.equal(g[0].targetPct,40);assert.equal(g[0].adapted,1);assert.equal(g[2].best,5);
 assert.equal(testHistory(records,'p',{from:'2026-03-03'}).length,2);
});
test('Тренировочные тесты: массовая атомарная запись, ограничения, старая копия',async()=>{
 await db.clearAll();await S.load();const team=await C.saveTeam({name:'Тест'});
 const p=await C.savePlayer({teamId:team.id,name:'Один',number:1,position:'setter'}),q=await C.savePlayer({teamId:team.id,name:'Два',number:2,position:'middle',restrictions:[{activityId:'volley',dateFrom:'2025-01-01',type:'avoid'}]});
 const base={teamId:team.id,date:'2025-09-01',definition:testPresets.serve};
 await assert.rejects(C.saveCoachTest({...base,results:{[p.id]:skill(10,8,2),[q.id]:skill(10,9,1)}}),/ограничение/);
 assert.equal((await C.loadCoach()).coachTests.length,0);
 const s=await C.saveCoachTest({...base,results:{[p.id]:skill(10,8,2),[q.id]:{...skill(0,0,0),status:'restricted',attempts:null,success:null,errors:null}}});
 assert.equal(s.results[p.id].success,8);
 await C.savePlayer({...p,restrictions:[{activityId:'volley',dateFrom:'2025-01-01',type:'adapt'}]});
 await assert.rejects(C.saveCoachTest({...base,results:{[p.id]:skill(10,9,1)}}),/адаптированную/);
 await C.saveCoachTest({...base,results:{[p.id]:{...skill(10,9,1),adapted:true}}});
 const backup=await S.makeBackup();assert.equal(backup.version,BACKUP_VERSION);await S.restoreBackup(backup);assert.equal((await C.loadCoach()).coachTests.length,2);
 const old=structuredClone(backup);old.version=9;delete old.data.coachTests;await S.restoreBackup(old);assert.equal((await C.loadCoach()).coachTests.length,0);
});

import {teamSkillMap} from '../js/coach-tests.js';
test('Team skill map preserves methods, weighted denominators and individual coverage without rankings',()=>{
 const players=[{id:'p',teamId:'t',name:'P',number:1},{id:'q',teamId:'t',name:'Q',number:2},{id:'r',teamId:'t',name:'R',number:3},{id:'a',teamId:'t',name:'A',archived:true},{id:'x',teamId:'other',name:'X'}],s=(id,date,definition,results,teamId='t')=>({id,date,definition,results,teamId});
 const rows=[s('1','2026-11-01',testPresets.serve,{p:skill(10,5,5,4),q:skill(2,2,0),r:{...skill(5,5,0),adapted:true},a:skill(100,100,0)}),s('2','2026-11-02',testPresets.serve,{p:skill(30,27,3)}),s('3','2026-11-03',{...testPresets.serve,protocol:'Другой критерий'},{p:skill(10,1,9)}),s('4','2026-11-04',testPresets.sprint,{p:measure(6)}),s('5','2026-11-05',testPresets.sprint,{p:measure(5)}),s('6','2026-12-01',testPresets.serve,{p:skill(100,100,0)}),s('7','2026-11-03',testPresets.serve,{x:skill(100,100,0)},'other')];
 const m=teamSkillMap(rows,players,'t',{from:'2026-11-01',to:'2026-12-31',today:'2026-11-26'});assert.equal(m.players.length,3);assert.equal(m.methods.length,3);const serve=m.methods.find(x=>x.definition.protocol===testPresets.serve.protocol),run=m.methods.find(x=>x.definition.kind==='measure');assert.equal(serve.attempts,42);assert.equal(serve.success,34);assert.equal(serve.pct,100*34/42);assert.equal(serve.targetPct,40);assert.deepEqual(serve.coverage,{roster:3,recorded:1,sample:1,excluded:1,missing:0});assert.equal(serve.rows.find(x=>x.playerId==='r').pct,null);assert.equal(run.rows[0].delta,-1);assert.equal(run.rows[0].best,5);assert.equal(run.rows[1].state,'missing');assert.equal(run.rows[1].last,null);assert.equal(teamSkillMap(rows,players,'t',{includeArchived:true,today:'2026-11-26'}).players.length,4);assert.throws(()=>teamSkillMap(rows,players,'t',{from:'2026-12-01',to:'2026-11-01'}));
});
