import test from 'node:test';
import assert from 'node:assert/strict';
import {detailEvent} from '../js/match-protocol.js';
import {matchTactics,teamTactics} from '../js/match-tactics.js';
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
