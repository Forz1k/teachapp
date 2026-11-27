import test from 'node:test';import assert from 'node:assert/strict';
import {makeRehearsal} from '../js/volleyball.js';import {detailEvent,replayDetailed} from '../js/match-protocol.js';
import {setterAnalysis,orderedLineups,rallyStreaks,opponentComparison} from '../js/match-tactics.js';
import {matchComparison,ranked} from '../js/coach-season.js';
const base=()=>makeRehearsal({short:true,id:'analytics',now:new Date('2026-11-27T12:00:00Z')});
const p=i=>'test-a-'+i;
const touch=(player,action,result='continue',quality='positive',side='ours')=>({side,player,action,quality,result,zone:null});
const event={type:'rally',side:'ours',kind:'kill',player:p(1),assist:p(2),captureMode:'pro',captureComplete:true,touches:[touch(p(1),'serve'),touch('test-b-1','receive','continue','positive','theirs'),touch('test-b-2','attack','continue','positive','theirs'),touch(p(3),'defense'),touch(p(2),'set'),touch(p(1),'attack','point')]};
const simple={type:'rally',side:'ours',kind:'kill',player:p(1),assist:p(2)};
const timeline=d=>replayDetailed(d).timeline;
test('ordinary assists and PRO evidence are separate; no double counting, weighted quality and missing data',()=>{
 let d=detailEvent(base(),event);d=detailEvent(d,simple);d=detailEvent(d,{...simple,assist:null});const a=setterAnalysis([timeline(d)],{min:2});
 assert.equal(a.kills,3);assert.equal(a.assists,2);assert.equal(a.attributed,3);assert.equal(a.complete,1);assert.equal(a.pairs[0].assists,2);assert.equal(a.observed.rows[0].attempts,1);const row=a.rows.find(r=>r.id===p(2));assert.equal(row.attempts,1);assert.equal(row.positiveRate,100);assert.equal(row.eligible,false);
 const changed=detailEvent(d,{type:'correctRally',index:1,side:'theirs'});assert.equal(setterAnalysis([timeline(changed)]).assists,1);
 const unknown=detailEvent(base(),{...event,touches:event.touches.map(t=>t.action==='set'?{...t,quality:'unknown'}:t)});const q=setterAnalysis([timeline(unknown)]).rows.find(r=>r.id===p(2));assert.equal(q.positiveRate,null);assert.equal(q.errorRate,0);assert.equal(q.positiveEligible,false);
});
test('actual ordered lineups include active libero and distinct positions, match counts and phase eligibility',()=>{
 let d=detailEvent(base(),simple);d=detailEvent(d,{type:'libero',for:p(5),player:p(9)});d=detailEvent(d,simple);d=detailEvent(d,{type:'rally',side:'theirs',kind:'point'});d=detailEvent(d,{type:'rally',side:'ours',kind:'point'});
 const rows=orderedLineups([timeline(d),timeline(d)],{min:3});assert.equal(rows.reduce((n,r)=>n+r.rallies,0),8);assert.equal(rows.find(r=>r.players[4]===p(9)).rallies,6);assert.equal(rows.find(r=>r.players[4]===p(9)).matches,2);assert.equal(rows.find(r=>r.players[4]===p(9)).receiveEligible,false);assert.throws(()=>orderedLineups([timeline(d),timeline(d)],{side:'theirs'}));
});
test('runs are per set and opponent comparison keeps unknown detail out of rates',()=>{
 let d=base();for(let i=0;i<5;i++)d=detailEvent(d,{type:'rally',side:'ours',kind:'point'});d=detailEvent(d,{type:'next',lineup:d.lineup,awayLineup:d.awayLineup,serve:'ours'});d=detailEvent(d,{type:'rally',side:'ours',kind:'point'});
 const a=rallyStreaks(timeline(d));assert.deepEqual(a.rows.map(r=>[r.set,r.length,r.start,r.end]),[[1,5,'0:0','5:0'],[2,1,'0:0','1:0']]);assert.equal(a.summary.ours.long,1);
 const matches=[{date:'2026-11-27',opponent:'Гости',sets:[{ours:5,theirs:0}],detail:d},{date:'2026-11-27',opponent:' гости ',sets:[{ours:0,theirs:5}]},{date:'2026-11-27',opponent:'Другие',sets:[{ours:5,theirs:0}]}];
 const rows=opponentComparison(matches,{min:10});assert.equal(rows[0].matches,2);assert.equal(rows[0].detailed,1);assert.equal(rows[0].rate,100);assert.equal(rows[0].eligible,false);assert.equal(rows[1].rate,null);
});
test('season PRO metrics weight attempts, enforce sample and lower-is-better errors',()=>{
 const d=detailEvent(base(),event),players=d.ourPlayers,stats={};const mk=(id,date)=>({id,date,opponent:'Гости',detail:d,roster:d.roster,stats,sets:[{ours:1,theirs:0}]});
 const view={players,matches:[mk('1','2026-11-26'),mk('2','2026-11-27')]};const row=matchComparison(view,'setPositiveRate').find(r=>r.player.id===p(2));assert.equal(row.value,100);assert.equal(row.attempts,2);assert.equal(row.eligible,false);assert.equal(ranked(matchComparison(view,'setPositiveRate')).length,0);
 const err=matchComparison(view,'setErrorRate').find(r=>r.player.id===p(2));assert.equal(err.value,0);assert.equal(err.lower,true);assert.equal(matchComparison(view,'setErrorRate',{source:'manual'}).find(r=>r.player.id===p(2)).value,null);
});
