import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/db.js';
import * as C from '../js/coach.js';
import {todayIso} from '../js/model.js';
import {replay} from '../js/volleyball.js';

const player=(id,teamId,number)=>({id,teamId,name:'Synthetic '+id,number,position:'universal',archived:false,restrictions:[]});
async function fixture(){
 await D.clearAll();
 const teams=[{id:'a',name:'Synthetic A',archived:false},{id:'b',name:'Synthetic B',archived:false}];
 const players=teams.flatMap(t=>Array.from({length:6},(_,i)=>player(t.id+i,t.id,i+1)));
 const roster=players.filter(p=>p.teamId==='a'),ids=roster.map(p=>p.id),other=players.filter(p=>p.teamId==='b').map(p=>p.id);
 const matches=Array.from({length:1200},(_,i)=>({id:'arch'+i,teamId:i%2?'a':'b',date:todayIso(),opponent:'Synthetic archive',competition:'',sets:[{ours:25,theirs:10}],roster:i%2?ids:other,stats:{}}));
 await D.bulkPut('coachTeams',teams);await D.bulkPut('coachPlayers',players);await D.bulkPut('coachMatches',matches);
 const input={teamId:'a',teamName:teams[0].name,date:todayIso(),opponent:'Synthetic guests',competition:'',venue:'',roster:ids,ourPlayers:roster,awayPlayers:[],lineup:ids,awayLineup:[],libero:null,scheme:'5-1',bestOf:1,target:3,decider:3,regulation:{name:'Synthetic short',winBy:2,pointCap:null,liberoInterval:'oneRally',ends:'manual',deciderSwitchAt:2},firstServe:'ours',liveTiming:true,ourSide:'right'};
 return {input,matches};
}
const point={type:'rally',side:'ours',kind:'point'};
test('LIVE start and finish read only exact draft/team and indexed players, not any archive, and preserve results',async()=>{
 const {input,matches}=await fixture(),all=[],index=[],gets=[];
 const oldAll=IDBObjectStore.prototype.getAll,oldIndex=IDBIndex.prototype.getAll,oldGet=IDBObjectStore.prototype.get;
 IDBObjectStore.prototype.getAll=function(...a){all.push(this.name);return oldAll.apply(this,a);};
 IDBIndex.prototype.getAll=function(...a){index.push([this.objectStore.name,this.name,a[0]]);return oldIndex.apply(this,a);};
 IDBObjectStore.prototype.get=function(...a){gets.push([this.name,a[0]]);return oldGet.apply(this,a);};
 let match,d;
 try{
  d=await C.startDetailedMatch(input);
  await assert.rejects(C.finishLiveMatch(d.id,d.revision),/Сначала завершите/);
  for(let n=0;n<3;n++)d=await C.changeLiveMatch(d.id,d.revision,point);
  assert.equal(replay(d).finished,true);
  const settled=await Promise.allSettled([C.finishLiveMatch(d.id,d.revision),C.finishLiveMatch(d.id,d.revision)]);
  assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
  match=settled.find(x=>x.status==='fulfilled').value;
  assert.equal(all.length,0);assert.deepEqual(index,[['coachPlayers','teamId','a'],['coachPlayers','teamId','a']]);
  assert.ok(gets.every(([name])=>['coachTeams','coachLive'].includes(name)));
 }finally{IDBObjectStore.prototype.getAll=oldAll;IDBIndex.prototype.getAll=oldIndex;IDBObjectStore.prototype.get=oldGet;}
 assert.equal(await D.get('coachLive',d.id),undefined);
 assert.deepEqual(match.sets,[{ours:3,theirs:0}]);assert.deepEqual(match.detail,d);
 const stored=await D.getAll('coachMatches');assert.equal(stored.length,matches.length+1);
 assert.deepEqual(stored.filter(m=>m.id!==match.id),matches.slice().sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0));
 C.validateCoachData(await C.loadCoach());
});
test('LIVE scoped write rejects missing or cross-team/archived roster, stale revision and corrupt affected links; failure keeps draft',async()=>{
 const {input}=await fixture();
 const mixed={...input,roster:[...input.roster.slice(0,5),'b0'],lineup:[...input.lineup.slice(0,5),'b0']};
 await assert.rejects(C.startDetailedMatch(mixed),/Состав изменился/);
 await D.put('coachPlayers',{...(await D.get('coachPlayers','a0')),archived:true});
 await assert.rejects(C.startDetailedMatch(input),/Состав изменился/);
 await D.put('coachPlayers',{...(await D.get('coachPlayers','a0')),archived:false});
 let d=await C.startLiveMatch({...input,bestOf:3,target:15,decider:15});for(let set=0;set<2;set++){for(let n=0;n<15;n++)d=await C.changeLiveMatch(d.id,d.revision,point);if(set===0)d=await C.changeLiveMatch(d.id,d.revision,{type:'next',lineup:input.lineup,serve:'ours'});}
 await assert.rejects(C.finishLiveMatch(d.id,d.revision-1),/Матч изменился/);
 await D.del('coachPlayers','a0');
 await assert.rejects(C.finishLiveMatch(d.id,d.revision));
 assert.deepEqual(await D.get('coachLive',d.id),d);assert.equal((await D.getAll('coachMatches')).length,1200);
 await D.put('coachPlayers',player('a0','a',1));
 const m=await C.finishLiveMatch(d.id,d.revision);assert.deepEqual(m.sets,[{ours:15,theirs:0},{ours:15,theirs:0}]);assert.equal(m.detail,undefined);
});
