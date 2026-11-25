import test from 'node:test';import assert from 'node:assert/strict';
import {opponentProfiles,trainingOverview,validateOpponentNote,preMatchDossier} from '../js/coach-opponents.js';
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

test('Pre-match dossier uses exact team/opponent, bounded past history and actual load, not future or foreign data',()=>{
 const teamId='a',player={id:'p',teamId,name:'P',archived:false,restrictions:[{activityId:'jump',dateFrom:'2026-02-02',dateTo:'2026-02-04',type:'avoid'}]},m={teamId,opponent:'Тест',date:'2026-02-01',sets:[{ours:25,theirs:20}]};
 const view={matches:[m,{...m,date:'2026-02-02'},{...m,teamId:'b'},{...m,opponent:'Тест 2'}],players:[player,{...player,id:'x',teamId:'b'},{...player,id:'arch',archived:true}],trainings:[{teamId,date:'2026-02-01',title:'A',held:true,roster:['p'],attendance:{p:'present'},effort:{p:{minutes:30,rpe:5}}},{teamId,date:'2026-02-01',title:'B',held:true,roster:['p'],attendance:{p:'limited'}},{teamId,date:'2026-02-02',title:'future',held:true,roster:['p'],attendance:{p:'present'}}],tests:[]};
 const before=structuredClone(view),notes=[{teamId:'b',opponent:'Тест',notes:'Foreign',updatedAt:'2026-02-01T00:00:00Z'},{teamId,opponent:' тест ',notes:'Private',updatedAt:'2026-02-01T00:00:00Z'}];
 const a=preMatchDossier(teamId,view,{opponent:' тест ',date:'2026-02-02',today:'2026-02-02',notes});
 assert.equal(a.history.length,1);assert.equal(a.totals.wins,1);assert.equal(a.totals.detailed,0);assert.equal(a.totals.rallies,0);assert.equal(a.note.notes,'Private');
 assert.equal(a.roster.length,1);assert.equal(a.roster[0].restrictions.length,1);assert.equal(a.roster[0].load.total,150);assert.equal(a.roster[0].load.unknown,1);
 assert.equal(a.roster[0].attendance.present,1);assert.deepEqual(view,before);
 assert.equal(preMatchDossier(teamId,view,{opponent:'New',date:'2026-02-10',today:'2026-02-02'}).history.length,0);
 assert.throws(()=>preMatchDossier(teamId,view,{opponent:'Test',date:'2026-02-30'}));
});
