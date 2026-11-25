import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../js/tournaments.js';
import * as S from '../js/store.js';
import * as W from '../js/workbench.js';
import * as db from '../js/db.js';
const base={name:'Кубок',system:'league',format:'volleyball',bestOf:3,target:25,decider:15,names:['А','Б','В','Г','Д']};
test('Турнир: нечётный круговой состав, партии и турнирные очки',()=>{
 let t=T.makeTournament(base);const games=T.gamesOf(t);assert.equal(games.length,10);assert.equal(new Set(games.map(g=>[g.a,g.b].sort().join('/'))).size,10);
 const g=games[0],r=T.resultOf(t,g,{sets:[{a:25,b:20},{a:20,b:25},{a:15,b:13}]});
 t=T.applyGame(t,g.id,{result:r,date:'2026-11-25',time:'10:00',venue:'Зал'});const rows=T.standings(t);
 assert.equal(rows.find(x=>x.id===g.a).points,2);assert.equal(rows.find(x=>x.id===g.b).points,1);
 assert.throws(()=>T.resultOf(t,g,{sets:[{a:25,b:24},{a:25,b:10}]}));
 assert.equal(T.tournamentCalendar([t],'2026-11-25','2026-11-25').length,1);
 assert.match(T.tournamentCsv(t,'standings'),/Место/);
});
test('Турнир: проход без соперника, финал и защита зависимых результатов',()=>{
 let t=T.makeTournament({...base,system:'knockout',format:'score',names:['А','Б','В']});
 const first=T.gamesOf(t);assert.equal(first.filter(g=>g.bye).length,1);assert.equal(first.filter(g=>g.ready&&!g.bye).length,1);
 const g=first.find(g=>g.ready&&!g.bye);
 t=T.applyGame(t,g.id,{result:T.resultOf(t,g,{a:2,b:1})});const final=T.gamesOf(t).at(-1);assert.equal(final.ready,true);
 t=T.applyGame(t,final.id,{result:T.resultOf(t,final,{a:3,b:1})});assert.ok(T.tournamentChampion(t));
 assert.throws(()=>T.applyGame(t,g.id,{result:T.resultOf(t,g,{a:0,b:2})}));
 assert.throws(()=>T.applyGame(t,g.id,{result:null}));
});
test('Турнир: запись, защита ревизии и резервная копия',async()=>{
 await db.clearAll();await S.load();const t=await T.createTournament(base),g=T.gamesOf(t)[0];
 const next=await T.saveGame(t.id,t.revision,g.id,{date:'2026-11-25',time:'10:00',venue:'Зал'});
 await assert.rejects(T.saveGame(t.id,t.revision,g.id,{date:'2026-11-26'}),/изменился/);
 const b=await S.makeBackup();await S.restoreBackup(b);assert.equal((await W.listWork('tournament'))[0].revision,next.revision);
 const bad=structuredClone(b);delete bad.data.workRecords[0].games[g.id];await assert.rejects(S.restoreBackup(bad));assert.equal((await W.listWork('tournament')).length,1);
});

test('Две группы + плей-офф: квалификация, равенство, зависимые результаты',()=>{
 let t=T.makeTournament({...base,system:'groups',format:'score',names:['А','Б','В','Г']});
 assert.equal(T.gamesOf(t).length,5);assert.equal(T.gamesOf(t).filter(g=>g.ready).length,2);
 for(const g of T.gamesOf(t).filter(x=>x.group))t=T.applyGame(t,g.id,{result:T.resultOf(t,g,{a:2,b:2})});
 assert.equal(T.groupStandings(t).every(g=>g.complete&&g.tied&&g.seeds===null),true);
 assert.equal(T.gamesOf(t).filter(g=>g.playoff&&g.ready).length,0);
 for(const g of T.groupStandings(t))t=T.applyGroupSeeds(t,g.group,g.rows.map(r=>r.id));
 for(const g of T.gamesOf(t).filter(g=>g.playoff&&g.ready))t=T.applyGame(t,g.id,{result:T.resultOf(t,g,{a:3,b:1})});
 const final=T.gamesOf(t).at(-1);assert.equal(final.ready,true);assert.throws(()=>T.resultOf(t,final,{a:1,b:1}));
 t=T.applyGame(t,final.id,{result:T.resultOf(t,final,{a:3,b:2})});assert.ok(T.tournamentChampion(t));
 assert.throws(()=>T.applyGame(t,T.gamesOf(t)[0].id,{result:null}));
});

import {drawTournamentNames,tournamentScheduleConflicts} from '../js/tournaments.js';
test('draw preserves names and detects same start referee, venue and team',()=>{const names=['A','B','C','D'];assert.deepEqual(drawTournamentNames(names,()=>0).sort(),names);assert.deepEqual(names,['A','B','C','D']);assert.throws(()=>drawTournamentNames(['A']));let t=T.makeTournament({name:'Test',system:'league',format:'score',bestOf:1,target:25,decider:15,names});const games=T.gamesOf(t);const a=games[0],b=games.find(g=>g.id!==a.id&&[a.a,a.b].includes(g.a));const patch={date:'2026-11-25',time:'10:00',venue:'Hall',referee:'Referee'};t=T.applyGame(t,a.id,patch);t=T.applyGame(t,b.id,patch);assert.deepEqual(tournamentScheduleConflicts(t)[0].reasons,['Площадка','Судья','Команда']);assert.match(T.tournamentCsv(t),/Referee/);});
