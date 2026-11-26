import test from 'node:test';
import assert from 'node:assert/strict';
import {journalNavigation,journalRectangle} from '../js/journal-filters.js';

test('Journal keyboard moves only among visible pupil rows and lesson columns',()=>{
 const n=(row,col,key,whole=false)=>journalNavigation(row,col,3,4,key,whole);
 assert.deepEqual(n(1,1,'ArrowLeft'),{row:1,col:0});
 assert.deepEqual(n(1,1,'ArrowDown'),{row:2,col:1});
 assert.deepEqual(n(0,0,'ArrowUp'),{row:0,col:0});
 assert.deepEqual(n(2,3,'ArrowRight'),{row:2,col:3});
 assert.deepEqual(n(1,2,'Home'),{row:1,col:0});
 assert.deepEqual(n(1,2,'End'),{row:1,col:3});
 assert.deepEqual(n(1,2,'Home',true),{row:0,col:0});
 assert.deepEqual(n(1,2,'End',true),{row:2,col:3});
 assert.equal(n(0,0,'Tab'),null);
 assert.equal(n(-1,0,'ArrowDown'),null);
 assert.equal(journalNavigation(0,0,0,4,'Home'),null);
});
test('Rectangular selection is deterministic in both directions and rejects oversize before returning cells',()=>{
 const a={row:2,col:3},b={row:1,col:1};
 const expected=[{row:1,col:1},{row:1,col:2},{row:1,col:3},{row:2,col:1},{row:2,col:2},{row:2,col:3}];
 assert.deepEqual(journalRectangle(a,b,3,4),expected);
 assert.deepEqual(journalRectangle(b,a,3,4),expected);
 assert.equal(journalRectangle({row:0,col:0},{row:19,col:24},20,25).length,500);
 assert.throws(()=>journalRectangle({row:0,col:0},{row:19,col:25},20,26),/500/);
 assert.throws(()=>journalRectangle({row:-1,col:0},b,3,4),/видимые/);
});
