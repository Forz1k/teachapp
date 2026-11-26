import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/store.js';
import * as C from '../js/coach.js';
import * as db from '../js/db.js';
import {saveSeasonPlan,validateSeasonPlan,seasonPlanProgress} from '../js/season-plan.js';
import {projectScope} from '../js/sync.js';
import {makeScopedBackup} from '../js/selective-backup.js';
const phase={name:'Подготовка',kind:'general',from:'2026-11-01',to:'2026-11-14',goal:'Техника',sessions:4,minutes:300};
test('Season plan checks non-overlap, actual session status and weekly boundaries',async()=>{
 await db.clearAll();await S.load();const team=await C.saveTeam({name:'Тестовая команда'});
 const r=await saveSeasonPlan({teamId:team.id,name:'Сезон',from:'2026-11-01',to:'2026-11-30',phases:[phase],revision:0});
 assert.throws(()=>validateSeasonPlan({...r,phases:[phase,{...phase,from:'2026-11-14',to:'2026-11-18'}]}),/пересечений/);
 const a=seasonPlanProgress(r,[{teamId:team.id,date:'2026-11-03',minutes:60,held:true},{teamId:team.id,date:'2026-11-09',minutes:90,held:false},{teamId:team.id,date:'2026-11-25',minutes:50,held:false},{teamId:'other',date:'2026-11-03',minutes:90,held:true}],[], '2026-11-24');
 assert.equal(a.total.held,1);assert.equal(a.total.recordedMinutes,60);assert.equal(a.total.future,1);assert.equal(a.phases[0].unconfirmed,1);assert.equal(a.weeks.length,5);
 const copy=await S.makeBackup();assert.ok(projectScope(copy.data,'coach').workRecords.some(x=>x.id===r.id));assert.ok(!projectScope(copy.data,'school').workRecords.some(x=>x.id===r.id));
 const scoped=makeScopedBackup(copy,{kind:'team',id:team.id});assert.ok(scoped.payload.data.workRecords.some(x=>x.id===r.id));
 await S.restoreBackup(copy);const broken=structuredClone(copy);broken.data.workRecords.find(x=>x.id===r.id).teamId='missing';await assert.rejects(S.restoreBackup(broken),/связь плана сезона/);
});

test('Season target attainment counts only covered held sessions and reports gaps, excess and zero targets',()=>{
 const plan={id:'p',kind:'seasonPlan',teamId:'t',name:'S',from:'2026-11-01',to:'2026-11-30',revision:0,phases:[{...phase,from:'2026-11-03',to:'2026-11-07',sessions:1,minutes:45},{...phase,from:'2026-11-12',to:'2026-11-15',sessions:0,minutes:0}]};
 const session=(date,held=true)=>({teamId:'t',date,held,minutes:60});
 const a=seasonPlanProgress(plan,[session('2026-11-02'),session('2026-11-03'),session('2026-11-04'),session('2026-11-05',false),session('2026-11-13')],[],'2026-11-10');
 assert.equal(a.total.held,3);assert.equal(a.covered.held,2);assert.deepEqual(a.sessionProgress,{target:1,actual:2,remaining:0,over:1,percent:200});
 assert.deepEqual(a.minuteProgress,{target:45,actual:120,remaining:0,over:75,percent:267});assert.equal(a.phases[0].status,'completed');assert.equal(a.phases[1].status,'future');assert.equal(a.phases[1].sessionProgress.percent,null);assert.equal(a.phases[1].held,0);
 assert.deepEqual(a.gaps.map(x=>[x.from,x.to,x.held]),[['2026-11-01','2026-11-02',1],['2026-11-08','2026-11-11',0],['2026-11-16','2026-11-30',0]]);
});
