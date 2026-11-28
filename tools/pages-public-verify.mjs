/* Read-only verification of the public Pages static package, not a release
 * authorization or physical browser test. Never fetch user data or backend URLs. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {staticReleaseFiles} from './build-static-release.mjs';
const origin='https://forz1k.github.io',scope='/teachapp/';
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const safePath=p=>typeof p==='string'&&/^(?:index\.html|live\/index\.html|manifest\.webmanifest|sw\.js|vendor\/xlsx\.full\.min\.js|js\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.js|css\/[a-z0-9_-]+\.css|icons\/[a-z0-9_-]+\.(?:png|svg))$/.test(p);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
export function validatePublicManifest(m,sha){
 check(exact(m,['format','sha','version','files'])&&m.format===1&&/^[0-9a-f]{40}$/.test(sha)&&m.sha===sha&&typeof m.version==='string'&&/^8\.0\.0(?:-rc\.[1-9][0-9]*)?$/.test(m.version)&&Array.isArray(m.files)&&m.files.length>8&&m.files.length<=1000,'Manifest identity invalid');
 check(m.files.every(f=>exact(f,['path','bytes','sha256'])&&(safePath(f.path)||f.path==='.nojekyll')&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=8*1024*1024&&/^[0-9a-f]{64}$/.test(f.sha256)),'Manifest record invalid');
 const paths=m.files.map(f=>f.path);
 check(paths.length===new Set(paths).size&&['.nojekyll','index.html','live/index.html','sw.js','js/version.js','manifest.webmanifest'].every(p=>paths.includes(p)),'Manifest paths invalid');
 return m.files.filter(f=>f.path!=='.nojekyll');
}
export async function verifyPublishedPackage(manifest,sha,{fetcher=globalThis.fetch,concurrency=6,attempt=0}={}){
 const files=validatePublicManifest(manifest,sha);
 check(typeof fetcher==='function'&&Number.isSafeInteger(concurrency)&&concurrency>=1&&concurrency<=8&&Number.isSafeInteger(attempt)&&attempt>=0&&attempt<=20,'Verification options invalid');
 const workerRow=files.find(f=>f.path==='sw.js'),versionRow=files.find(f=>f.path==='js/version.js');
 async function verify(row){
  const u=new URL(scope+row.path,origin);
  u.searchParams.set('release-check',sha+'-'+attempt);
  const res=await fetcher(u.href,{method:'GET',redirect:'error',cache:'no-store',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(12000)});
  check(res.ok&&res.status===200,'HTTP '+res.status+' for '+row.path);
  const reader=res.body?.getReader();check(reader,'Missing response body: '+row.path);
  const bytes=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>row.bytes){await reader.cancel();throw Error('Byte length mismatch: '+row.path);}bytes.push(Buffer.from(value));}}finally{reader.releaseLock();}
  const data=Buffer.concat(bytes);check(data.length===row.bytes&&hash(data)===row.sha256,'Digest mismatch: '+row.path);
  return data;
 }
 // A stale service worker/version must fail immediately, before fetching all assets.
 const version=(await verify(versionRow)).toString('utf8');
 check(version.trim()==="export const APP_VERSION = '"+manifest.version+"';",'Public version mismatch');
 const worker=(await verify(workerRow)).toString('utf8');
 check(worker.split(/\r?\n/).includes("const VERSION = 'v"+manifest.version+"';"),'Public worker version mismatch');
 check(JSON.stringify(staticReleaseFiles(worker).sort())===JSON.stringify(files.map(f=>f.path).sort()),'Public precache mismatch');
 const rest=files.filter(f=>f!==workerRow&&f!==versionRow);
 let cursor=0;
 await Promise.all(Array.from({length:concurrency},async()=>{while(cursor<rest.length){const row=rest[cursor++];await verify(row);}}));
 return {sha,version:manifest.version,files:files.length,origin:origin+scope,releaseAuthorized:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [sha,file,...extra]=process.argv.slice(2);
  check(file&&!extra.length,'Usage: node tools/pages-public-verify.mjs SHA MANIFEST');
  const raw=readFileSync(file,'utf8');check(Buffer.byteLength(raw)<=1024*1024,'Manifest exceeds budget');
  const manifest=JSON.parse(raw);validatePublicManifest(manifest,sha);
  // Pages branch build is asynchronous; allow a bounded convergence window.
  let last;
  for(let attempt=0;attempt<8;attempt++){
   try{const result=await verifyPublishedPackage(manifest,sha,{attempt});console.log('PUBLIC PAGES INTEGRITY PASS: '+JSON.stringify(result));last=null;break;}
   catch(e){last=e;console.log('Public Pages not yet matching (attempt '+(attempt+1)+'): '+e.message);if(attempt<7)await delay(15000);}
  }
  if(last)throw last;
 }catch(e){console.error('Public Pages verification refused: '+e.message);process.exitCode=1;}
}
