import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReleaseCI,workflowIds} from '../tools/release-ci-evidence.mjs';
import {assessReleaseEvidence} from '../tools/release-readiness.mjs';
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
