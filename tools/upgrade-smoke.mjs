/* Real WebKit PWA upgrade from pinned published baseline. Synthetic only. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {webkit,devices} from 'playwright';

const candidate=process.cwd(),baseline=resolve(process.argv[2]||'');
const readVersion=async root=>JSON.parse(await readFile(resolve(root,'package.json'),'utf8')).version;
const baselineVersion=await readVersion(baseline);assert.ok(['5.1.0','5.1.1'].includes(baselineVersion));
const expected=await readVersion(candidate);assert.notEqual(expected,baselineVersion);
let root=baseline;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost'),base=root;
  const path=resolve(base,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(base+sep))throw Error('Invalid path');
  const bytes=await readFile(path);
  res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(bytes);
 }catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await webkit.launch();
 const context=await browser.newContext({...devices['iPhone 13'],locale:'ru-RU',serviceWorkers:'allow'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/index.html');await page.locator('.workspace-nav').waitFor();
 await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),undefined,{timeout:45000});
 const installed=await page.evaluate(async()=>({version:(await import('./js/version.js')).APP_VERSION,db:(await (await import('./js/db.js')).open()).version,caches:await caches.keys()}));
 assert.equal(installed.version,baselineVersion);assert.equal(installed.db,10);assert.ok(installed.caches.some(x=>x.endsWith(':v'+baselineVersion)));
 const fixture=await page.evaluate(async()=>{
  const S=await import('./js/store.js'),M=await import('./js/model.js'),C=await import('./js/coach.js'),W=await import('./js/workbench.js'),db=await import('./js/db.js'),sync=await import('./js/sync.js'),{encryptBackup}=await import('./js/privacy.js');
  const date=M.todayIso(),from=date.slice(0,4)+'-01-01',to=date.slice(0,4)+'-12-31';await S.setYear(from,to);
  const cls=await S.addClass('7А'),p=await S.addStudent(cls.id,'Синтетический ученик',1,'girls');
  const a=await S.addLesson(cls.id,date,null,'',{slot:1,time:'08:00'}),b=await S.addLesson(cls.id,date,null,'',{slot:2,time:'09:00'});
  await S.setMark(p.id,a.id,{value:'5'});await S.setMark(p.id,b.id,{value:'4'});
  const norm=await S.saveNorm({name:'Тестовый прыжок',activityId:'standing',unit:'см',direction:'max',scale:[100,120,140,160,180]});
  await W.saveWork({kind:'normAssignment',name:'Тестовое назначение',classId:cls.id,normId:norm.id,yearFrom:from,yearTo:to,from:date,to:date,targetGrade:4});
  const team=await C.saveTeam({name:'Синтетическая команда'}),players=[];
  for(let i=0;i<6;i++)players.push(await C.savePlayer({teamId:team.id,name:'Игрок '+i,number:i+1,position:'universal'}));
  const ids=players.map(x=>x.id);
  await C.saveTraining({teamId:team.id,date,time:'10:00',title:'Синтетическая тренировка',minutes:60,exercises:[],roster:ids,held:true,attendance:{[ids[0]]:'present'},effort:{[ids[0]]:{minutes:55,rpe:4}}});
  await C.saveMatch({teamId:team.id,date,opponent:'Тестовые гости',competition:'',sets:[{ours:25,theirs:18}],roster:ids,stats:{}});
  let d=await C.startDetailedMatch({teamId:team.id,date,teamName:team.name,opponent:'Тестовый черновик',competition:'',venue:'',ourPlayers:players,awayPlayers:[],roster:ids,lineup:ids,awayLineup:[],libero:null,scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'ours'});
  d=await C.changeLiveMatch(d.id,d.revision,{type:'rally',side:'ours',kind:'point'});
  const password='synthetic-upgrade-password',endpoint='https://synthetic.example.test',area='school';
  let remote={revision:0,envelope:null};const client={get:async()=>structuredClone(remote),put:async(revision,envelope)=>{if(revision!==remote.revision)throw Error('CAS');remote={revision:revision+1,envelope};return structuredClone(remote);}};
  const plan=await sync.prepareSync({area,endpoint,password,client});await sync.executeSync({plan,choices:{},password,client,confirmed:true});
  // No saved bearer or external network request. This is a real old-format encrypted checkpoint.
  localStorage.setItem('teachapp.upgrade-test','local-preference');
  // v2 profile is scoped to coach, which has no sync checkpoint, so automatic
  // exchange must not initialize or contact its endpoint after upgrading.
  const trust=await import('./js/device-trust.js'),secret=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const profile=trust.saveTrustedProfile({version:2,endpoint:'https://synthetic-profile.example.test',deviceId:crypto.randomUUID(),name:'Synthetic upgrade device',areas:{coach:{token:secret(),password:secret()}}});
  const backup=await S.makeBackup();
  // An older published client must reject a newer authenticated format even
  // when the contents would otherwise be valid; no local write is allowed.
  const oldPacket=await (await import('./js/privacy.js')).decryptBackup(remote.envelope,password);
  const futureEnvelope=await encryptBackup({...oldPacket,backupVersion:22},password);
  let oldRejected=false;try{await sync.verifySyncSnapshot({revision:1,envelope:futureEnvelope},password,area);}catch{oldRejected=true;}
  let oldBackupRejected=false;try{(await import('./js/backup.js')).validateBackup({...backup,version:22});}catch{oldBackupRejected=true;}
  return {profile,data:await db.dumpAll(),backupData:backup.data,protectedBackup:await encryptBackup(backup,password),remote,matchId:d.id,password,endpoint,futureEnvelope,oldRejected,oldBackupRejected};
 });
 assert.equal(fixture.oldRejected,true,'old published client must reject v22 sync packet');assert.equal(fixture.oldBackupRejected,true,'old client must reject v22 backup');
 assert.equal(fixture.remote.revision,1);assert.equal(fixture.data.lessons.length,2);assert.equal(fixture.data.coachLive.length,1);
 assert.equal(fixture.backupData.meta.some(x=>x.id.startsWith('sync-checkpoint-')),false);
 root=candidate; // Same origin and browser context; only static server content changes.
 await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();if(!r)throw Error('No registration');await r.update();});
 await page.getByRole('button',{name:'Обновить',exact:true}).waitFor({timeout:45000});
 const oldDocument=await page.evaluate(()=>{window.__oldUpgradeDocument=true;return performance.timeOrigin;});
 // Activation can expose new module URLs to the old document for a brief
 // interval. Wait for the application's actual controllerchange reload,
 // not just a newly fetched version module in the outgoing document.
 await Promise.all([
  page.waitForNavigation({waitUntil:'load',timeout:45000}),
  page.getByRole('button',{name:'Обновить',exact:true}).click()
 ]);
 await page.locator('.workspace-nav').waitFor();
 await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),undefined,{timeout:45000});
 const newDocument=await page.evaluate(async()=>({old:!!window.__oldUpgradeDocument,time:performance.timeOrigin,version:(await import('./js/version.js')).APP_VERSION}));
 assert.equal(newDocument.old,false);assert.notEqual(newDocument.time,oldDocument);assert.equal(newDocument.version,expected);
 const upgraded=await page.evaluate(async()=>{const db=await import('./js/db.js');return {data:await db.dumpAll(),version:(await db.open()).version,caches:await caches.keys(),pref:localStorage.getItem('teachapp.upgrade-test'),profile:(await import('./js/device-trust.js')).readTrustedProfile()};});
 assert.deepEqual(upgraded.data,fixture.data,'upgrade must preserve every stored record including checkpoint and draft');
 assert.equal(upgraded.version,10);assert.equal(upgraded.pref,'local-preference');assert.ok(upgraded.caches.some(x=>x.endsWith(':v'+expected)));assert.ok(!upgraded.caches.some(x=>x.endsWith(':v'+baselineVersion)));assert.deepEqual(upgraded.profile,fixture.profile,'v2 profile must remain exactly unchanged');assert.equal(upgraded.data.meta.some(x=>x.id==='sync-checkpoint-coach'),false,'upgrade must not initialize unconfirmed scope');
 const reconcile=await page.evaluate(async({remote,password,endpoint})=>{
  const sync=await import('./js/sync.js');let writes=0;const client={get:async()=>remote,put:async()=>{writes++;throw Error('Unnecessary write');}};
  const plan=await sync.prepareSync({area:'school',endpoint,password,client});const result=await sync.executeSync({plan,choices:{},password,client,confirmed:true,reuseRemote:true});
  return {revision:result.revision,writes,status:(await sync.localSyncState({area:'school',endpoint,password})).status};
 },fixture);
 assert.deepEqual(reconcile,{revision:1,writes:0,status:'clean'});
 const compat=await page.evaluate(async({futureEnvelope,password})=>{const sync=await import('./js/sync.js'),S=await import('./js/store.js');return {remote:await sync.verifySyncSnapshot({revision:1,envelope:futureEnvelope},password,'school'),backup:(await S.makeBackup()).version};},fixture);
 assert.deepEqual(compat,{remote:{revision:1,empty:false},backup:22});
 console.log('FORMAT FENCE PASS: published v21 refuses v22, new client reads both, preserved old checkpoint without PUT.');
 await context.setOffline(true);await page.reload();await page.locator('.workspace-nav').waitFor();
 const offline=await page.evaluate(async id=>{
  const db=await import('./js/db.js'),C=await import('./js/coach.js'),{replayDetailed}=await import('./js/match-protocol.js'),draft=await db.get('coachLive',id);
  const previous=replayDetailed(draft);const next=await C.changeLiveMatch(id,draft.revision,{type:'rally',side:'ours',kind:'point'});const score=replayDetailed(next);
  return {version:(await import('./js/version.js')).APP_VERSION,previous:previous.ours,score:score.ours,marks:(await db.getAll('marks')).length};
 },fixture.matchId);
 assert.deepEqual(offline,{version:expected,previous:1,score:2,marks:2});
 await context.setOffline(false);await context.close();
 const restoredContext=await browser.newContext({...devices['iPhone 13'],locale:'ru-RU',serviceWorkers:'allow'}),fresh=await restoredContext.newPage();fresh.on('pageerror',e=>errors.push(e.message));
 await fresh.goto(origin+'/index.html');await fresh.locator('.workspace-nav').waitFor();
 const restored=await fresh.evaluate(async({protectedBackup,password})=>{const S=await import('./js/store.js'),db=await import('./js/db.js'),{decryptBackup}=await import('./js/privacy.js');await S.restoreBackup(await decryptBackup(protectedBackup,password));return db.dumpAll();},fixture);
 assert.deepEqual(restored,fixture.backupData,'old encrypted backup must restore in a separate new-version context');
 assert.deepEqual(errors,[]);await restoredContext.close();
 console.log('PWA UPGRADE PASS: actual '+baselineVersion+' → '+expected+'; preserved v2 identity, no automatic initialization, IndexedDB v10, both lesson slots and grades, norm assignment, team/training/match, unfinished score, preserved encrypted checkpoint, zero redundant PUT, previous cache removed, offline edit, encrypted backup restored independently.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
