import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReleaseCI,refreshReleaseEvidence,workflowIds} from '../tools/release-ci-evidence.mjs';
import {releaseEvidenceTemplate,assessReleaseEvidence} from '../tools/release-readiness.mjs';
const sha='a'.repeat(40),repo='Forz1k/teachapp',branch='roadmap/8.0-integration';
const run=(name,overrides={})=>({id:workflowIds[name]+1000,workflow_id:workflowIds[name],name,head_sha:sha,head_branch:branch,event:'push',repository:{full_name:repo},head_repository:{full_name:repo},run_number:10,run_attempt:1,status:'completed',conclusion:'success',...overrides});
const fake=(build,seen=[])=>async(url,opts)=>{
 const u=new URL(url),id=Number(u.pathname.split('/').at(-2)),name=Object.keys(workflowIds).find(k=>workflowIds[k]===id);
 assert.equal(u.origin,'https://api.github.com');assert.equal(u.pathname,'/repos/Forz1k/teachapp/actions/workflows/'+id+'/runs');assert.equal(u.searchParams.get('head_sha'),sha);assert.equal(u.searchParams.get('event'),'push');assert.equal(u.searchParams.get('branch'),branch);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');seen.push(name);
 const runs=build(name);return {ok:true,status:200,json:async()=>({total_count:runs.length,workflow_runs:runs})};
};
test('CI evidence verifies exact workflow identity and latest run while leaving every manual gate pending',async()=>{
 const seen=[],report=await collectReleaseCI(sha,{fetcher:fake(name=>[run(name)],seen)});
 assert.equal(seen.length,6);assert.equal(report.workflows.filter(r=>r.status==='passed').length,6);assert.equal(assessReleaseEvidence(report,sha).readyForManualReleaseReview,false);assert.ok(report.acceptance.every(r=>r.status==='pending'&&r.evidence===null));
 const mixed=await collectReleaseCI(sha,{fetcher:fake(name=>name==='TeachApp'?[run(name),run(name,{id:42,run_number:11,status:'in_progress',conclusion:null})]:name==='TeachApp WebKit'?[run(name,{conclusion:'failure'})]:name==='TeachApp Cloudflare'?[]:[run(name)])});
 assert.equal(mixed.workflows[0].status,'pending');assert.equal(mixed.workflows[1].status,'failed');assert.equal(mixed.workflows[2].status,'pending');
});
test('CI evidence refuses wrong SHA, PR event, fork, workflow substitution, pagination and request failure',async()=>{
 for(const overrides of [{head_sha:'b'.repeat(40)},{event:'pull_request'},{head_repository:{full_name:'fork/teachapp'}},{head_branch:'main'},{workflow_id:1},{name:'Other'}])await assert.rejects(collectReleaseCI(sha,{fetcher:fake(n=>[run(n,overrides)])}),/identity/);
 await assert.rejects(collectReleaseCI(sha,{fetcher:async()=>({ok:true,status:200,json:async()=>({total_count:101,workflow_runs:[]})})}),/Incomplete/);
 await assert.rejects(collectReleaseCI(sha,{fetcher:async()=>({ok:false,status:403})}),/unavailable/);
 await assert.rejects(collectReleaseCI(sha,{fetcher:async()=>{throw Error('SECRET');}}),e=>!e.message.includes('SECRET')&&/request failed/.test(e.message));
 await assert.rejects(collectReleaseCI('short',{fetcher:fake(n=>[run(n)])}),/SHA/);
});

test('Refresh preserves only exact-SHA manual declarations and rechecks integration head before and after current CI',async()=>{
 const input=releaseEvidenceTemplate(sha);input.acceptance[0]={id:input.acceptance[0].id,status:'passed',evidence:'local-act-001'};
 input.workflows[0]={id:'TeachApp',status:'passed',evidence:'999'};
 const before=structuredClone(input);
 let headReads=0;
 const wrap=(head=()=>sha)=>async(url,opts)=>{
  if(url.includes('/git/ref/heads/')){headReads++;assert.equal(url,'https://api.github.com/repos/Forz1k/teachapp/git/ref/heads/roadmap/8.0-integration');assert.equal(opts.redirect,'error');return {ok:true,status:200,json:async()=>({ref:'refs/heads/'+branch,object:{type:'commit',sha:head(headReads)}})};}
  return fake(n=>[run(n,{conclusion:n==='TeachApp'?'failure':'success'})])(url,opts);
 };
 const result=await refreshReleaseEvidence(input,sha,{fetcher:wrap()});
 assert.equal(headReads,2);assert.deepEqual(result.acceptance,input.acceptance);assert.deepEqual(input,before);
 assert.equal(result.workflows[0].status,'failed');assert.notEqual(result.workflows[0].evidence,'999');
 assert.equal(assessReleaseEvidence(result,sha).readyForManualReleaseReview,false);
 headReads=0;await assert.rejects(refreshReleaseEvidence(input,sha,{fetcher:wrap(n=>n===1?sha:'b'.repeat(40))}),/head changed/);
 assert.equal(headReads,2);
 headReads=0;await assert.rejects(refreshReleaseEvidence(input,'b'.repeat(40),{fetcher:wrap()}),/SHA/);assert.equal(headReads,0);
});

test('final CI evidence selects only final branch pushes and fences the final head',async()=>{
 const final='roadmap/8.0-final',report=releaseEvidenceTemplate(sha);let refs=0;
 const fetcher=async(url,opts)=>{const u=new URL(url);assert.equal(opts.method,'GET');
  if(u.pathname.includes('/git/ref/heads/')){refs++;assert.ok(u.pathname.endsWith('/'+final));return {ok:true,status:200,json:async()=>({ref:'refs/heads/'+final,object:{type:'commit',sha}})};}
  assert.equal(u.searchParams.get('branch'),final);
  const id=Number(u.pathname.split('/').at(-2)),name=Object.keys(workflowIds).find(k=>workflowIds[k]===id);
  return {ok:true,status:200,json:async()=>({total_count:1,workflow_runs:[run(name,{head_branch:final})]})};
 };
 const refreshed=await refreshReleaseEvidence(report,sha,{fetcher,final:true});assert.equal(refs,2);assert.equal(refreshed.workflows.filter(x=>x.status==='passed').length,6);
 assert.ok(refreshed.acceptance.every(x=>x.status==='pending'));
 await assert.rejects(collectReleaseCI(sha,{fetcher:fake(n=>[run(n)]),final:true}));
});

test('published acceptance evidence fences actual main SHA, never auto-passes manual acts',async()=>{
 const report=releaseEvidenceTemplate(sha);let heads=0;
 const fetcher=async(url,opts)=>{
  const u=new URL(url);assert.equal(opts.method,'GET');
  if(u.pathname.includes('/git/ref/heads/')){heads++;assert.ok(u.pathname.endsWith('/main'));return {ok:true,status:200,json:async()=>({ref:'refs/heads/main',object:{type:'commit',sha}})};}
  assert.equal(u.searchParams.get('branch'),'main');
  const id=Number(u.pathname.split('/').at(-2)),name=Object.keys(workflowIds).find(k=>workflowIds[k]===id);
  return {ok:true,status:200,json:async()=>({total_count:1,workflow_runs:[run(name,{head_branch:'main'})]})};
 };
 const result=await refreshReleaseEvidence(report,sha,{fetcher,published:true});assert.equal(heads,2);assert.equal(result.workflows.filter(r=>r.status==='passed').length,6);
 assert.ok(result.acceptance.every(r=>r.status==='pending'&&r.evidence===null));assert.equal(assessReleaseEvidence(result,sha).readyForManualReleaseReview,false);
 await assert.rejects(collectReleaseCI(sha,{fetcher,published:true,final:true}),/mode/);
 await assert.rejects(refreshReleaseEvidence(report,sha,{published:true,fetcher:async(url,opts)=>url.includes('/git/ref/heads/')?{ok:true,status:200,json:async()=>({ref:'refs/heads/main',object:{type:'commit',sha:'b'.repeat(40)}})}:fetcher(url,opts)}),/head changed/);
});
