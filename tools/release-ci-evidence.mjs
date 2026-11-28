/* Read-only GitHub Actions evidence for the exact integration push SHA.
 * No deploy, release, repository write, logs, or automatic acceptance. */
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {releaseEvidenceTemplate,assessReleaseEvidence} from './release-readiness.mjs';
const repo='Forz1k/teachapp',legacyBranch='roadmap/8.0-integration',api='https://api.github.com';
export const workflowIds=Object.freeze({'TeachApp':428329073,'TeachApp WebKit':428881876,'TeachApp Cloudflare':428941722,'TeachApp Delta synthetic':430001967,'TeachApp Platform synthetic':429958587,'TeachApp Firebase archive':429637492});
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const positive=n=>Number.isSafeInteger(n)&&n>0;
function validRun(run,id,name,sha,branch){
 return run&&positive(run.id)&&run.workflow_id===id&&run.name===name&&run.head_sha===sha&&run.head_branch===branch&&run.event==='push'&&run.repository?.full_name?.toLowerCase()===repo.toLowerCase()&&run.head_repository?.full_name?.toLowerCase()===repo.toLowerCase()&&positive(run.run_number)&&positive(run.run_attempt)&&typeof run.status==='string';
}
export async function collectReleaseCI(sha,{fetcher=globalThis.fetch,token,final=false}={}){
 check(typeof final==='boolean','Invalid final mode');const branch=final?'roadmap/8.0-final':legacyBranch;
 const report=releaseEvidenceTemplate(sha);
 check(typeof fetcher==='function','Fetch unavailable');
 if(token!==undefined)check(typeof token==='string'&&/^[A-Za-z0-9_]{1,512}$/.test(token),'Invalid API token');
 const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{})};
 for(const row of report.workflows){
  const id=workflowIds[row.id];check(positive(id),'Unknown required workflow');
  const u=new URL('/repos/'+repo+'/actions/workflows/'+id+'/runs',api);
  u.search=new URLSearchParams({head_sha:sha,branch,event:'push',per_page:'100'}).toString();
  let response;try{response=await fetcher(u.href,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('GitHub request failed for '+row.id);}
  check(response.ok&&response.status===200,'GitHub response unavailable for '+row.id);
  let body;try{body=await response.json();}catch{throw Error('Invalid GitHub response for '+row.id);}
  check(Number.isSafeInteger(body?.total_count)&&body.total_count>=0&&body.total_count<=100&&Array.isArray(body.workflow_runs)&&body.workflow_runs.length===body.total_count,'Incomplete workflow response for '+row.id);
  const runs=body.workflow_runs;
  check(runs.every(x=>validRun(x,id,row.id,sha,branch))&&new Set(runs.map(x=>x.id)).size===runs.length,'Unexpected workflow identity for '+row.id);
  if(!runs.length)continue;
  runs.sort((a,b)=>b.run_number-a.run_number||b.run_attempt-a.run_attempt);
  check(runs.length===1||runs[0].run_number!==runs[1].run_number||runs[0].run_attempt!==runs[1].run_attempt,'Ambiguous latest workflow run');
  const latest=runs[0];
  if(latest.status!=='completed')continue;
  check(typeof latest.conclusion==='string'&&latest.conclusion.length>0,'Missing workflow conclusion');
  row.status=latest.conclusion==='success'?'passed':'failed';row.evidence=String(latest.id);
 }
 assessReleaseEvidence(report,sha);
 return report;
}
/** Keep independently declared manual evidence; replace all CI declarations
 * with a fresh API read, and fence the branch before and after collection. */
export async function refreshReleaseEvidence(report,sha,{fetcher=globalThis.fetch,token,final=false}={}){
 check(typeof final==='boolean','Invalid final mode');const branch=final?'roadmap/8.0-final':legacyBranch;
 assessReleaseEvidence(report,sha);
 check(typeof fetcher==='function','Fetch unavailable');
 if(token!==undefined)check(typeof token==='string'&&/^[A-Za-z0-9_]{1,512}$/.test(token),'Invalid API token');
 const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{})};
 async function verifyHead(){
  const url=api+'/repos/'+repo+'/git/ref/heads/'+branch;
  let response;try{response=await fetcher(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('Integration head unavailable');}
  check(response.ok&&response.status===200,'Integration head unavailable');
  let body;try{body=await response.json();}catch{throw Error('Integration head unavailable');}
  check(body?.ref==='refs/heads/'+branch&&body?.object?.type==='commit'&&body.object.sha===sha,'Integration head changed or does not match candidate');
 }
 const acceptance=structuredClone(report.acceptance);
 await verifyHead();
 const fresh=await collectReleaseCI(sha,{fetcher,token,final});
 await verifyHead();
 fresh.acceptance=acceptance;
 assessReleaseEvidence(fresh,sha);
 return fresh;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2),final=args[0]==='--final';if(final)args.shift();
  const [first,second,file,...extra]=args,token=process.env.GH_TOKEN||undefined;
  if(first==='--refresh'||first==='--verify'){
   check(second&&file&&!extra.length,'Usage: node tools/release-ci-evidence.mjs --refresh|--verify SHA FILE');
   const raw=readFileSync(file,'utf8');check(Buffer.byteLength(raw)<=32768,'Evidence too large');
   const refreshed=await refreshReleaseEvidence(JSON.parse(raw),second,{token,final});
   const result=assessReleaseEvidence(refreshed,second);
   console.log(JSON.stringify(first==='--refresh'?refreshed:result,null,2));
   process.exitCode=result.readyForManualReleaseReview?0:2;
  }else{
   check(first&&!second&&!file&&!extra.length,'Usage: node tools/release-ci-evidence.mjs SHA');
   console.log(JSON.stringify(await collectReleaseCI(first,{token,final}),null,2));
  }
 }catch(e){console.error('CI evidence unavailable: '+e.message);process.exitCode=1;}
}
