import {BACKUP_VERSION} from '../js/backup.js';
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {replayDetailed,detailEvent,reportData,placementSummary,rallyReasonOptions,rallyCandidates,setMomentum,validBoardColors,opponentHistory,rallySummary,scoutSummary} from '../js/match-protocol.js';
import * as C from '../js/coach.js';
import * as S from '../js/store.js';
import * as db from '../js/db.js';
const players=Array.from({length:7},(_,i)=>({id:'a'+i,name:'Игрок '+i,number:i}));
const away=Array.from({length:7},(_,i)=>({id:'b'+i,name:'Игрок '+i,number:i}));
const base={mode:'dual',teamName:'Наши',opponent:'Гости',competition:'',venue:'',startedAt:'2026-01-01T12:00:00Z',ourPlayers:players,awayPlayers:away,roster:players.map(p=>p.id),lineup:players.slice(0,6).map(p=>p.id),awayLineup:away.slice(0,6).map(p=>p.id),libero:'a6',scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'theirs',events:[]};
test('Очко фиксируется первым, автор выбирается до перехода, без второго очка',()=>{
 let d=detailEvent(base,{type:'rally',side:'ours',kind:'point'});let s=replayDetailed(d);assert.equal(s.ours,1);assert.equal(s.lineup[0],'a1');
 d=detailEvent(d,{type:'attribute',kind:'serveError',player:'b0'});s=replayDetailed(d);
 assert.equal(s.ours,1);assert.equal(d.events.length,1);assert.equal(s.sides.theirs.stats.b0.errors,1);assert.equal(s.sides.ours.opponentErrors,1);
 assert.equal(s.timeline[0].before.lineups.ours[0],'a0');
 assert.throws(()=>detailEvent(d,{type:'attribute',kind:'ace',player:'a1'}),/подающей/);
 d=detailEvent(d,{type:'rally',side:'theirs',kind:'point'});s=replayDetailed(d);assert.equal(s.awayLineup[0],'b1');
 d=detailEvent(d,null);assert.equal(replayDetailed(d).theirs,0);
});
test('Расстановки и серии учитывают розыгрыш до перехода, неизвестные очки отдельно',()=>{
 let d=detailEvent(base,{type:'rally',side:'ours',kind:'point'});
 d=detailEvent(d,{type:'rally',side:'ours',kind:'ace',player:'a1'});
 d=detailEvent(d,{type:'rally',side:'theirs',kind:'receiveError',player:'a2'});
 const s=replayDetailed(d);assert.equal(s.sides.ours.onServe,1);assert.equal(s.sides.ours.rotations[0].won,1);
 assert.equal(s.sides.ours.rotations[1].rallies,2);assert.equal(s.sides.ours.runs[0].won,1);
 assert.equal(s.sides.ours.unknown,1);assert.equal(s.stats.a1.aces,1);
 assert.equal(s.sides.theirs.opponentErrors,1);
});
test('Подробный матч переносит историю и обе команды в копию, последний розыгрыш уточняется и после окончания',async()=>{
 await db.clearAll();await S.load();const team=await C.saveTeam({name:'Наши'}),ps=[];
 for(let i=0;i<6;i++)ps.push(await C.savePlayer({teamId:team.id,name:'Игрок '+i,number:i,position:'universal'}));
 const roster=ps.map(p=>p.id),lineup=[...roster];
 let d=await C.startDetailedMatch({...base,teamId:team.id,date:'2026-01-01',ourPlayers:ps,roster,lineup,libero:null});
 for(let i=0;i<15;i++)d=await C.changeLiveMatch(d.id,d.revision,{type:'rally',side:'ours',kind:'point'});
 d=await C.changeLiveMatch(d.id,d.revision,{type:'next',lineup,awayLineup:base.awayLineup,serve:'ours'});
 for(let i=0;i<15;i++)d=await C.changeLiveMatch(d.id,d.revision,{type:'rally',side:'ours',kind:'point'});
 d=await C.changeLiveMatch(d.id,d.revision,{type:'attribute',kind:'kill',player:lineup[0]});
 const beforeColors=d.events;d=await C.changeLiveColors(d.id,d.revision,{ours:'green',theirs:'purple'});assert.deepEqual(d.events,beforeColors);assert.equal(d.boardColors.ours,'green');
 const m=await C.finishLiveMatch(d.id,d.revision);assert.equal(m.detail.boardColors.theirs,'purple');assert.equal(m.detail.events.length,31);assert.equal(reportData(m.detail).sets.length,2);
 assert.equal(m.stats[lineup[0]].attackKills,1);
 const b=await S.makeBackup();assert.equal(b.version,BACKUP_VERSION);await S.restoreBackup(b);
 assert.equal((await C.loadCoach()).coachMatches[0].detail.awayPlayers.length,7);
 await assert.rejects(C.saveMatch(m),/нельзя редактировать/);
});

test('terminal placements are optional metadata, never another point or inferred location',()=>{
 let d=detailEvent(base,{type:'rally',side:'theirs',kind:'ace',player:'b0'});
 d=detailEvent(d,{type:'placement',zone:5});let s=replayDetailed(d);
 assert.equal(s.theirs,1);assert.equal(d.events.length,1);assert.equal(s.timeline[0].placement,5);
 assert.throws(()=>detailEvent(d,{type:'placement',zone:7}),/зону/);
 d=detailEvent(d,{type:'rally',side:'theirs',kind:'ace',player:'b0'});s=replayDetailed(d);
 assert.deepEqual(placementSummary(s.timeline,'theirs','ace'),{zones:[0,0,0,0,1,0],total:2,known:1,unknown:1});
 d=detailEvent(d,{type:'placement',zone:2});d=detailEvent(d,{type:'attribute',kind:'point',player:null});
 assert.equal(d.events.at(-1).placement,undefined);assert.equal(replayDetailed(d).theirs,2);
 assert.throws(()=>detailEvent(d,{type:'placement',zone:1}),/направление/);
 d=detailEvent(d,null);assert.equal(replayDetailed(d).theirs,1);
});

test('Скидка — одна результативная атака и одно очко, ошибка защиты — игрок проигравшей команды',()=>{
 let d=detailEvent(base,{type:'rally',side:'ours',kind:'tip',player:'a2',placement:4});
 let s=replayDetailed(d);
 assert.equal(s.ours,1);assert.equal(s.stats.a2.attackKills,1);assert.equal(s.stats.a2.attacks,1);assert.equal(s.stats.a2.points,1);
 assert.equal(s.sides.ours.stats.a2.tipKills,1);assert.equal(placementSummary(s.timeline,'ours','kill').zones[3],1);
 d=detailEvent(d,{type:'rally',side:'ours',kind:'defenseError',player:'b2'});
 s=replayDetailed(d);assert.equal(s.ours,2);assert.equal(s.sides.theirs.stats.b2.defenseErrors,1);assert.equal(s.sides.theirs.stats.b2.otherErrors,1);assert.equal(s.sides.ours.opponentErrors,1);
 assert.throws(()=>detailEvent(d,{type:'rally',side:'ours',kind:'defenseError',player:'a2'}),/до перехода/);
 assert.equal(replayDetailed(detailEvent(d,null)).ours,1);
});
test('Причины и авторы фильтруются по подаче, стороне, зоне и либеро до начисления',()=>{
 const lineups={ours:base.lineup,theirs:base.awayLineup};
 assert.ok(rallyReasonOptions('ours','theirs').includes('serveError'));
 assert.ok(!rallyReasonOptions('ours','theirs').includes('ace'));
 assert.ok(!rallyReasonOptions('ours','theirs').includes('receiveError'));
 assert.ok(rallyReasonOptions('theirs','theirs').includes('receiveError'));
 assert.deepEqual(rallyCandidates(base,lineups,'theirs','ours','serveError').map(p=>p.id),['b0']);
 assert.deepEqual(rallyCandidates(base,lineups,'theirs','ours','block').map(p=>p.id),['a1','a2','a3']);
 assert.deepEqual(rallyCandidates(base,lineups,'theirs','ours','defenseError').map(p=>p.id),base.awayLineup);
 assert.deepEqual(rallyCandidates({...base,awayPlayers:[]},{...lineups,theirs:[]},'theirs','ours','serveError'),[]);
});

test('Дополнительная ошибка защиты не меняет счёт, основную причину и сумму очков на ошибках',()=>{
 let d=detailEvent(base,{type:'rally',side:'ours',kind:'tip',player:'a2'});
 d=detailEvent(d,{type:'secondary',player:'b3'});
 let s=replayDetailed(d);
 assert.equal(s.ours,1);assert.equal(d.events.length,1);assert.equal(s.stats.a2.attackKills,1);
 assert.equal(s.sides.theirs.stats.b3.defenseErrors,1);assert.equal(s.sides.ours.opponentErrors,0);
 assert.throws(()=>detailEvent(d,{type:'secondary',player:'a1'}),/до розыгрыша/);
 d=detailEvent(d,{type:'secondary',player:null});assert.equal(replayDetailed(d).sides.theirs.stats.b3,undefined);
 d=detailEvent(d,{type:'secondary',player:'b3'});d=detailEvent(d,{type:'attribute',kind:'point'});assert.equal(d.events[0].secondary,undefined);
});
test('Ход партии учитывает только розыгрыши выбранного сета, серии и смену лидера',()=>{
 let d=base;for(const side of ['ours','ours','theirs','theirs','theirs','ours','ours'])d=detailEvent(d,{type:'rally',side,kind:'point'});
 d=detailEvent(d,{type:'timeout',side:'theirs'});const a=setMomentum(replayDetailed(d).timeline,1);
 assert.deepEqual(a.points.at(-1),{ours:4,theirs:3});assert.deepEqual(a.maxRun,{ours:2,theirs:3});assert.deepEqual(a.maxLead,{ours:2,theirs:1});assert.equal(a.ties,2);assert.equal(a.changes,2);
 assert.equal(setMomentum(replayDetailed(d).timeline,2).points.length,1);
});

test('Цвета проверяются, старый матч остаётся допустим, история соперника берёт последнюю встречу',()=>{
 assert.equal(validBoardColors({ours:'green',theirs:'purple'}),true);assert.equal(validBoardColors({ours:'green',theirs:'green'}),false);
 assert.throws(()=>replayDetailed({...base,boardColors:{ours:'invalid',theirs:'red'}}),/параметры/);
 assert.equal(replayDetailed(base).ours,0);assert.equal(replayDetailed({...base,boardColors:{ours:'green',theirs:'purple'}}).ours,0);
 const matches=[{id:'old',teamId:'t',date:'2026-01-01',opponent:'Гости',detail:base},{id:'new',teamId:'t',date:'2026-02-01',opponent:' гости ',detail:base},{id:'other',teamId:'x',date:'2026-03-01',opponent:'Гости',detail:base}];
 assert.deepEqual(opponentHistory(matches,'t').map(m=>m.id),['new']);
});

test('Фильтр карты различает скидки и атаки, автора и партию, неизвестные зоны',()=>{
 const events=[{type:'rally',set:1,side:'ours',kind:'tip',player:'a1',placement:4},{type:'rally',set:1,side:'ours',kind:'kill',player:'a2'},{type:'rally',set:2,side:'ours',kind:'kill',player:'a1',placement:6},{type:'rally',set:1,side:'theirs',kind:'tip',player:'b1',placement:1}];
 assert.equal(placementSummary(events,'ours','kill').total,3);assert.equal(placementSummary(events,'ours','kill',{includeTips:false}).total,2);
 assert.deepEqual(placementSummary(events,'ours','tip',{set:1,player:'a1'}),{zones:[0,0,0,1,0,0],total:1,known:1,unknown:0});
 assert.equal(placementSummary(events,'ours','kill',{set:1,includeTips:false}).unknown,1);
});
test('Статистика партии учитывает дополнительную ошибку, не удваивает очко и соответствует движку',()=>{
 let d=detailEvent(base,{type:'rally',side:'ours',kind:'tip',player:'a2',secondary:{kind:'defenseError',player:'b2'}});
 for(let i=1;i<15;i++)d=detailEvent(d,{type:'rally',side:'ours',kind:'point'});
 d=detailEvent(d,{type:'next',lineup:base.lineup,awayLineup:base.awayLineup,serve:'ours'});
 d=detailEvent(d,{type:'rally',side:'theirs',kind:'kill',player:'b2'});
 const s=replayDetailed(d),a=rallySummary(s.timeline,1),b=rallySummary(s.timeline,2),all=rallySummary(s.timeline);
 assert.equal(a.ours.points,15);assert.equal(a.theirs.points,0);assert.equal(a.ours.stats.a2.tipKills,1);assert.equal(a.theirs.stats.b2.defenseErrors,1);
 assert.equal(b.theirs.points,1);assert.equal(b.theirs.stats.b2.attackKills,1);assert.equal(b.theirs.stats.b2.defenseErrors,undefined);
 assert.equal(all.ours.points,s.sides.ours.points);assert.equal(all.theirs.stats.b2.errors,s.sides.theirs.stats.b2.errors);
 assert.equal(a.ours.serve,14);assert.equal(a.ours.receiveWon,1);
});

test('Разведка разделяет ошибки игроков, зоны и неизвестные данные, учитывает текущую шестёрку',()=>{
 let d=detailEvent(base,{type:'rally',side:'ours',kind:'tip',player:'a2',placement:4,secondary:{kind:'defenseError',player:'b3'}});
 d=detailEvent(d,{type:'rally',side:'ours',kind:'ace',player:'a1',placement:6});
 d=detailEvent(d,{type:'rally',side:'ours',kind:'receiveError',player:'b2',placement:6});
 d=detailEvent(d,{type:'rally',side:'ours',kind:'defenseError',player:'b3'});
 d=detailEvent(d,{type:'sub',side:'theirs',out:'b3',in:'b6'});
 d=detailEvent(d,{type:'rally',side:'theirs',kind:'kill',player:'b1',placement:2,secondary:{kind:'defenseError',player:'a2'}});
 const s=replayDetailed(d),a=scoutSummary(s.timeline,'theirs',{active:s.awayLineup});
 assert.equal(a.total,4);assert.equal(a.knownPlayers,3);assert.equal(a.knownZones,3);assert.equal(a.zones[5],2);
 assert.equal(a.ranked[0].id,'b2');assert.equal(a.ranked[0].serve,1);assert.equal(a.former[0].id,'b3');assert.equal(a.former[0].misses,2);
 assert.equal(a.rows.find(x=>x.id==='b6').misses,0);
 assert.equal(scoutSummary(s.timeline,'theirs',{kind:'tip',active:s.awayLineup}).total,1);
 const ours=scoutSummary(s.timeline,'ours',{active:s.lineup});assert.equal(ours.ranked[0].id,'a2');assert.equal(ours.ranked[0].attack,1);
 assert.equal(scoutSummary(replayDetailed(detailEvent(d,null)).timeline,'ours',{active:s.lineup}).total,0);
});
test('Разведка не приписывает ошибку игроку по позиции мяча, не считает незаписанный состав',()=>{
 let d=detailEvent({...base,awayPlayers:[],awayLineup:[]},{type:'rally',side:'ours',kind:'tip',player:'a2',placement:3});
 const s=replayDetailed(d),a=scoutSummary(s.timeline,'theirs',{active:[]});
 assert.equal(a.total,1);assert.equal(a.knownPlayers,0);assert.equal(a.knownZones,1);assert.equal(a.ranked.length,0);
});

test('Разведка использует реальные позиции после перехода и не переносит ошибки на сменившего игрока',()=>{
 let d=detailEvent(base,{type:'rally',side:'theirs',kind:'ace',player:'b0',secondary:{kind:'receiveError',player:'a3'},placement:4});
 d=detailEvent(d,{type:'rally',side:'ours',kind:'point'});
 let s=replayDetailed(d),a=scoutSummary(s.timeline,'ours',{active:s.lineup,kind:'serve'});
 assert.equal(a.rows.find(x=>x.id==='a3').zone,3);assert.equal(a.rows.find(x=>x.id==='a3').misses,1);
 assert.equal(a.zones[3],1);assert.equal(a.zones[2],0);
});
