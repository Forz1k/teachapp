import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseEvidenceTemplate,assessReleaseEvidence,releaseGates} from '../tools/release-readiness.mjs';
const sha='a'.repeat(40);
const complete=()=>{const r=releaseEvidenceTemplate(sha);r.workflows.forEach((row,i)=>Object.assign(row,{status:'passed',evidence:String(i+1)}));r.acceptance.forEach((row,i)=>Object.assign(row,{status:'passed',evidence:'local-act-'+i}));return r;};
test('Release evidence never considers a clean CI equivalent to physical or production acceptance',()=>{
 const r=releaseEvidenceTemplate(sha);
 assert.equal(assessReleaseEvidence(r,sha).readyForManualReleaseReview,false);
 r.workflows.forEach((row,i)=>Object.assign(row,{status:'passed',evidence:String(i+1)}));
 const s=assessReleaseEvidence(r,sha);assert.equal(s.passed.length,6);assert.equal(s.pending.length,releaseGates.acceptance.length);assert.equal(s.readyForManualReleaseReview,false);
 const all=complete();assert.equal(assessReleaseEvidence(all,sha).readyForManualReleaseReview,true);
 all.acceptance[0].status='failed';assert.equal(assessReleaseEvidence(all,sha).readyForManualReleaseReview,false);
});
test('Release evidence rejects stale SHA, incomplete or duplicate gates, missing evidence and unexpected fields',()=>{
 assert.throws(()=>releaseEvidenceTemplate('abcdef'),/SHA/);
 assert.throws(()=>assessReleaseEvidence(complete(),'b'.repeat(40)),/SHA/);
 for(const mutate of [r=>r.workflows.pop(),r=>r.acceptance[1].id=r.acceptance[0].id,r=>r.workflows[1].evidence=r.workflows[0].evidence,r=>r.acceptance[1].evidence=r.acceptance[0].evidence,r=>r.acceptance[0].evidence=null,r=>r.acceptance[0].evidence='contains private data',r=>r.workflows[0].extra='unexpected',r=>r.acceptance[0].status='unknown']){
  const r=complete();mutate(r);assert.throws(()=>assessReleaseEvidence(r,sha));
 }
});
