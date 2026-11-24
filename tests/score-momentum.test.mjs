import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreMomentum} from '../js/match-tactics.js';

function sequence(s){const out=[{ours:0,theirs:0}];for(const side of s){const last=out.at(-1);out.push({...last,[side==='O'?'ours':'theirs']:last[side==='O'?'ours':'theirs']+1});}return out;}
test('ties do not count as new leaders, streaks reset and empty late sample is unknown',()=>{
 const m=scoreMomentum(sequence('OOTTTOTO'),25);
 assert.equal(m.ties,3);assert.equal(m.leadChanges,1);assert.equal(m.maxOurRun,2);assert.equal(m.maxTheirRun,3);
 assert.equal(m.closeTotal,0);assert.equal(m.closeRate,null);
});
test('late close rallies use score before rally and actual denominator',()=>{
 const m=scoreMomentum(sequence('OT'.repeat(10)+'OOT'),15);
 assert.equal(m.closeTotal,4);assert.equal(m.closeWon,2);assert.equal(m.closeRate,50);
 assert.throws(()=>scoreMomentum([{ours:0,theirs:0},{ours:2,theirs:0}],15));
});
