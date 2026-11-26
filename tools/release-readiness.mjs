/* Offline release-evidence checklist. No network, secrets, deploy or release.
 * Passed entries are declarations, not independent verification. */
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const shaOK=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
export const releaseGates=Object.freeze({
 workflows:Object.freeze(['TeachApp','TeachApp WebKit','TeachApp Cloudflare','TeachApp Delta synthetic','TeachApp Platform synthetic','TeachApp Firebase archive']),
 acceptance:Object.freeze(['pc-offline-upgrade','iphone-offline-upgrade','journal-keyboard','documents-export','coach-live-video-skills','studio-export','device-performance','encrypted-backup-restore','storage-migration-rollback','delta-production-migration','archive-media-production-migration','platform-identity-authorization','platform-external-rate-limit-recovery','notification-background-device','independent-security-review','privacy-legal-operations','production-config-and-secrets-review','release-version-changelog'])
});
const entries=kind=>releaseGates[kind].map(id=>({id,status:'pending',evidence:null}));
export function releaseEvidenceTemplate(sha){
 check(shaOK(sha),'Требуется полный SHA кандидата');
 return {format:1,target:'8.0.0',sha,workflows:entries('workflows'),acceptance:entries('acceptance')};
}
export function assessReleaseEvidence(report,expectedSha){
 check(shaOK(expectedSha),'Требуется полный SHA кандидата');
 check(exact(report,['format','target','sha','workflows','acceptance'])&&report.format===1&&report.target==='8.0.0'&&report.sha===expectedSha,'Отчёт относится к другому формату, версии или SHA');
 const pending=[],failed=[],passed=[],runIds=new Set();
 for(const kind of ['workflows','acceptance']){
  const rows=report[kind],required=releaseGates[kind];
  check(Array.isArray(rows)&&rows.length===required.length,'Неполный набор '+kind);
  const seen=new Set();
  for(const row of rows){
   check(exact(row,['id','status','evidence'])&&required.includes(row.id)&&!seen.has(row.id)&&['pending','failed','passed'].includes(row.status),'Некорректная или повторная проверка '+kind);
   seen.add(row.id);
   if(row.status==='pending')check(row.evidence===null,'Незавершённая проверка не должна иметь подтверждение');
   else if(kind==='workflows'){
    check(typeof row.evidence==='string'&&/^[1-9][0-9]{0,19}$/.test(row.evidence)&&!runIds.has(row.evidence),'Требуется уникальный ID workflow run');
    runIds.add(row.evidence);
   }else check(typeof row.evidence==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/.test(row.evidence),'Требуется ID локального акта, без содержимого и секретов');
   ({pending,failed,passed})[row.status].push(row.id);
  }
 }
 return {sha:expectedSha,total:pending.length+failed.length+passed.length,passed,pending,failed,readyForManualReleaseReview:pending.length===0&&failed.length===0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [command,sha,file,...extra]=process.argv.slice(2);
  if(command==='--template'&&!file&&!extra.length)console.log(JSON.stringify(releaseEvidenceTemplate(sha),null,2));
  else if(command==='--check'&&file&&!extra.length){
   const raw=readFileSync(file,'utf8');check(Buffer.byteLength(raw)<=32768,'Отчёт слишком большой');
   const result=assessReleaseEvidence(JSON.parse(raw),sha);console.log(JSON.stringify(result,null,2));process.exitCode=result.readyForManualReleaseReview?0:2;
  }else throw Error('Usage: node tools/release-readiness.mjs --template SHA | --check SHA FILE');
 }catch(e){console.error('Release evidence invalid: '+e.message);process.exitCode=1;}
}
