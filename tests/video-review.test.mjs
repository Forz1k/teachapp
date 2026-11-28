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

test('Adjacent marker navigation uses filtered valid timestamps, skips current marker and does not wrap',async()=>{
 const {adjacentVideoMarker}=await import('../js/video-review.js');
 const markers=[{index:7,seconds:15,alignment:'interpolated'},{index:2,seconds:5,alignment:'manual'},{index:3,seconds:null,alignment:'unlinked'},{index:4,seconds:10,alignment:'manual'},{index:5,seconds:10,alignment:'manual'},{index:8,seconds:30,alignment:'manual',outsideVideo:true},{index:9,seconds:12,alignment:'unlinked'}];
 assert.equal(adjacentVideoMarker(markers,0,20,1).index,2);
 assert.equal(adjacentVideoMarker(markers,5.01,20,1).index,4);
 assert.equal(adjacentVideoMarker(markers,15,20,-1).index,4);
 assert.equal(adjacentVideoMarker(markers,10,20,-1).index,2);
 assert.equal(adjacentVideoMarker(markers,15,20,1),null);
 assert.equal(adjacentVideoMarker(markers,0,20,-1),null);
 assert.equal(adjacentVideoMarker(markers,0,NaN,1),null);
 assert.equal(adjacentVideoMarker(markers,0,20,0),null);
 assert.equal(adjacentVideoMarker(markers.filter(m=>m.index===7),0,20,1).index,7);
});

test('Indexed playback navigation is equivalent to linear reference across ties, boundaries and large marker lists',async()=>{
 const {adjacentVideoMarker,createVideoMarkerIndex}=await import('../js/video-review.js');
 const markers=Array.from({length:12000},(_,i)=>({index:i+1,seconds:(i*73%5000)/10,alignment:i%19===0?'unlinked':'manual',outsideVideo:i%23===0}));
 markers.push({index:15000,seconds:10,alignment:'manual'},{index:15001,seconds:null,alignment:'unlinked'});
 const index=createVideoMarkerIndex(markers);
 for(const duration of [0,10,35,100,499.9,600,NaN]){
  assert.equal(index.count(duration),Number.isFinite(duration)&&duration>=0?markers.filter(m=>!m.outsideVideo&&m.alignment!=='unlinked'&&Number.isFinite(m.seconds)&&m.seconds<=duration).length:0);
  for(const current of [0,.05,5,9.95,10,10.05,25.01,100,499.9,NaN])for(const dir of [-1,1])assert.deepEqual(index.adjacent(current,duration,dir),adjacentVideoMarker(markers,current,duration,dir));
 }
 const source=[{index:1,seconds:2,alignment:'manual'},{index:2,seconds:2,alignment:'manual'}],cached=createVideoMarkerIndex(source);
 source[0].seconds=100;const returned=cached.adjacent(0,5,1);assert.equal(returned.index,1);returned.seconds=200;assert.equal(cached.adjacent(0,5,1).seconds,2);
});

test('Review summary and CSV retain filtered provenance, omit private fields by default and never invent PDF times',async()=>{
 const {summarizeVideoReview,videoReviewCsv}=await import('../js/video-review.js');
 const rows=[{index:1,set:1,score:'1:0',side:'ours',label:'Эйс',alignment:'manual',seconds:5.125,player:'PRIVATE PLAYER',playerId:'secret-id'},{index:2,set:1,score:'1:1',side:'theirs',label:'Ошибка',alignment:'unlinked',seconds:null,player:'PRIVATE PLAYER'},{index:3,set:2,score:'0:1',side:'theirs',label:'Атака',alignment:'interpolated',seconds:90,outsideVideo:true}];
 const notes=[{index:2,favorite:true,text:'PRIVATE NOTE'},{index:99,favorite:true,text:'NOT IN FILTER'}];
 assert.deepEqual(summarizeVideoReview(rows,notes),{total:3,manual:1,estimated:1,unlinked:1,outsideVideo:1,favorites:1});
 const csv=videoReviewCsv(rows,notes);assert.ok(csv.startsWith('\ufeff'));assert.match(csv,/"5,125";"Ручная точка"/);assert.match(csv,/"Ошибка";"";"Без привязки";"Нет";"Да"/);assert.match(csv,/"Интерполяция";"Да"/);
 assert.doesNotMatch(csv,/PRIVATE|secret-id|NOT IN FILTER/);
 const privateCsv=videoReviewCsv(rows,notes,{includePrivate:true});assert.match(privateCsv,/PRIVATE PLAYER/);assert.match(privateCsv,/PRIVATE NOTE/);assert.doesNotMatch(privateCsv,/secret-id|NOT IN FILTER/);
 assert.throws(()=>videoReviewCsv([...rows,rows[0]],notes));assert.throws(()=>videoReviewCsv([{...rows[1],seconds:0}],notes));
});
test('Review CSV escapes spreadsheet formulas and multiline private text, handles all filtered rows beyond page limit',async()=>{
 const {videoReviewCsv}=await import('../js/video-review.js');
 const rows=Array.from({length:250},(_,i)=>({index:i+1,set:1,score:'1:0',side:'ours',label:'Эйс',alignment:'recorded',seconds:i,player:'  =SUM(1;2)'}));
 const csv=videoReviewCsv(rows,[{index:1,text:'@formula',favorite:true},{index:250,text:'line "one"\nline two',favorite:false}],{includePrivate:true});
 assert.ok(csv.includes('"\'  =SUM(1;2)"'));assert.ok(csv.includes('"\'@formula"'));assert.ok(csv.includes('"line ""one""\nline two"'));assert.match(csv,/"250";"1"/);
});

test('Prepared video review projection filters provenance and notes without re-reading match evidence',async()=>{
 const {projectVideoMarkers,calibratedMarkers,importedVideoMarkers,videoReviewBySet}=await import('../js/video-review.js');
 const base=videoMarkers(detail,0),anchors=[{index:1,seconds:10},{index:2,seconds:25}],notes=[{index:2,text:'Private note',favorite:true}];
 assert.deepEqual(projectVideoMarkers(base,{firstAt:20}),videoMarkers(detail,20));
 assert.deepEqual(projectVideoMarkers(base,{anchors}),calibratedMarkers(detail,anchors));
 assert.equal(projectVideoMarkers(base,{anchors,onlyNotes:true,notes})[0].index,2);
 assert.equal(projectVideoMarkers(base,{anchors,provenance:'estimated'}).length,0);
 assert.deepEqual(projectVideoMarkers(base,{provenance:'estimated'}),base);
 const pdf={imported:{rallies:[{set:1,ours:1,theirs:0,kind:'aces',winner:'ours'},{set:2,ours:0,theirs:1,kind:'unknown',winner:'theirs'},{set:2,ours:1,theirs:1,kind:'unknown',winner:'ours'}]}};
 const raw=importedVideoMarkers(pdf),points=[{index:1,seconds:2},{index:3,seconds:25}];
 assert.deepEqual(projectVideoMarkers(raw,{imported:true,anchors:points,duration:10}),importedVideoMarkers(pdf,points,{duration:10}));
 assert.deepEqual(projectVideoMarkers(raw,{imported:true,anchors:points,provenance:'unlinked'}).map(m=>[m.index,m.seconds]),[[2,null]]);
 assert.deepEqual(projectVideoMarkers(raw,{imported:true,anchors:points,onlyLinked:true,duration:10}).map(m=>m.index),[1]);
 const groups=videoReviewBySet(projectVideoMarkers(raw,{imported:true,anchors:points,duration:10}),notes);
 assert.deepEqual(groups.map(s=>[s.set,s.total,s.manual,s.unlinked,s.outsideVideo,s.ours,s.theirs]),[[1,1,1,0,0,1,0],[2,2,1,1,1,1,1]]);
 assert.equal(raw[1].seconds,null);assert.throws(()=>projectVideoMarkers(raw,{imported:true,anchors:[{index:4,seconds:1}]}));
});
