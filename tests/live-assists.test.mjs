import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRehearsal,replay,appendEvent,undoEvent} from '../js/volleyball.js';
import {rallySummary} from '../js/match-protocol.js';
import {matchAssistCounts,assistTotals} from '../js/coach.js';
import {matchComparison,ranked} from '../js/coach-season.js';
const fixture=()=>makeRehearsal({short:true,id:'assist',now:new Date('2026-11-27T12:00:00Z')});
const point={type:'rally',side:'ours',kind:'kill',player:'test-a-1',assist:'test-a-2'};
test('one team point, separate attacker and passer, undo and set summary',()=>{
 const d=appendEvent(fixture(),point),s=replay(d);
 assert.equal(s.score.ours,1);assert.equal(s.stats['test-a-1'].points,1);assert.equal(s.sides.ours.stats['test-a-2'].assists,1);
 assert.equal(rallySummary(s.timeline,1).ours.stats['test-a-2'].assists,1);
 assert.equal(s.stats['test-a-2'],undefined);
 assert.equal(replay(undoEvent(d)).sides.ours.stats['test-a-2'],undefined);
});
test('assist validates team, on-court player, distinct author and attack result',()=>{
 for(const patch of [{assist:'test-a-1'},{assist:'test-a-7'},{assist:'test-b-2'},{kind:'ace'},{player:null}])assert.throws(()=>appendEvent(fixture(),{...point,...patch}),/Ассист/);
 const away=appendEvent(fixture(),{type:'rally',side:'theirs',kind:'tip',player:'test-b-2',assist:'test-b-1'});
 assert.equal(replay(away).sides.theirs.stats['test-b-1'].assists,1);
});
test('editing and reattribution clear or change the assist without changing score',()=>{
 let d=appendEvent(fixture(),point);
 d=appendEvent(d,{type:'editRally',index:0,patch:{assist:'test-a-3'}});
 assert.equal(replay(d).sides.ours.stats['test-a-3'].assists,1);
 d=appendEvent(d,{type:'attribute',kind:'block',player:'test-a-2'});
 assert.equal(d.events[0].assist,undefined);assert.equal(replay(d).score.ours,1);
});
test('season rankings count explicit assists only and contribution never becomes team score',()=>{
 const d=appendEvent(fixture(),point),m={date:'2026-11-27',opponent:'test',roster:d.roster,stats:replay(d).stats,detail:d};
 const old={...m,detail:undefined,stats:{'test-a-1':{points:3}}};
 assert.equal(matchAssistCounts(m).get('test-a-2'),1);
 assert.deepEqual(assistTotals([m,old],'test-a-2'),{assists:1,points:null,recorded:1,contribution:1});
 const view={players:d.ourPlayers,matches:[m,old]};
 assert.equal(ranked(matchComparison(view,'assists'))[0].player.id,'test-a-2');
 assert.equal(ranked(matchComparison(view,'contribution'))[0].value,4);
 assert.equal(assistTotals([old],'test-a-2').assists,null);
});

test('legacy result keys and order remain identical with or without assists',()=>{
 let d=appendEvent(fixture(),point);
 d=appendEvent(d,{type:'rally',side:'ours',kind:'kill',player:'test-a-3'});
 d=appendEvent(d,{type:'rally',side:'ours',kind:'kill',player:'test-a-2'});
 const legacy={...d,events:d.events.map(({assist,...event})=>event)};
 assert.equal(JSON.stringify(replay(d).stats),JSON.stringify(replay(legacy).stats));
});
