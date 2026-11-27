/* Read-only review snapshot. PR, push, exact SHA, base and artifact provenance.
 * Never downloads/unpacks artifacts, approves PR, changes version or deploys. */
import {pathToFileURL} from 'node:url';
import {workflowIds} from './release-ci-evidence.mjs';
import {releaseEvidenceTemplate,assessReleaseEvidence} from './release-readiness.mjs';
const repo='Forz1k/teachapp',repoId=1456225721,branch='roadmap/8.0-integration',prNumber=116,api='https://api.github.com';
const shaOK=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const positive=x=>Number.isSafeInteger(x)&&x>0;
const require=(ok,message)=>{if(!ok)throw Error(message);};
const repoOK=r=>r?.id===repoId&&r.full_name?.toLowerCase()===repo.toLowerCase();
const linkedRepo=r=>r?.id===repoId;
const requiredArtifacts=['teachapp-static-review','teachapp-static-manifest','teachapp-ui-smoke'];
const workflowNames=Object.keys(workflowIds);
export async function collectCandidateReview(sha,{fetcher=globalThis.fetch,token}={}){
 const report=releaseEvidenceTemplate(sha);
 require(typeof fetcher==='function','Fetch unavailable');
 if(token!==undefined)require(typeof token==='string'&&/^[A-Za-z0-9_]{1,512}$/.test(token),'Invalid API token');
 const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{})};
 async function get(path,label){
  let r;try{r=await fetcher(api+'/repos/'+repo+path,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error(label+' request failed');}
  require(r.ok&&r.status===200,label+' unavailable');
  try{return await r.json();}catch{throw Error(label+' invalid JSON');}
 }
 async function readPR(){
  const p=await get('/pulls/'+prNumber,'PR');
  require(p.number===prNumber&&p.state==='open'&&p.draft===true&&p.head?.ref===branch&&p.head.sha===sha&&repoOK(p.head.repo)&&p.base?.ref==='main'&&shaOK(p.base.sha)&&repoOK(p.base.repo),'PR identity, draft state, head or base changed');
  return p.base.sha;
 }
 function list(payload,key,label){
  const rows=payload?.[key];
  require(Number.isSafeInteger(payload?.total_count)&&payload.total_count>=0&&payload.total_count<=100&&Array.isArray(rows)&&rows.length===payload.total_count,label+' incomplete');
  return rows;
 }
 async function readRuns(base){
  const payload=await get('/actions/runs?'+new URLSearchParams({head_sha:sha,per_page:'100'}),'Actions');
  const runs=list(payload,'workflow_runs','Actions');
  require(runs.every(r=>positive(r?.id))&&new Set(runs.map(r=>r.id)).size===runs.length,'Ambiguous run identities');
  const result=[];
  for(const name of workflowNames)for(const event of ['push','pull_request']){
   const id=workflowIds[name],matching=runs.filter(r=>r.workflow_id===id&&r.event===event);
   for(const run of matching){
    require(run.name===name&&run.head_sha===sha&&run.head_branch===branch&&repoOK(run.repository)&&repoOK(run.head_repository)&&positive(run.run_number)&&positive(run.run_attempt)&&typeof run.status==='string','Unexpected run identity: '+name);
    if(event==='pull_request')require(Array.isArray(run.pull_requests)&&run.pull_requests.some(p=>p.number===prNumber&&p.head?.ref===branch&&p.head.sha===sha&&linkedRepo(p.head.repo)&&p.base?.ref==='main'&&p.base.sha===base&&linkedRepo(p.base.repo)),'PR run does not match current base: '+name);
   }
   matching.sort((a,b)=>b.run_number-a.run_number||b.run_attempt-a.run_attempt);
   require(matching.length<2||matching[0].run_number!==matching[1].run_number||matching[0].run_attempt!==matching[1].run_attempt,'Ambiguous latest run: '+name);
   const latest=matching[0];
   if(latest?.status==='completed')require(typeof latest.conclusion==='string'&&latest.conclusion.length>0,'Missing conclusion: '+name);
   result.push({name,event,id:latest?.id??null,attempt:latest?.run_attempt??null,status:!latest||latest.status!=='completed'?'pending':latest.conclusion==='success'?'passed':'failed'});
  }
  return result;
 }
 const base=await readPR(),checks=await readRuns(base),primary=checks.find(c=>c.name==='TeachApp'&&c.event==='push');
 const artifacts=[];
 if(primary.status==='passed'){
  const rows=list(await get('/actions/runs/'+primary.id+'/artifacts?per_page=100','Artifacts'),'artifacts','Artifacts');
  require(rows.every(r=>positive(r?.id))&&new Set(rows.map(r=>r.id)).size===rows.length,'Ambiguous artifact identities');
  for(const name of requiredArtifacts){
   const matches=rows.filter(a=>a.name===name&&!a.expired);
   require(matches.length===1,'Missing or ambiguous active artifact: '+name);
   const a=matches[0],run=a.workflow_run;
   require(a.expired===false&&positive(a.size_in_bytes)&&typeof a.digest==='string'&&/^sha256:[a-f0-9]{64}$/.test(a.digest)&&run?.id===primary.id&&run.head_sha===sha&&run.head_branch===branch&&run.repository_id===repoId&&run.head_repository_id===repoId,'Invalid artifact provenance: '+name);
   artifacts.push({name,id:a.id,digest:a.digest,bytes:a.size_in_bytes,runId:primary.id});
  }
 }
 const after=await readRuns(base);
 require(JSON.stringify(after)===JSON.stringify(checks),'CI changed during collection; collect again');
 require(await readPR()===base,'PR base changed during collection');
 for(const row of report.workflows){
  const check=checks.find(c=>c.name===row.id&&c.event==='push');
  row.status=check.status;row.evidence=check.status==='pending'?null:String(check.id);
 }
 const manual=assessReleaseEvidence(report,sha);
 return {format:1,sha,base,pr:prNumber,checks,artifacts,automaticReviewReady:checks.every(c=>c.status==='passed')&&artifacts.length===requiredArtifacts.length,manualPending:manual.pending.filter(id=>report.acceptance.some(a=>a.id===id)),releaseAuthorized:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [sha,...extra]=process.argv.slice(2);
  require(shaOK(sha)&&!extra.length,'Usage: node tools/release-candidate-review.mjs SHA');
  const result=await collectCandidateReview(sha,{token:process.env.GH_TOKEN||undefined});
  console.log(JSON.stringify(result,null,2));
  process.exitCode=result.automaticReviewReady?0:2;
 }catch(e){console.error('Candidate review refused: '+e.message);process.exitCode=1;}
}
