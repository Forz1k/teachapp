import test from 'node:test';
import assert from 'node:assert/strict';
import {makeRehearsal,rehearsalStore,rehearsalKey,replay} from '../js/volleyball.js';
const memory=()=>{const data=new Map([['real-data','unchanged']]);return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};
const options={short:true,id:'fixture',now:new Date('2026-11-27T12:00:00Z')};
const rally={type:'rally',side:'ours',kind:'point',player:null,captureMode:'quick'};
test('rehearsal contains two synthetic full rosters and legal starting lineups',()=>{
 const d=makeRehearsal(options);assert.equal(d.ourPlayers.length,10);assert.equal(d.awayPlayers.length,10);
 assert.equal(new Set([...d.roster,...d.awayPlayers.map(p=>p.id)]).size,20);
 assert.equal(d.target,5);assert.equal(replay(d).score.ours,0);assert.ok(!d.lineup.includes(d.libero));
});
test('rehearsal persists, rejects stale revisions, supports undo and never overwrites other storage',async()=>{
 const storage=memory(),store=rehearsalStore(storage,null);
 let d=await store.start(options);await assert.rejects(store.start(options));
 d=await store.change(d.id,d.revision,rally);
 assert.equal(replay(d).score.ours,1);assert.deepEqual(rehearsalStore(storage,null).read(),d);
 await assert.rejects(store.change(d.id,0,rally),/изменился/);
 d=await store.change(d.id,d.revision,null);assert.equal(replay(d).score.ours,0);
 await assert.rejects(store.finish(d.id,d.revision));
 await store.discard(d.id,d.revision);assert.equal(store.read(),null);
 assert.deepEqual([...storage.data],[['real-data','unchanged']]);
});
test('rehearsal can play and finish two sets with real engine and isolated report',async()=>{
 const storage=memory(),store=rehearsalStore(storage,null);
 let d=await store.start(options);
 const change=async e=>{d=await store.change(d.id,d.revision,e);};
 await change({type:'timeout',side:'ours'});assert.equal(replay(d).timeouts.ours,1);
 await change({type:'sub',side:'ours',out:d.lineup[1],in:d.roster[6]});
 assert.equal(replay(d).lineup[1],d.roster[6]);
 for(let i=0;i<5;i++)await change(rally);
 assert.equal(replay(d).setEnded,true);
 await change({type:'next',lineup:d.lineup,awayLineup:d.awayLineup,serve:'theirs'});
 for(let i=0;i<5;i++)await change(rally);
 assert.equal(replay(d).finished,true);
 const report=await store.finish(d.id,d.revision);
 assert.deepEqual(report.sets,[{ours:5,theirs:0},{ours:5,theirs:0}]);
 assert.equal(report.detail.id,d.id);assert.deepEqual(store.read(),d);
 assert.deepEqual([...storage.data.keys()].sort(),['real-data',rehearsalKey].sort());
});
test('failed storage write does not return a falsely committed draft',async()=>{
 const storage=memory(),store=rehearsalStore(storage,null);
 const d=await store.start(options);
 storage.setItem=()=>{throw Error('quota');};
 await assert.rejects(store.change(d.id,d.revision,rally),/quota/);
 assert.equal(store.read().revision,0);
});
