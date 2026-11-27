/* Real app UI against the explicitly selected all-key synthetic backend.
 * The browser is an isolated WebKit context; the published db.js is not
 * replaced on disk and the interception does not ship in the PWA package. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {webkit,devices} from 'playwright';
const root=process.cwd(),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost'),path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(root+sep))throw Error('Invalid path');
  res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(path));
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port,id='webkit-owner-app';
const passwords={school:'synthetic-school-app',coach:'synthetic-coach-app',workspace:'synthetic-owner-app'};
const backupPasswords={school:'synthetic-school-copy',coach:'synthetic-coach-copy',workspace:'synthetic-owner-copy'};
let browser;
try{
 browser=await webkit.launch();
 const context=await browser.newContext({...devices['iPhone 13'],locale:'ru-RU',serviceWorkers:'block'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const dbPath=origin+'/js/db.js';
 // Query-qualified real module exports schema/contract only. The app and all
 // its dependencies import this intercepted module at the canonical URL.
 const bridge=`
 import {SCHEMA,createDataAccess,assertMigrationSchema} from './db.js?native-schema';
 export {SCHEMA,createDataAccess,assertMigrationSchema};
 let closed=false,pending;
 const session=()=>{if(closed)throw Error('LAB backend closed');return pending??=import('/tools/prototypes/vault-partitioned-lab.mjs').then(({partitionedVaultLab})=>partitionedVaultLab(${JSON.stringify(id)},{layout:'school-v3-device-migrated'}).openOwnerAppRehearsal({passwords:${JSON.stringify(passwords)},synthetic:true,stillAllowed:()=>!closed}));};
 export function closeLabBackend(){closed=true;pending?.then(a=>a.close()).catch(()=>{});}
 window.addEventListener('pagehide',closeLabBackend);
 export async function open(){throw Error('Raw native DB access forbidden in LAB');}
 export async function readBoundedSnapshot(limit){return (await session()).readBoundedSnapshot(limit);}
 export const {bulkPut,get,getAll,put,del,clear,count,byIndex,transaction,clearAll,dumpAll,readSnapshot,replaceAll}=createDataAccess(async(...args)=>(await session()).transaction(...args));
 `;
 await context.route(dbPath,route=>route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:bridge}));
 const setup=origin+'/vault-app-setup.html';
 await context.route(setup,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><title>Synthetic setup</title>'}));
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(setup);
 await page.evaluate(async({id,passwords,backupPasswords})=>{
  const D=await import('/js/db.js'),M=await import('/js/model.js'),S=await import('/js/sync.js'),B=await import('/js/backup.js'),P=await import('/js/privacy.js'),L=await import('/tools/prototypes/vault-partition-migration-lab.mjs');
  const data=Object.fromEntries(Object.keys(D.SCHEMA).map(n=>[n,[]])),date=M.todayIso(),year={from:M.addDays(date,-30),to:M.addDays(date,30)};
  data.meta=[{...M.defaultSettings(),year,trimesters:[{id:'t1',kind:'trimester',index:1,...year}]}];
  data.classes=[{id:'c',name:'7А',gradeLevel:7}];data.students=[{id:'p',classId:'c',fullName:'Демо Ученик',number:1,normGroup:'girls'}];data.lessons=[{id:'l',classId:'c',date,slot:1,time:'09:00',topicId:null,note:'',activityIds:[]}];
  data.coachTeams=[{id:'t',name:'Демо команда',archived:false}];
  const workspaceId='12345678-1234-1234-1234-123456789abc',revision=1,endpoint='https://synthetic.invalid';
  const envelope=await P.encryptBackup({app:'teachapp-sync',version:1,backupVersion:B.BACKUP_VERSION,area:'school',workspaceId,revision,snapshot:S.projectScope(data,'school')},'synthetic-sync-password');
  data.meta.push({id:'sync-checkpoint-school',endpoint,workspaceId,revision,envelope});
  const old=await L.openPartitionLegacyLab(id,{deviceLocal:true});
  await new Promise((resolve,reject)=>{const tx=old.transaction(Object.keys(D.SCHEMA),'readwrite');for(const [name,rows] of Object.entries(data))for(const row of rows)tx.objectStore(name).add(row);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});old.close();
  const copy=await L.preparePartitionLegacyMigrationLab(id,{backupPasswords,deviceLocal:true});
  await L.migratePartitionLegacyLab(id,{passwords,backupPasswords,backupFile:copy.file,saved:true,confirmed:true,deviceLocal:true});
  localStorage.setItem('teachapp.journal.view','table');
 },{id,passwords,backupPasswords});
 await page.goto(origin+'/index.html#journal');await page.locator('.workspace-nav').waitFor({timeout:90000});
 const cell=page.locator('[data-student="p"][data-lesson="l"]');
 await cell.waitFor({timeout:90000});await cell.click();
 await page.locator('.sheet.show').getByRole('button',{name:'5',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-student="p"][data-lesson="l"]')?.textContent.trim()==='5',{},{timeout:90000});
 const stored=await page.evaluate(async({id,passwords})=>{
  const D=await import('/js/db.js'),C=await import('/js/coach.js'),S=await import('/js/store.js'),P=await import('/tools/prototypes/vault-partitioned-lab.mjs');
  await C.saveTeam({id:'t',name:'Демо команда 2',archived:false});
  const lab=P.partitionedVaultLab(id,{layout:'school-v3-device-migrated'}),all=await lab.snapshot({passwords});
  const ordinary=await S.makeBackup();const noCheckpoint=ordinary.data.meta.every(r=>!r.id.startsWith('sync-checkpoint-'));
  let refused=false;try{await D.replaceAll(ordinary.data);}catch(e){refused=/контрольных точек/.test(e.message);}
  let rawDenied=false;try{await D.open();}catch{rawDenied=true;}
  // Abort a would-be creation, rather than creating or deleting a live DB.
  const nativeAbsent=await new Promise((resolve,reject)=>{let absent=false;const q=indexedDB.open('teachapp',10);q.onupgradeneeded=()=>{absent=true;q.transaction.abort();};q.onerror=()=>absent?resolve(true):reject(q.error);q.onsuccess=()=>{q.result.close();resolve(false);};});
  const after=await lab.snapshot({passwords});
  D.closeLabBackend();let closed=false;try{await D.getAll('classes');}catch{closed=true;}
  return {grade:all.marks[0]?.value,history:all.workRecords.some(r=>r.kind==='gradeHistory'),team:all.coachTeams[0].name,checkpoint:after.meta.find(r=>r.id==='sync-checkpoint-school')?.revision,noCheckpoint,refused,rawDenied,nativeAbsent,closed};
 },{id,passwords});
 assert.deepEqual(stored,{grade:'5',history:true,team:'Демо команда 2',checkpoint:1,noCheckpoint:true,refused:true,rawDenied:true,nativeAbsent:true,closed:true});
 await page.reload();await page.locator('.workspace-nav').waitFor({timeout:90000});
 await page.waitForFunction(()=>document.querySelector('[data-student="p"][data-lesson="l"]')?.textContent.trim()==='5',{},{timeout:90000});
 assert.deepEqual(errors,[]);
 console.log('WEBKIT OWNER APP LAB PASS: actual app journal UI and coach command via encrypted backend, persisted grade/history, checkpoint isolation, denied raw/native DB and closed-session access. Not production routing.');
 await context.close();
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
