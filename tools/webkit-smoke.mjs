/* Real WebKit smoke; only synthetic records in an isolated browser context. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRelay} from '../server/sync-relay.mjs';
import {resolve,sep,extname} from 'node:path';
import {webkit,devices} from 'playwright';

const root=process.cwd();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!path.startsWith(root+sep))throw Error('Invalid path');
  const bytes=await readFile(path);
  res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});
  res.end(bytes);
 }catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;
let browser,relay,relayDirectory;
try{
 browser=await webkit.launch();
 const context=await browser.newContext({...devices['iPhone 13'],locale:'ru-RU',serviceWorkers:'allow'});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/index.html');
 await page.locator('.workspace-nav').waitFor();
 const fixture=await page.evaluate(async()=>{
  const S=await import('./js/store.js'),M=await import('./js/model.js');
  const cls=await S.addClass('7А'),p=await S.addStudent(cls.id,'Тестовый ученик',1,'girls');
  const l=await S.addLesson(cls.id,M.todayIso());
  await S.setMark(p.id,l.id,{value:'5'});
  return {classId:cls.id,studentId:p.id,lessonId:l.id};
 });
 await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),{},{timeout:45000});
 for(const label of ['Классы','Главная']){
  await page.locator('.workspace-nav [aria-label="'+label+'"]').click();
  await page.locator('.screen').waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert.ok(overflow<=3,label+' viewport overflow: '+overflow);
 }
 // Public viewer uses a synthetic stream; no production Firebase access.
 const fan=await context.newPage();fan.on('pageerror',error=>errors.push(error.message));
 await fan.addInitScript(()=>{window.EventSource=class{constructor(){this.handlers={};window.__fanPush=data=>this.handlers.put?.({type:'put',data:JSON.stringify({path:'/',data})});setTimeout(()=>this.onopen?.(),0);}addEventListener(k,f){this.handlers[k]=f;}close(){}};});
 await fan.goto(origin+'/live/index.html');
 await fan.waitForFunction(()=>typeof window.__fanPush==='function');
 const future={schema:1,team:'Тестовая команда',updatedAt:Date.now(),schedule:[{id:'fixture1',opponent:'Гости',startAt:Date.now()+3600000}],archive:[]};
 await fan.evaluate(x=>window.__fanPush(x),future);await fan.locator('.clock').waitFor();
 assert.equal(await fan.locator('.credit a').getAttribute('href'),'https://github.com/Forz1k/teachapp');
 await fan.locator('[data-tab="schedule"]').click();await fan.locator('.fixture').waitFor();
 await fan.locator('[data-tab="overview"]').click();
 await fan.locator('#theme').click();assert.equal(await fan.locator('html').getAttribute('data-theme'),'light');
 assert.ok(await fan.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'public viewport overflow');
 await fan.close();
 await context.setOffline(true);
 await page.reload();
 await page.locator('.workspace-nav').waitFor({timeout:45000});
 const mark=await page.evaluate(async({studentId,lessonId})=>{
  const db=await import('./js/db.js');
  return (await db.getAll('marks')).find(m=>m.studentId===studentId&&m.lessonId===lessonId);
 },fixture);
 assert.equal(mark?.value,'5','persisted mark must survive offline reload');
 await context.setOffline(false);
 // Opening the optional sync UI must not contact any relay.
 let relayRequests=0;page.on('request',r=>{if(r.url().includes('/v1/snapshot/'))relayRequests++;});
 await page.locator('.workspace-nav [aria-label="Ещё"]').click();
 await page.locator('.sheet.show').getByRole('button',{name:'Настройки',exact:true}).click();
 await page.getByRole('button',{name:'Синхронизация устройств · бета',exact:true}).click();
 await page.locator('select[aria-label="Контур синхронизации"]').waitFor();
 assert.equal(relayRequests,0);
 relayDirectory=await mkdtemp(join(tmpdir(),'teachapp-webkit-relay-'));
 const tokenA='X'.repeat(43),tokenB='Y'.repeat(43),password='webkit-synthetic-test-password';
 relay=await createRelay({directory:relayDirectory,tokens:{school:[tokenA,tokenB]},allowedOrigin:origin});
 await new Promise(resolve=>relay.listen(0,'127.0.0.1',resolve));
 const endpoint='http://127.0.0.1:'+relay.address().port;
 const sync=async(p,token)=>p.evaluate(async({endpoint,token,password})=>{
  const {relayClient,prepareSync,executeSync}=await import('./js/sync.js');
  const client=relayClient(endpoint,'school',token);
  const plan=await prepareSync({area:'school',endpoint,password,client});
  return executeSync({plan,choices:{},password,client,confirmed:true});
 },{endpoint,token,password});
 assert.equal((await sync(page,tokenA)).revision,1);
 const second=await browser.newContext({...devices['iPhone 13'],locale:'ru-RU',serviceWorkers:'allow'});
 const otherPage=await second.newPage();otherPage.on('pageerror',error=>errors.push(error.message));
 await otherPage.goto(origin+'/index.html');
 await otherPage.locator('.workspace-nav').waitFor();
 assert.equal((await sync(otherPage,tokenB)).revision,2);
 const imported=await otherPage.evaluate(async({studentId,lessonId})=>{
  const db=await import('./js/db.js');return (await db.getAll('marks')).find(m=>m.studentId===studentId&&m.lessonId===lessonId);
 },fixture);
 assert.equal(imported?.value,'5','encrypted sync between two WebKit contexts');
 await second.close();
 console.log('WEBKIT SYNC PASS: no implicit transfer, two independent browser contexts, Web Crypto, CORS and IndexedDB');
 assert.deepEqual(errors,[],'uncaught WebKit errors');
 console.log('WEBKIT PASS: mobile viewport, IndexedDB write, service worker and offline reload');
 await context.close();
}finally{
 if(browser)await browser.close();
 if(relay)await new Promise(resolve=>relay.close(resolve));
 if(relayDirectory)await rm(relayDirectory,{recursive:true,force:true});
 await new Promise(resolve=>server.close(resolve));
}
