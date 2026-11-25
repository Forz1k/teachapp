import 'fake-indexeddb/auto';import test from 'node:test';import assert from 'node:assert/strict';import * as db from '../js/db.js';import * as C from '../js/coach.js';import * as S from '../js/store.js';
import {replayDetailed,detailEvent,courtTime,reportData,spectatorSnapshot} from '../js/match-protocol.js';
import {courtTimeLabel} from '../js/court-time.js';
import {projectScope} from '../js/sync.js';
const start=Date.parse('2026-11-01T10:00:00.000Z'),at=s=>new Date(start+s*1000).toISOString(),players=Array.from({length:9},(_,i)=>({id:'a'+i,name:'Player '+i,number:i})),away=Array.from({length:6},(_,i)=>({id:'b'+i,name:'Away '+i,number:i}));
const base={mode:'dual',teamName:'Наши',opponent:'Гости',competition:'',venue:'',startedAt:at(0),ourPlayers:players,awayPlayers:away,roster:players.map(p=>p.id),lineup:players.slice(0,6).map(p=>p.id),awayLineup:away.map(p=>p.id),libero:'a7',libero2:'a8',scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'theirs',events:[]};
const ev=(d,e,t)=>detailEvent(d,e,at(t)),point={type:'rally',side:'ours',kind:'point'},run={type:'clock',running:true},pause={type:'clock',running:false};
test('Court time attributes intervals to actual six, substitutions and both liberos; auto return after rotation',()=>{
 let d=ev(base,run,10);
 d=ev(d,{type:'sub',side:'ours',out:'a0',in:'a6'},20);
 d=ev(d,{type:'libero',for:'a4',player:'a7'},30);
 d=ev(d,{type:'libero',for:'a4',player:'a8'},40);
 d=ev(d,point,50);
 d=ev(d,{type:'rally',side:'theirs',kind:'point'},55);
 d=ev(d,point,60); // a4 moves from P4 to P3 (front), already auto returned on first rotation.
 d=ev(d,pause,70);
 const t=courtTime(replayDetailed(d));
 assert.equal(t.elapsedMs,60000);assert.equal(t.players.ours.a0,10000);assert.equal(t.players.ours.a6,50000);assert.equal(t.players.ours.a7,10000);assert.equal(t.players.ours.a8,10000);assert.equal(t.players.ours.a4,40000);
 assert.equal(Object.values(t.players.ours).reduce((a,b)=>a+b,0),6*t.elapsedMs);
 assert.equal(Object.values(t.players.theirs).reduce((a,b)=>a+b,0),6*t.elapsedMs);
 assert.equal(t.running,false);assert.equal(t.partial,false);assert.equal(courtTimeLabel(t.players.ours.a0),'0:10');
 assert.equal(courtTime(replayDetailed(JSON.parse(JSON.stringify(d))),at(100)).elapsedMs,60000);
});
test('Pause at timeout and side change, separate set clock, no pre-game/inter-set time, partial coverage',()=>{
 let d=ev(base,run,20);
 d=ev(d,point,30);d=ev(d,{type:'timeout',side:'ours'},40);
 assert.equal(courtTime(replayDetailed(d),at(90)).elapsedMs,20000);
 d=ev(d,point,70); // deliberately missed resume, report partial
 d=ev(d,run,80);d=ev(d,{type:'changeEnds'},90);
 d=ev(d,run,100);
 for(let i=0;i<13;i++)d=ev(d,point,110+i);
 const first=courtTime(replayDetailed(d));assert.equal(first.running,false);assert.equal(first.elapsedMs,52000);assert.equal(first.untrackedRallies,1);
 assert.throws(()=>ev(d,run,130),/между партиями/);
 d=ev(d,{type:'next',lineup:base.lineup,awayLineup:base.awayLineup,serve:'ours'},200);
 assert.equal(courtTime(replayDetailed(d),at(250)).elapsedMs,52000);
 d=ev(d,run,260);d=ev(d,point,270);d=ev(d,pause,280);
 const t=courtTime(replayDetailed(d),at(500));assert.equal(t.elapsedMs,72000);assert.equal(t.sets[0].elapsedMs,52000);assert.equal(t.sets[1].elapsedMs,20000);assert.equal(t.partial,true);
 assert.equal(reportData(d).courtTime.elapsedMs,72000);assert.ok(!JSON.stringify(spectatorSnapshot(d)).includes('courtTime'));
});
test('Undo, stale clock time and legacy/partial evidence: never impute unrecorded time',()=>{
 const legacy=ev(base,point,10),unknown=courtTime(replayDetailed(legacy));assert.equal(unknown.measured,false);assert.equal(unknown.untrackedRallies,1);
 let d=ev(legacy,run,20);d=ev(d,{type:'sub',side:'ours',out:'a2',in:'a6'},30);
 let t=courtTime(replayDetailed(d),at(40));assert.equal(t.partial,true);assert.equal(t.players.ours.a2,10000);assert.equal(t.players.ours.a6,10000);
 d=detailEvent(d,null);t=courtTime(replayDetailed(d),at(40));assert.equal(t.players.ours.a2,20000);assert.equal(t.players.ours.a6,undefined);
 assert.throws(()=>ev(d,run,40),/запуск или пауза/);assert.throws(()=>detailEvent(d,{type:'clock',running:false,extra:'bad'},at(40)),/запуск или пауза/);
 const persisted=courtTime(replayDetailed(d),at(5));assert.equal(persisted.elapsedMs,0);
 const matches=[{id:'old',date:'2026-11-01',opponent:'Ручной',roster:base.roster,stats:{}},{id:'legacy',date:'2026-11-01',opponent:'Старый',roster:base.roster,stats:{},detail:legacy},{id:'new',date:'2026-11-02',opponent:'Новый',roster:base.roster,stats:{},detail:ev(d,pause,40)}];
 const s=C.playerSeasonStats(matches,'a2').playingTime;assert.equal(s.measuredMatches,1);assert.equal(s.unknownMatches,2);assert.equal(s.partialMatches,1);assert.equal(s.totalMs,20000);
 assert.equal(C.playerSeasonStats(matches,'a8').playingTime.totalMs,0);assert.equal(C.playerSeasonStats(matches,'a2',{from:'2026-11-03'}).playingTime.measuredMatches,0);
});
test('Clock persists with final match, backup, school isolation and coach CSV',async()=>{
 await db.clearAll();await S.load();const team=await C.saveTeam({name:'Synthetic'}),ps=[];
 for(let i=0;i<7;i++)ps.push(await C.savePlayer({teamId:team.id,name:'Synthetic '+i,number:i,position:'universal'}));
 const ids=ps.map(p=>p.id);let d=await C.startDetailedMatch({...base,teamId:team.id,date:'2026-11-01',ourPlayers:ps,roster:ids,lineup:ids.slice(0,6),libero:null,libero2:null});
 const anchor=Date.parse(d.startedAt);const add=(e,s)=>{d=detailEvent(d,e,new Date(anchor+s*1000).toISOString());d.revision++;};
 add(run,1);for(let i=0;i<15;i++)add(point,2+i);add({type:'next',lineup:ids.slice(1,7),awayLineup:base.awayLineup,serve:'ours'},30);add(run,31);for(let i=0;i<15;i++)add(point,32+i);
 await db.put('coachLive',d);const m=await C.finishLiveMatch(d.id,d.revision);const t=reportData(m.detail).courtTime;assert.equal(t.elapsedMs,30000);assert.equal(t.players.ours[ids[0]],15000);assert.equal(t.players.ours[ids[6]],15000);
 const backup=await S.makeBackup();assert.equal(projectScope(backup.data,'school').coachMatches.length,0);await S.restoreBackup(backup);
 const view=C.teamView(await C.loadCoach(),team.id);assert.equal(C.playerSeasonStats(view.matches,ids[1]).playingTime.totalMs,30000);assert.match(C.coachCsv(view),/Время на площадке/);assert.match(C.coachCsv(view),/0:30/);
});
