import test from 'node:test';import assert from 'node:assert/strict';
import {makeRehearsal} from '../js/volleyball.js';
import {detailEvent,replayDetailed,previewRallyCorrection,legalLiberoActions,legalSubstitutions} from '../js/match-protocol.js';
const base=()=>makeRehearsal({short:true,id:'controls',now:new Date('2026-11-27T12:00:00Z')});
const rally=(side='ours',kind='point',player=null,assist)=>({type:'rally',side,kind,player,...(assist?{assist}:{})});
test('historical winner correction replays scores and lineups; only selected rally loses attribution',()=>{
 let d=detailEvent(base(),rally('ours','kill','test-a-1','test-a-2'));d=detailEvent(d,rally('ours'));
 const original=structuredClone(d),{draft,before,after}=previewRallyCorrection(d,0,'theirs');
 assert.deepEqual(d,original);assert.deepEqual(before.score,{ours:2,theirs:0});assert.deepEqual(after.score,{ours:1,theirs:1});
 assert.deepEqual(draft.events[1],d.events[1]);assert.equal(draft.events[0].at,d.events[0].at);assert.equal(draft.events[0].kind,'point');assert.equal(draft.events[0].assist,undefined);assert.equal(after.sides.ours.stats['test-a-2'],undefined);
 const changed=detailEvent(d,{type:'correctRally',index:0,side:'theirs'});assert.deepEqual(changed,draft);assert.notDeepEqual(after.lineup,before.lineup);
});
test('incompatible downstream serve or set boundary rejects correction atomically',()=>{
 let d=detailEvent(base(),rally());d=detailEvent(d,rally('ours','ace','test-a-1'));const old=structuredClone(d);
 assert.throws(()=>previewRallyCorrection(d,0,'theirs'),/несовместимо/);assert.deepEqual(d,old);
 let finished=base();for(let i=0;i<5;i++)finished=detailEvent(finished,rally());finished=detailEvent(finished,{type:'next',lineup:finished.lineup,awayLineup:finished.awayLineup,serve:'theirs'});
 assert.throws(()=>detailEvent(finished,{type:'correctRally',index:0,side:'theirs'}),/несовместимо/);
});
test('libero panel exposes only legal zones and distinct return/switch actions',()=>{
 let d=base(),s=replayDetailed(d);const actions=legalLiberoActions(d,s);
 assert.equal(actions.length,4);assert.ok(actions.every(x=>[5,6].includes(x.zone)&&!x.exception));
 d=detailEvent(d,actions[0].event);s=replayDetailed(d);const active=legalLiberoActions(d,s);
 assert.equal(active.length,2);assert.ok(active.every(x=>x.exception));assert.equal(active[0].event.for,null);
 assert.throws(()=>detailEvent(d,active[0].event),/розыгрыш/);d=detailEvent(d,rally());s=replayDetailed(d);assert.ok(legalLiberoActions(d,s).every(x=>!x.exception));
});
test('quick paired substitutions show return only, never liberos or exhausted starters',()=>{
 let d=base(),s=replayDetailed(d);const out='test-a-1',incoming='test-a-7';assert.deepEqual(legalSubstitutions(d,s,'ours',out).map(x=>x.id),['test-a-7','test-a-8']);
 d=detailEvent(d,{type:'sub',side:'ours',out,in:incoming});s=replayDetailed(d);assert.deepEqual(legalSubstitutions(d,s,'ours',incoming).map(x=>x.id),[out]);
 d=detailEvent(d,{type:'sub',side:'ours',out:incoming,in:out});assert.deepEqual(legalSubstitutions(d,replayDetailed(d),'ours',out),[]);
});
