import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';
import * as S from '../js/store.js';
import * as C from '../js/coach.js';
import * as W from '../js/workbench.js';
import {BACKUP_VERSION} from '../js/backup.js';
import {initialMarkers,saveBoard,validateBoard,lineupOptions} from '../js/tactics.js';
test('Помощник состава: разные игроки, амплуа, ограничения и универсальная замена',()=>{
 const positions=['setter','outside','middle','opposite','outside','middle','libero','universal'];
 const players=positions.map((position,i)=>({id:'p'+i,name:'Игрок '+i,position,restrictions:i===1?[{activityId:'pass',type:'avoid',dateFrom:'2026-01-01',dateTo:null}]:[]}));
 const view={players,matches:[],tests:[]},r=lineupOptions(view,{date:'2026-11-24'});
 assert.deepEqual(r.excluded,['p1']);assert.ok(r.options.length);
 assert.equal(new Set(r.options[0].ids).size,6);assert.equal(r.options[0].exact,5);assert.equal(r.options[0].known,0);assert.ok(r.options[0].ids.includes('p7'));assert.deepEqual(r.liberos,['p6']);
 assert.equal(lineupOptions(view,{scheme:'4-2',date:'2026-11-24',selected:['p0','p2','p3']}).options.length,0);
});
test('Доска: снимок в конспекте, независимость от оригинала и проверка координат',async()=>{
 await db.clearAll();await S.load();const team=await C.saveTeam({name:'Команда'});
 const board=await saveBoard({kind:'tacticBoard',teamId:team.id,name:'Приём',note:'',markers:initialMarkers(),arrows:[{id:'a',style:'move',from:{x:50,y:500},to:{x:150,y:350}}],revision:0});
 assert.throws(()=>validateBoard({...board,markers:[{...board.markers[0],x:1000}]}));
 const plan=await W.saveWork({kind:'plan',name:'Тренировка',context:'coach',minutes:45,goal:'',equipment:'',audience:'',items:[{phase:'intro',exercise:W.builtinExercises[0],minutes:5,notes:''}],tactics:[board]});
 await saveBoard({...board,name:'Изменено'});await W.deleteWork(board.id,'tacticBoard');
 assert.equal((await W.listWork('plan'))[0].tactics[0].name,'Приём');
 const backup=await S.makeBackup();assert.equal(backup.version,BACKUP_VERSION);await S.restoreBackup(backup);assert.equal((await W.listWork('plan'))[0].tactics.length,1);
 const broken=structuredClone(backup);broken.data.workRecords.find(r=>r.id===plan.id).tactics[0].arrows[0].to.x=999;await assert.rejects(S.restoreBackup(broken));
});

test('Lineup opponent filter changes history coverage, not available players',()=>{
 const players=['setter','outside','middle','opposite','outside','middle'].map((position,i)=>({id:'p'+i,name:'Игрок '+i,position,restrictions:[]}));
 const view={players,tests:[],matches:[{opponent:'А',date:'2026-11-01',sets:[{ours:25,theirs:10}]},{opponent:'Б',date:'2026-11-02',sets:[{ours:20,theirs:25}]}]};
 const r=lineupOptions(view,{date:'2026-11-24',opponent:'а'});assert.equal(r.matchEvidence.total,1);assert.equal(r.matchEvidence.detailed,0);assert.equal(r.available,6);assert.equal(r.options.length,1);
});
