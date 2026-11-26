import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';
import {saveVideoReview,listWork,saveWork} from '../js/workbench.js';
import {videoMarkers,calibratedMarkers,importedVideoMarkers} from '../js/video-review.js';
const roster=Array.from({length:6},(_,i)=>({id:'p'+i,name:'Synthetic '+i,number:i+1}));
const detail={mode:'dual',teamName:'A',opponent:'B',competition:'',venue:'',startedAt:'2026-01-01T10:00:00Z',ourPlayers:roster,awayPlayers:[],roster:roster.map(x=>x.id),lineup:roster.map(x=>x.id),awayLineup:[],libero:null,bestOf:3,target:25,decider:15,firstServe:'ours',scheme:'5-1',events:Array.from({length:5},(_,i)=>({type:'rally',at:'2026-01-01T10:00:'+String(i*10+10).padStart(2,'0')+'Z',side:'ours',kind:'ace',player:'p0'}))};
const imported={id:'imported-review-fixture',imported:{rallies:[{set:1,ours:1,theirs:0,kind:'aces',winner:'ours',playerId:'p0'},{set:1,ours:2,theirs:0,kind:'attackKills',winner:'ours',playerId:'p0'}]}};
test('Video marker provenance distinguishes manual anchors, interpolation, extrapolation and unlinked imports',()=>{
 assert.ok(videoMarkers(detail,10).every(m=>m.alignment==='recorded'));
 const m=calibratedMarkers(detail,[{index:2,seconds:20},{index:4,seconds:60}]);
 assert.deepEqual(m.map(x=>x.alignment),['extrapolated','manual','interpolated','manual','extrapolated']);
 assert.deepEqual(m.map(x=>x.seconds),[10,20,40,60,70]);
 assert.deepEqual(importedVideoMarkers(imported,[{index:1,seconds:10}]).map(m=>[m.alignment,m.seconds]),[['manual',10],['unlinked',null]]);
});
test('Video review compare-and-save protects against two-tab lost updates and duplicate creation',async()=>{
 await db.clearAll();await db.put('coachMatches',imported);
 const input={kind:'videoReview',matchId:imported.id,anchors:[],notes:[]};
 const competing=await Promise.allSettled([saveVideoReview(input,null),saveVideoReview(input,null)]);
 assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);assert.equal(competing.filter(x=>x.status==='rejected').length,1);
 const [base]=await listWork('videoReview');
 const first=await saveVideoReview({...base,notes:[{index:1,text:'First note',favorite:false}]},base);
 await assert.rejects(saveVideoReview({...base,anchors:[{index:2,seconds:3}]},base),/изменился/);
 assert.deepEqual((await listWork('videoReview'))[0],first);
 await assert.rejects(saveVideoReview({...first,notes:[{index:3,text:'Invalid',favorite:false}]},first),/Розыгрыш отсутствует/);
 await assert.rejects(saveVideoReview({...first,anchors:[{index:3,seconds:1}]},first),/Розыгрыш отсутствует/);
 assert.deepEqual((await listWork('videoReview'))[0],first);
 await saveWork(input); // legacy duplicate: UI must refuse rather than choose one arbitrarily
 await assert.rejects(saveVideoReview(first,first),/дубликаты/);
 assert.equal((await listWork('videoReview')).length,2);
});
test('Missing match cannot receive an orphan video review',async()=>{
 await assert.rejects(saveVideoReview({kind:'videoReview',matchId:'missing-fixture',anchors:[],notes:[]},null),/Протокол матча недоступен/);
});
