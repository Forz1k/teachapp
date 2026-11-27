import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';
import * as C from '../js/coach.js';import * as db from '../js/db.js';import {todayIso} from '../js/model.js';
import {makeRehearsal,rememberLive,readLiveResume,clearLiveResume} from '../js/volleyball.js';
test('tab resume is a pointer only, invalid values and stale close cannot erase new navigation',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const d=makeRehearsal(),a=rememberLive(d,true,storage),b=rememberLive(d,true,storage);
 assert.equal(readLiveResume(storage).id,d.id);assert.ok(!JSON.stringify(readLiveResume(storage)).includes('events'));
 clearLiveResume(a,storage);assert.deepEqual(readLiveResume(storage),b);clearLiveResume(b,storage);assert.equal(readLiveResume(storage),null);
 assert.equal(readLiveResume({getItem:()=>'{broken'}),null);assert.equal(rememberLive(d,true,{setItem:()=>{throw Error('quota');}}),null);
});
test('readback and atomic revision guard reject duplicate score across concurrent writers',async()=>{
 await db.clearAll();const team=await C.saveTeam({name:'Synthetic'}),players=[];
 for(let i=0;i<6;i++)players.push(await C.savePlayer({teamId:team.id,name:'Synthetic '+i,number:i+1,position:'universal'}));
 const roster=players.map(p=>p.id);
 const d=await C.startDetailedMatch({teamId:team.id,date:todayIso(),teamName:team.name,opponent:'Other',ourPlayers:players,awayPlayers:[],roster,lineup:roster,awayLineup:[],libero:null,scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'ours'});
 const before=JSON.stringify(await C.loadCoach());assert.equal(await C.probeLiveStorage(),true);assert.equal(JSON.stringify(await C.loadCoach()),before);
 const e={type:'rally',side:'ours',kind:'kill',player:roster[0],assist:roster[1]};
 const results=await Promise.allSettled([C.changeLiveMatch(d.id,d.revision,e),C.changeLiveMatch(d.id,d.revision,e)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
 const current=await C.readLiveMatch(d.id);assert.equal(current.revision,1);assert.equal(current.events.length,1);assert.equal(current.events[0].assist,roster[1]);
 assert.equal((await C.listLiveMatches()).length,1);
});
