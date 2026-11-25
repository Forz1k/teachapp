import test from 'node:test';
import assert from 'node:assert/strict';
import {detailEvent,replayDetailed} from '../js/match-protocol.js';
import {matchTactics,teamTactics,matchDebrief,trainingRecommendations,rotationPerformance,recordedConnections,substitutionWindows} from '../js/match-tactics.js';
const p=Array.from({length:7},(_,i)=>({id:'a'+i,name:'Игрок '+i,number:i}));
const base={mode:'dual',teamName:'Наши',opponent:'Гости',competition:'',venue:'',startedAt:'2026-01-01T12:00:00Z',ourPlayers:p,awayPlayers:[],roster:p.map(p=>p.id),lineup:p.slice(0,6).map(p=>p.id),awayLineup:[],libero:null,scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'theirs',events:[]};
const append=(d,side)=>detailEvent(d,{type:'rally',side,kind:'point'});
test('Тактика: розыгрыши до перехода, фактический состав и счёт',()=>{
 let d=append(base,'ours');d=append(d,'ours');
 d=detailEvent(d,{type:'sub',side:'ours',out:'a0',in:'a6'});d=append(d,'theirs');
 const a=matchTactics(d);assert.equal(a.overall.rallies,3);assert.equal(a.overall.won,2);assert.equal(a.overall.serveRate,50);assert.equal(a.overall.receiveRate,100);
 assert.deepEqual(a.sets[0].score.map(x=>[x.ours,x.theirs]),[[0,0],[1,0],[2,0],[2,1]]);
 assert.equal(a.rotations[0].won,1);assert.equal(a.rotations[1].rallies,2);
 assert.equal(a.six.length,2);assert.equal(a.six.find(r=>r.players.includes('a6')).rallies,1);assert.equal(a.pairs.find(r=>r.players.includes('a0')&&r.players.includes('a1')).rallies,2);
});
test('Тактика: тайм-ауты и матчи без полной истории',()=>{
 let d=base;for(let i=0;i<5;i++)d=append(d,'theirs');
 d=detailEvent(d,{type:'timeout',side:'ours'});for(let i=0;i<5;i++)d=append(d,'ours');
 const a=matchTactics(d);assert.equal(a.timeouts[0].delta,100);
 const matches=[{date:'2026-01-01',opponent:'Гости',sets:[{ours:25,theirs:22}],detail:d},{date:'2026-01-02',opponent:' гости ',sets:[{ours:10,theirs:25}]}];
 const summary=teamTactics(matches,{opponent:'гости',min:15});
 assert.equal(summary.total,2);assert.equal(summary.detailed,1);assert.equal(summary.overall.rallies,10);assert.ok(summary.six.every(r=>!r.eligible));assert.equal(summary.opponents[0].matches,2);
});

test('Сочетания фильтруются по партии и минимальной выборке',()=>{
 let d=base;for(let i=0;i<15;i++)d=append(d,'ours');
 d=detailEvent(d,{type:'next',lineup:['a6',...base.lineup.slice(1)],awayLineup:[],serve:'ours'});
 d=append(d,'theirs');d=append(d,'ours');
 const a=matchTactics(d,5,{set:2,min:2});
 assert.equal(a.overall.rallies,2);assert.equal(a.sets.length,1);assert.equal(a.sets[0].set,2);
 assert.equal(a.six.length,1);assert.equal(a.six[0].eligible,true);assert.equal(a.six[0].players.includes('a6'),true);assert.equal(a.six[0].plusMinus,0);
 assert.equal(matchTactics(d,5,{set:2,min:3}).six[0].eligible,false);
});

test('Послематчевые выводы не выдают неизвестные причины за ошибки',()=>{
 let d=base;
 for(let i=0;i<6;i++)d=append(d,'theirs');
 const a=matchDebrief(d);assert.equal(a.rallies,6);assert.equal(a.detailed,0);assert.equal(a.errors.length,0);assert.ok(a.notes.some(x=>x.kind==='data'));assert.ok(!a.notes.some(x=>x.kind==='strength'));
});
test('Послематчевые выводы используют частоту отмеченных причин, а не выдуманные проценты',()=>{
 let d={...base,firstServe:'ours'};
 for(let i=0;i<3;i++){d=detailEvent(d,{type:'rally',side:'theirs',kind:'serveError',player:null});d=append(d,'ours');}
 const a=matchDebrief(d);assert.equal(a.errors[0].count,3);assert.ok(a.notes.some(x=>x.title==='Частые отмеченные причины потери очка'));assert.equal(a.detailed,3);
});

test('Подбор упражнений опирается на выборку и причину, не на неизвестные попытки',()=>{
 const exercises=[{id:'s',category:'volleyball',name:'Подача в зону',description:'Серия подач',minutes:10,equipment:'Мячи'},{id:'p',category:'volleyball',name:'Приём',description:'Приём мяча'},{id:'x',category:'fitness',name:'Подача'}];
 const d={detailed:12,rallies:30,errors:[{kind:'serveError',count:3},{kind:'receiveError',count:2},{kind:'unknown',count:20}]};
 const r=trainingRecommendations(d,exercises);assert.equal(r.length,1);assert.equal(r[0].count,3);assert.equal(r[0].detailed,12);assert.equal(r[0].rallies,30);assert.deepEqual(r[0].exercises.map(x=>x.id),['s']);assert.deepEqual(trainingRecommendations({...d,detailed:9},exercises),[]);assert.equal(trainingRecommendations(d,[])[0].exercises.length,0);
});

test('Rotation performance uses phase before point and independent phase sample thresholds',()=>{
 let d=append(base,'ours');d=append(d,'ours');d=append(d,'theirs');d=append(d,'theirs');d=append(d,'ours');
 const s=replayDetailed(d),a=rotationPerformance(s.timeline,{min:2}).ours.rows;
 assert.equal(a[0].receive,1);assert.equal(a[0].receiveWon,1);assert.equal(a[0].receiveEligible,false);
 assert.equal(a[1].serve,2);assert.equal(a[1].serveWon,1);assert.equal(a[1].serveEligible,true);
 assert.equal(a[1].receive,2);assert.equal(a[1].receiveWon,1);assert.equal(a[1].receiveEligible,true);
 const b=rotationPerformance(s.timeline,{min:2}).theirs.rows;
 assert.equal(b.reduce((n,r)=>n+r.serve,0),a.reduce((n,r)=>n+r.receive,0));
 assert.equal(a.reduce((n,r)=>n+r.rallies,0),5);
 assert.equal(rotationPerformance(s.timeline,{set:2}).ours.rows.every(r=>r.rate===null),true);
 assert.throws(()=>rotationPerformance(s.timeline,{min:0}));
});
test('Rotation comparison ignores small phase samples and preserves ties',()=>{
 const events=[...Array.from({length:10},()=>({type:'rally',set:1,side:'theirs',before:{serve:'ours'},rotation:{ours:0,theirs:0}})),...Array.from({length:10},()=>({type:'rally',set:1,side:'ours',before:{serve:'ours'},rotation:{ours:1,theirs:0}})),{type:'rally',set:1,side:'ours',before:{serve:'ours'},rotation:{ours:2,theirs:0}}];
 const r=rotationPerformance(events,{min:10}).ours;
 assert.deepEqual(r.comparisons,[{phase:'serve',low:[1],high:[2],gap:100}]);assert.equal(r.rows[2].serveEligible,false);
});
test('Recorded connections count only complete adjacent same-side set and attack pairs, not inferred assists',()=>{
 const touch=(side,player,action,result)=>({side,player,action,result});
 const e={type:'rally',set:1,side:'ours',captureComplete:true,touches:[touch('theirs','b','serve','continue'),touch('ours','a0','receive','continue'),touch('ours','a1','set','continue'),touch('ours','a2','attack','point')]};
 const miss={...e,side:'theirs',touches:[...e.touches.slice(0,-1),touch('ours','a2','attack','error')]};
 const continued={...e,touches:[...e.touches.slice(0,-1),touch('ours','a2','attack','continue'),touch('theirs','b','defense','continue'),touch('theirs','b','attack','error')]};
 const unrelated={...e,touches:[...e.touches.slice(0,-1),touch('theirs','b','defense','continue'),touch('ours','a2','attack','point')]};
 const a=recordedConnections([[e,miss,continued,{...e,captureComplete:false},unrelated]],{min:4});
 assert.equal(a.rallies,5);assert.equal(a.complete,4);assert.equal(a.linkedRallies,3);
 assert.deepEqual(a.rows,[{setter:'a1',attacker:'a2',attempts:3,points:1,errors:1,continued:1,eligible:false,efficiency:0}]);
 assert.equal(recordedConnections([[e],[miss]],{min:2}).rows[0].eligible,true);
 assert.throws(()=>recordedConnections([[e],[miss]],{side:'theirs'}));
});
test('Substitution windows are scoped to party and event side, not causal effects',()=>{
 let d=base;for(let i=0;i<5;i++)d=append(d,'theirs');
 d=detailEvent(d,{type:'sub',side:'ours',out:'a0',in:'a6'});for(let i=0;i<5;i++)d=append(d,'ours');
 const timeline=replayDetailed(d).timeline,r=substitutionWindows(timeline);
 assert.equal(r.length,1);assert.deepEqual(r[0].before,{won:0,total:5,rate:0});assert.deepEqual(r[0].after,{won:5,total:5,rate:100});assert.equal(r[0].delta,100);
 assert.deepEqual(substitutionWindows(timeline,{set:2}),[]);
 const last=[...timeline.slice(0,6),{...timeline[6],set:2}];assert.equal(substitutionWindows(last)[0].delta,null);
});
