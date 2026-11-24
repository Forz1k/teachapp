import test from 'node:test';
import assert from 'node:assert/strict';
import {replayDetailed,detailEvent,legalSubstitutions} from '../js/match-protocol.js';
const at='2026-11-24T12:00:00.000Z';
function draft(mode='paired'){
 const players=prefix=>Array.from({length:8},(_,i)=>({id:prefix+i,name:'Игрок '+i,number:i+1}));
 const ourPlayers=players('o'),awayPlayers=players('a');
 return {mode:'dual',teamName:'Наши',opponent:'Гости',competition:'',venue:'',startedAt:at,ourPlayers,awayPlayers,roster:ourPlayers.map(p=>p.id),lineup:ourPlayers.slice(0,6).map(p=>p.id),awayLineup:awayPlayers.slice(0,6).map(p=>p.id),libero:null,bestOf:3,target:15,decider:15,firstServe:'ours',scheme:'5-1',events:[],...(mode===null?{}:{substitutionMode:mode})};
}
const sub=(d,side,out,incoming)=>detailEvent(d,{type:'sub',side,out,in:incoming},at);
test('paired substitutions permit only original reserve and return once per set',()=>{
 let d=draft();
 d=sub(d,'ours','o0','o6');
 assert.deepEqual(legalSubstitutions(d,replayDetailed(d),'ours','o6').map(p=>p.id),['o0']);
 assert.throws(()=>sub(d,'ours','o6','o7'),/Парная замена/);
 d=sub(d,'ours','o6','o0');
 assert.throws(()=>sub(d,'ours','o0','o7'),/Парная замена/);
 assert.throws(()=>sub(d,'ours','o1','o6'),/Парная замена/);
 d=sub(d,'theirs','a0','a6');
 assert.throws(()=>sub(d,'theirs','a6','a7'),/Парная замена/);
 let undo=detailEvent(d,null,at);
 assert.deepEqual(legalSubstitutions(undo,replayDetailed(undo),'theirs','a0').map(p=>p.id),['a6','a7']);
 for(let i=0;i<15;i++)d=detailEvent(d,{type:'rally',side:'ours',kind:'point',player:null},at);
 d=detailEvent(d,{type:'next',lineup:d.lineup,awayLineup:d.awayLineup,serve:'theirs'},at);
 assert.doesNotThrow(()=>sub(d,'ours','o0','o6'));
});
test('legacy simple match replay remains compatible',()=>{
 let d=draft(null);
 d=sub(d,'ours','o0','o6');
 assert.doesNotThrow(()=>sub(d,'ours','o6','o7'));
 assert.throws(()=>replayDetailed({...d,substitutionMode:'unknown'}));
});
