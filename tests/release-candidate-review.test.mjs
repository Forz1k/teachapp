import test from 'node:test';
import assert from 'node:assert/strict';
import {collectCandidateReview} from '../tools/release-candidate-review.mjs';
import {workflowIds} from '../tools/release-ci-evidence.mjs';
const sha='a'.repeat(40),base='b'.repeat(40),repo={id:1456225721,full_name:'Forz1k/teachapp'},branch='roadmap/8.0-integration';
const pr={number:116,state:'open',draft:true,head:{ref:branch,sha,repo},base:{ref:'main',sha:base,repo}};
const runs=Object.entries(workflowIds).flatMap(([name,workflow_id],i)=>['push','pull_request'].map((event,j)=>({id:100+i*2+j,workflow_id,name,head_sha:sha,head_branch:branch,event,repository:repo,head_repository:repo,run_number:i*2+j+1,run_attempt:1,status:'completed',conclusion:'success',pull_requests:[pr]})));
const artifacts=['teachapp-static-review','teachapp-static-manifest','teachapp-ui-smoke'].map((name,i)=>({id:800+i,name,expired:false,size_in_bytes:100,digest:'sha256:'+'c'.repeat(64),workflow_run:{id:100,head_sha:sha,head_branch:branch,repository_id:repo.id,head_repository_id:repo.id}}));
const fake=({getPR=()=>pr,getRuns=()=>runs,getArtifacts=()=>artifacts}={})=>{
 let prReads=0,runReads=0;
 return async(url,opts)=>{
  const u=new URL(url);assert.equal(u.origin,'https://api.github.com');assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
  let data;
  if(u.pathname.endsWith('/pulls/116'))data=getPR(++prReads);
  else if(u.pathname.endsWith('/actions/runs')){assert.equal(u.searchParams.get('head_sha'),sha);const rows=getRuns(++runReads);data={total_count:rows.length,workflow_runs:rows};}
  else {assert.ok(u.pathname.endsWith('/actions/runs/100/artifacts'));const rows=getArtifacts();data={total_count:rows.length,artifacts:rows};}
  return {ok:true,status:200,json:async()=>structuredClone(data)};
 };
};
test('candidate review binds 12 latest checks and three exact push artifacts while leaving manual review unapproved',async()=>{
 const r=await collectCandidateReview(sha,{fetcher:fake()});
 assert.equal(r.automaticReviewReady,true);assert.equal(r.releaseAuthorized,false);assert.equal(r.manualPending.length,18);assert.equal(r.checks.length,12);assert.equal(r.artifacts.length,3);
 assert.equal(r.base,base);assert.ok(r.artifacts.every(a=>a.runId===100));
});
test('candidate review never accepts older success instead of pending or failed reruns',async()=>{
 const newer={...runs[1],id:555,run_number:999,status:'in_progress',conclusion:null};
 const r=await collectCandidateReview(sha,{fetcher:fake({getRuns:()=>[...runs,newer]})});
 assert.equal(r.automaticReviewReady,false);assert.equal(r.checks.find(x=>x.id===555).status,'pending');
 const failed=await collectCandidateReview(sha,{fetcher:fake({getRuns:()=>[...runs,{...newer,status:'completed',conclusion:'failure'}]})});
 assert.equal(failed.automaticReviewReady,false);assert.equal(failed.checks.find(x=>x.id===555).status,'failed');
});
test('candidate review fails closed for changed PR head/base, PR mismatch and CI race',async()=>{
 await assert.rejects(collectCandidateReview(sha,{fetcher:fake({getPR:()=>({...pr,draft:false})})}),/PR identity/);
 await assert.rejects(collectCandidateReview(sha,{fetcher:fake({getPR:n=>n===1?pr:{...pr,base:{...pr.base,sha:'d'.repeat(40)}}})}),/base changed/);
 await assert.rejects(collectCandidateReview(sha,{fetcher:fake({getRuns:()=>runs.map((r,i)=>i===1?{...r,pull_requests:[{...pr,number:117}]}:r)})}),/PR run/);
 await assert.rejects(collectCandidateReview(sha,{fetcher:fake({getRuns:n=>n===1?runs:runs.map((r,i)=>i===1?{...r,status:'in_progress'}:r)})}),/CI changed/);
});
test('candidate review refuses missing, duplicate, expired, foreign or digestless artifacts',async()=>{
 for(const rows of [artifacts.slice(1),[...artifacts,{...artifacts[0],id:900}],artifacts.map((a,i)=>i===0?{...a,expired:true}:a),artifacts.map((a,i)=>i===0?{...a,workflow_run:{...a.workflow_run,head_sha:base}}:a),artifacts.map((a,i)=>i===0?{...a,digest:null}:a)])await assert.rejects(collectCandidateReview(sha,{fetcher:fake({getArtifacts:()=>rows})}),/artifact/i);
});
