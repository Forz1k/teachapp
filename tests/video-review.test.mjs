import test from 'node:test';import assert from 'node:assert/strict';import {videoMarkers} from '../js/video-review.js';
const roster=Array.from({length:6},(_,i)=>({id:'p'+i,name:'P'+i,number:i+1}));
const detail={mode:'dual',teamName:'A',opponent:'B',competition:'',venue:'',startedAt:'2026-01-01T10:00:00Z',ourPlayers:roster,awayPlayers:[],roster:roster.map(x=>x.id),lineup:roster.map(x=>x.id),awayLineup:[],libero:null,bestOf:3,target:25,decider:15,firstServe:'ours',scheme:'5-1',events:[{type:'rally',at:'2026-01-01T10:00:10Z',side:'ours',kind:'ace',player:'p0'},{type:'rally',at:'2026-01-01T10:00:25Z',side:'ours',kind:'kill',player:'p1'}]};
test('video markers preserve rally times, alignment and filters',()=>{assert.deepEqual(videoMarkers(detail,20).map(x=>x.seconds),[20,35]);assert.equal(videoMarkers(detail,20,{kind:'kill'})[0].player,'P1');assert.equal(videoMarkers(detail,20,{duration:30}).length,1);assert.throws(()=>videoMarkers(detail,-1));});
test('Time stepping clamps to local media bounds and rejects missing duration',async()=>{
 const {videoSeekStep,videoReviewRates}=await import('../js/video-review.js');
 assert.equal(videoSeekStep(.05,10,-.1),0);assert.equal(videoSeekStep(9.95,10,.1),10);
 assert.equal(videoSeekStep(5,10,1),6);assert.ok(videoReviewRates.includes(.25));
 for(const a of [[0,NaN,1],[1,0,1],[20,10,1],[1,10,31]])assert.throws(()=>videoSeekStep(...a));
});

test('A/B playback loops only during play or at media end, and validates independent range',async()=>{
 const {videoLoopRange,videoLoopSeek}=await import('../js/video-review.js'),r=videoLoopRange(5,15,20);
 assert.deepEqual(r,{start:5,end:15});assert.equal(videoLoopSeek(r,15,20,{playing:true}),5);assert.equal(videoLoopSeek(r,3,20,{playing:true}),5);assert.equal(videoLoopSeek(r,10,20,{playing:true}),null);assert.equal(videoLoopSeek(r,15,20),null);assert.equal(videoLoopSeek(r,20,20,{ended:true}),5);assert.equal(videoLoopSeek(null,20,20,{ended:true}),null);assert.equal(videoLoopSeek(r,15,12,{playing:true}),null);
 for(const args of [[0,.1,20],[0,121,130],[1,21,20],[-1,4,20],[0,5,NaN]])assert.throws(()=>videoLoopRange(...args));
});
