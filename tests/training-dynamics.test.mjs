import test from 'node:test';import assert from 'node:assert/strict';
import {trainingDynamics,trainingDynamicsCsv} from '../js/training-dynamics.js';
import {detailEvent,replayDetailed} from '../js/match-protocol.js';
import {parseVolleyRows,buildVolleyImport} from '../js/volleypoint-import.js';
import {timingRows} from './fixtures/volleypoint-timing-fixture.mjs';
const players=Array.from({length:6},(_,i)=>({id:'p'+(i+1),name:'Player '+(i+1)})),ids=players.map(p=>p.id);
const t=(date,attendance,effort={},held=true)=>({date,title:'Synthetic',minutes:60,roster:ids.slice(0,2),attendance,effort,held});
const trainings=[
 t('2026-11-02',{p1:'present',p2:'limited'},{p1:{minutes:50,rpe:4},p2:{minutes:20,rpe:3}}),
 t('2026-11-05',{p1:'absent',p2:'present'},{p2:{minutes:60,rpe:6}}),
 t('2026-11-09',{p1:'present',p2:'present'},{p1:{minutes:40,rpe:8}}),
 t('2026-11-11',{p1:'limited',p2:'absent'},{p1:{minutes:20,rpe:4}}),
 t('2026-11-16',{p1:'present'},{},true),
 t('2026-11-17',{}, {},false),t('2026-11-20',{p1:'present',p2:'present'},{p1:{minutes:60,rpe:10}}),
];
const base={mode:'dual',teamName:'A',opponent:'B',competition:'',venue:'',startedAt:'2026-11-09T10:00:00Z',ourPlayers:players,awayPlayers:[],roster:ids,lineup:ids,awayLineup:[],libero:null,bestOf:3,target:15,decider:15,firstServe:'ours',scheme:'5-1',events:[]};
const add=(d,e,s)=>detailEvent(d,e,new Date(Date.parse(base.startedAt)+s*1000).toISOString());
let d=add(base,{type:'clock',running:true},0);d=add(d,{type:'rally',side:'ours',kind:'point'},300);d=add(d,{type:'clock',running:false},600);
const live={date:'2026-11-09',detail:d,roster:ids,sets:[],stats:replayDetailed(d).stats};
const pdf={...buildVolleyImport(parseVolleyRows(timingRows),0,Object.fromEntries(Array.from({length:9},(_,i)=>[i+1,'p'+(i+1)]))),date:'2026-11-11'};
const manual={date:'2026-11-03',roster:ids,sets:[{ours:25,theirs:23}]};
const view={players,trainings,matches:[live,pdf,manual]};
const range={from:'2026-11-02',to:'2026-11-22',today:'2026-11-18'};
test('Weekly preparation: Monday boundaries, known and unknown attendance/RPE, no future data, sources kept separate',()=>{
 const a=trainingDynamics(view,range);assert.equal(a.weeks.length,3);assert.deepEqual(a.weeks.map(w=>[w.from,w.to,w.partial]),[['2026-11-02','2026-11-08',false],['2026-11-09','2026-11-15',false],['2026-11-16','2026-11-18',true]]);
 assert.equal(a.total.scheduled,6);assert.equal(a.total.held,5);assert.equal(a.total.cardMinutes,300);assert.equal(a.total.attended,7);assert.equal(a.total.absent,2);assert.equal(a.total.unknown,1);
 assert.equal(a.total.effortKnown,5);assert.equal(a.total.effortUnknown,2);assert.equal(a.total.actualMinutes,190);assert.equal(a.total.load,1020);
 assert.equal(a.weeks[2].load,null);assert.equal(a.weeks[2].avgRpe,null);assert.equal(a.weeks[2].effortCoverage,0);
 assert.equal(a.total.measuredMs,600000);assert.equal(a.total.pdfMinMs,420000);assert.equal(a.total.unknownMatchTime,1);
 assert.ok(!a.weeks.some(w=>w.delta));assert.match(trainingDynamicsCsv(a),/sRPE/);assert.match(trainingDynamicsCsv(a),/2026-11-16/);
});
test('Individual complete-week change and match time; missing effort, empty, clipped and invalid range',()=>{
 const a=trainingDynamics(view,{...range,playerId:'p1'});assert.equal(a.weeks[0].load,200);assert.equal(a.weeks[1].load,400);
 assert.deepEqual(a.weeks[1].delta,{load:200,pct:100,previous:'2026-11-02'});assert.equal(a.weeks[2].load,null);assert.equal(a.weeks[2].delta,undefined);
 assert.equal(a.total.measuredMs,600000);assert.equal(a.total.pdfMinMs,420000);
 const b=trainingDynamics({...view,trainings:trainings.map(t=>t.date==='2026-11-11'?{...t,effort:{}}:t)},{...range,playerId:'p1'});assert.equal(b.weeks[1].delta,undefined);
 assert.equal(trainingDynamics(view,{...range,from:'2026-11-03',playerId:'p1'}).weeks[1].delta,undefined);
 assert.equal(trainingDynamics(view,{...range,from:'2026-11-19'}).weeks.length,0);
 assert.throws(()=>trainingDynamics(view,{...range,playerId:'missing'}));assert.throws(()=>trainingDynamics(view,{...range,from:'2020-01-01'}));assert.throws(()=>trainingDynamics(view,{...range,from:'2026-11-31'}));
});
