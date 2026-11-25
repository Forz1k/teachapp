import test from 'node:test';import assert from 'node:assert/strict';
import {opponentProfiles,trainingOverview,validateOpponentNote} from '../js/coach-opponents.js';
import {validMatchLimits,matchLimits} from '../js/match-protocol.js';
test('private opponent profiles are team scoped and group exact normalized names',()=>{
 const matches=[{teamId:'a',opponent:'Тест',date:'2026-02-01',sets:[{ours:25,theirs:20}]},{teamId:'a',opponent:' тест ',date:'2026-01-01',sets:[{ours:20,theirs:25}]},{teamId:'b',opponent:'Тест',date:'2026-02-01',sets:[{ours:25,theirs:10}]}];
 const notes=[{id:'n',kind:'opponentNote',teamId:'a',opponent:'Тест',notes:'Синтетика',updatedAt:'2026-02-01T00:00:00Z'}];
 validateOpponentNote(notes[0]);assert.throws(()=>validateOpponentNote({...notes[0],privateExtra:true}));
 const [r]=opponentProfiles('a',matches,notes);assert.equal(r.matches.length,2);assert.equal(r.wins,1);assert.equal(r.losses,1);assert.equal(r.note.notes,'Синтетика');
 assert.equal(opponentProfiles('b',matches,notes)[0].note,null);
});
test('training overview does not turn missing effort into zero',()=>{
 const v={players:[{id:'p',name:'Тест'}],trainings:[{date:'2026-01-01',title:'Тест',held:true,roster:['p'],attendance:{p:'present'}}]};
 const r=trainingOverview(v,{today:'2026-01-02'});assert.equal(r.players[0].load.total,null);assert.equal(r.players[0].load.unknown,1);
});
test('custom match limits are bounded and legacy defaults remain intact',()=>{
 assert.deepEqual(matchLimits({}),{substitutions:6,timeouts:2});assert.equal(validMatchLimits({substitutions:0,timeouts:0}),true);assert.equal(validMatchLimits({substitutions:21,timeouts:2}),false);assert.equal(validMatchLimits({substitutions:6,timeouts:1.5}),false);
});
