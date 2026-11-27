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
 const channelName='teachapp-owner-app-lab-'+id;
 const bridge=`
 import {SCHEMA,createDataAccess,assertMigrationSchema,NATIVE_STORAGE_FENCED_EVENT,ENCRYPTED_STORAGE_MARKER,configureEncryptedStorage,isEncryptedStorage,encryptedStorageAllowed} from './db.js?native-schema';
 import {createOwnerSessionLifecycle,scrubPrivateDocument} from './vault-owner-lifecycle.js';
 export {SCHEMA,createDataAccess,assertMigrationSchema,NATIVE_STORAGE_FENCED_EVENT,ENCRYPTED_STORAGE_MARKER,configureEncryptedStorage,isEncryptedStorage,encryptedStorageAllowed};
 export const syncTransaction=(n,m,fn)=>gate.transaction(n,m,fn);
 const gate=createOwnerSessionLifecycle({channelName:${JSON.stringify(channelName)},openSession:async({passwords,stillAllowed})=>{
   const {partitionedVaultLab}=await import('/tools/prototypes/vault-partitioned-lab.mjs');
   return partitionedVaultLab(${JSON.stringify(id)},{layout:'school-v3-device-migrated'}).openOwnerAppRehearsal({passwords,synthetic:true,stillAllowed});
 },onLock:reason=>{
   scrubPrivateDocument();
   if(!['pagehide','freeze','dispose'].includes(reason))location.reload();
 }});
 export const unlockLabBackend=passwords=>gate.unlock(passwords);
 export const closeLabBackend=()=>gate.lockEveryTab();
 export async function open(){throw Error('Raw native DB access forbidden in LAB');}
 export async function readBoundedSnapshot(limit){const names=Object.keys(SCHEMA);return gate.transaction(names,'readonly',async s=>{const records=(await Promise.all(names.map(n=>s[n].count()))).reduce((a,b)=>a+b,0);return {records,data:records>limit?null:Object.fromEntries(await Promise.all(names.map(async n=>[n,await s[n].getAll()])))}});}
 export const {bulkPut,get,getAll,put,del,clear,count,byIndex,transaction,clearAll,dumpAll,readSnapshot,replaceAll}=createDataAccess((...args)=>gate.transaction(...args));
 `;
 const loginScript=`
 import {unlockLabBackend,closeLabBackend} from '/js/db.js';
 const app=document.getElementById('app');
 app.innerHTML='<form id="lab-login"><h1>Вход в защищённый TeachApp LAB</h1><label>Школа<input name="school" type="password" autocomplete="off" required></label><label>Тренер<input name="coach" type="password" autocomplete="off" required></label><label>Владелец<input name="workspace" type="password" autocomplete="off" required></label><button type="submit">Войти</button><p role="status"></p></form>';
 const form=app.querySelector('form'),status=form.querySelector('[role=status]'),submit=form.querySelector('button');
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(submit.disabled)return;submit.disabled=true;
  const inputs=[...form.querySelectorAll('input')],passwords=Object.fromEntries(inputs.map(i=>[i.name,i.value]));inputs.forEach(i=>{i.value='';});
  try{await unlockLabBackend(passwords);}catch{status.textContent='Не удалось открыть защищённый сеанс';submit.disabled=false;return;}
  finally{for(const k of Object.keys(passwords))passwords[k]=undefined;}
  app.replaceChildren();await import('/js/app.js');
  const lock=document.createElement('button');lock.id='lab-lock';lock.type='button';lock.textContent='Заблокировать все вкладки';lock.style.cssText='position:fixed;top:env(safe-area-inset-top, 0px);right:4px;z-index:2147483647;min-height:44px;background:#fff;color:#111;border:1px solid #555;border-radius:6px;padding:6px';lock.onclick=closeLabBackend;document.body.append(lock);
 });
 window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 `;
 const appHtml=(await readFile(resolve(root,'index.html'),'utf8')).replace('<script type="module" src="./js/storage-bootstrap.js"></script>','<script type="module" src="/owner-lab-login.js"></script>');
 await context.route(origin+'/index.html',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:appHtml}));
 await context.route(origin+'/owner-lab-login.js',route=>route.fulfill({status:200,contentType:'text/javascript; charset=utf-8',body:loginScript}));
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
 const unlock=async(values=passwords)=>{for(const key of Object.keys(values))await page.locator('#lab-login input[name='+key+']').fill(values[key]);await page.locator('#lab-login button').click();};
 await page.goto(origin+'/index.html#journal');await page.locator('#lab-login').waitFor();
 assert.equal(await page.locator('.workspace-nav').count(),0);
 assert.equal(await page.evaluate(async()=>{try{await (await import('/js/db.js')).getAll('classes');return false;}catch{return true;}}),true);
 await unlock({...passwords,coach:'incorrect-password'});await page.getByText('Не удалось открыть защищённый сеанс').waitFor({timeout:90000});
 assert.deepEqual(await page.locator('#lab-login input').evaluateAll(inputs=>inputs.map(i=>i.value)),['','','']);
 await unlock();await page.locator('.workspace-nav').waitFor({timeout:90000});
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
  return {grade:all.marks[0]?.value,history:all.workRecords.some(r=>r.kind==='gradeHistory'),team:all.coachTeams[0].name,checkpoint:after.meta.find(r=>r.id==='sync-checkpoint-school')?.revision,noCheckpoint,refused,rawDenied,nativeAbsent};
 },{id,passwords});
 assert.deepEqual(stored,{grade:'5',history:true,team:'Демо команда 2',checkpoint:1,noCheckpoint:true,refused:true,rawDenied:true,nativeAbsent:true});
 await page.locator('#lab-lock').click();await page.locator('#lab-login').waitFor({timeout:90000});
 assert.equal(await page.locator('.workspace-nav').count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/Демо Ученик/);
 await unlock();await page.locator('.workspace-nav').waitFor({timeout:90000});
 await page.waitForFunction(()=>document.querySelector('[data-student="p"][data-lesson="l"]')?.textContent.trim()==='5',{},{timeout:90000});
 // Broadcast a lock from an isolated same-origin peer. No passwords shared.
 const peer=await context.newPage();try{await peer.goto(setup);await page.bringToFront();
  // Opening the peer may already hide/lock this document. Re-authenticate if needed.
  if(await page.locator('#lab-login').count()){await unlock();await page.locator('.workspace-nav').waitFor({timeout:90000});}
  await peer.evaluate(name=>{const channel=new BroadcastChannel(name);channel.postMessage({kind:'lock-owner',version:1});setTimeout(()=>channel.close(),100);},channelName);
  await page.locator('#lab-login').waitFor({timeout:90000});assert.equal(await page.locator('.workspace-nav').count(),0);
 }finally{await peer.close();}
 assert.deepEqual(errors,[]);
 console.log('WEBKIT OWNER APP LAB PASS: actual app journal UI and coach command via encrypted backend, persisted grade/history, checkpoint isolation, denied raw/native DB and closed-session access. Not production routing.');
 await context.close();
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
