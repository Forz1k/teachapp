import test from 'node:test';import assert from 'node:assert/strict';
import {importedVideoMarkers,validateVideoReview,videoMarkers,calibratedMarkers} from '../js/video-review.js';
import {parseVolleyRows,buildVolleyImport} from '../js/volleypoint-import.js';
import {timingRows} from './fixtures/volleypoint-timing-fixture.mjs';
const report=parseVolleyRows(timingRows),m=buildVolleyImport(report,0,Object.fromEntries(report.teams[0].players.map(p=>[p.number,'p'+p.number])));
test('Imported video: no fabricated timestamps; manually linked events only, filters preserve original rally index',()=>{
 const a=importedVideoMarkers(m,[],{players:[{id:'p1',name:'Synthetic'}]});assert.equal(a.length,8);assert.ok(a.every(x=>x.seconds===null));assert.equal(a[0].player,'Synthetic');assert.equal(a[1].player,'Автор не сохранён');assert.equal(a[0].kind,'ace');assert.equal(a[6].kind,'serveError');
 const anchors=[{index:1,seconds:10},{index:5,seconds:90},{index:8,seconds:170}];
 const b=importedVideoMarkers(m,anchors,{duration:100});assert.deepEqual(b.map(x=>x.seconds),[10,null,null,null,90,null,null,170]);assert.equal(b[7].outsideVideo,true);
 const c=importedVideoMarkers(m,anchors,{set:2,side:'ours'});assert.deepEqual(c.map(x=>x.index),[6,7]);assert.ok(c.every(x=>x.seconds===null));
 assert.deepEqual(importedVideoMarkers(m,anchors,{playerId:'p1'}).map(x=>x.index),[1,6]);
 assert.throws(()=>importedVideoMarkers(m,[{index:9,seconds:4}]),/отсутствует/);assert.throws(()=>importedVideoMarkers(m,[{index:2,seconds:30},{index:3,seconds:20}]),/возрастать/);
 assert.throws(()=>validateVideoReview({kind:'videoReview',id:'a',matchId:'m',anchors,notes:[],file:'private'}));
});
