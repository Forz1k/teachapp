import test from 'node:test';
import assert from 'node:assert/strict';
import {planThreeWayMerge} from '../tools/prototypes/sync-plan.mjs';
const x=(id,value)=>({id,value});
test('merge independent changes and identical concurrent additions',()=>{
 const base=[x('a',1),x('b',2)],local=[x('a',3),x('b',2),x('c',4)],remote=[x('a',1),x('b',5),{value:4,id:'c'}];
 const p=planThreeWayMerge(base,local,remote);
 assert.deepEqual(p.candidateRecords,[x('a',3),x('b',5),x('c',4)]);
 assert.equal(p.complete,true);assert.deepEqual(p.conflicts,[]);
});
test('different concurrent edits, delete versus edit and colliding additions require resolution',()=>{
 const base=[x('a',1),x('b',2)],local=[x('a',3),x('c',4)],remote=[x('a',5),x('b',6),x('c',7)];
 const p=planThreeWayMerge(base,local,remote);
 assert.equal(p.complete,false);assert.deepEqual(p.candidateRecords,[]);
 assert.deepEqual(p.conflicts.map(c=>c.id),['a','b','c']);
 assert.equal(p.conflicts[1].local,null);
});
test('one-sided deletion is not restored and inputs are not mutated',()=>{
 const a=x('a',1),b=x('b',2),p=planThreeWayMerge([a,b],[b],[a,b]);
 assert.deepEqual(p.candidateRecords,[b]);p.candidateRecords[0].value=99;assert.equal(b.value,2);
 assert.throws(()=>planThreeWayMerge([a,a],[],[]),/duplicate/);
});
