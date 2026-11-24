import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';
import * as S from '../js/store.js';
import * as C from '../js/coach.js';
import * as W from '../js/workbench.js';
import {testPresets} from '../js/coach-tests.js';
import {goalProgress,saveGoal,validateGoal} from '../js/coach-goals.js';
import {goalTasks} from '../js/attention.js';
const goal={id:'g',kind:'coachGoal',teamId:'t',playerId:'a',name:'Подача',from:'2026-09-01',to:'2026-12-01',definition:testPresets.serve,metric:'success',baseline:60,target:90,status:'active',actions:'',exercises:[],observations:[],revision:0};
const session=(id,date,n,k,adapted=false)=>({id,teamId:'t',date,definition:testPresets.serve,results:{a:{status:'done',attempts:n,success:k,errors:n-k,target:null,value:null,adapted,note:''}}});
test('Цели: сопоставимые тесты, минимальная выборка, ручное подтверждение',()=>{
 const sessions=[session('a','2026-10-01',10,8),session('b','2026-10-02',10,10),session('c','2026-10-03',20,0,true)];
 let v=goalProgress(goal,sessions,'2026-11-24');assert.equal(v.current,90);assert.equal(v.met,true);assert.equal(v.progress,100);assert.equal(goal.status,'active');
 v=goalProgress(goal,[sessions[1]],'2026-11-24');assert.equal(v.enough,false);assert.equal(v.met,false);
 assert.equal(goalTasks([goal],'t','2026-11-24').length,1);
 assert.throws(()=>validateGoal({...goal,target:30}));
 assert.equal(goalProgress({...goal,metric:'errors',baseline:40,target:10},sessions,'2026-11-24').met,true);
});
test('Цели: связи, ревизии, копия и защита от повреждённых ссылок',async()=>{
 await db.clearAll();await S.load();const team=await C.saveTeam({name:'Команда'}),player=await C.savePlayer({teamId:team.id,name:'Игрок',position:'setter'});
 const g=await saveGoal({...goal,id:undefined,teamId:team.id,playerId:player.id});
 const next=await saveGoal({...g,status:'completed'});assert.equal(next.revision,1);await assert.rejects(saveGoal({...g,name:'Старая'}),/изменена/);
 const backup=await S.makeBackup();assert.equal(backup.version,16);await S.restoreBackup(backup);assert.equal((await W.listWork('coachGoal'))[0].status,'completed');
 const broken=structuredClone(backup);broken.data.workRecords[0].playerId='missing';await assert.rejects(S.restoreBackup(broken));assert.equal((await W.listWork('coachGoal')).length,1);
});
