/* Real WebKit smoke; only synthetic records in an isolated browser context. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
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
let browser;
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
 await context.setOffline(true);
 await page.reload();
 await page.locator('.workspace-nav').waitFor({timeout:45000});
 const mark=await page.evaluate(async({studentId,lessonId})=>{
  const db=await import('./js/db.js');
  return (await db.getAll('marks')).find(m=>m.studentId===studentId&&m.lessonId===lessonId);
 },fixture);
 assert.equal(mark?.value,'5','persisted mark must survive offline reload');
 assert.deepEqual(errors,[],'uncaught WebKit errors');
 console.log('WEBKIT PASS: mobile viewport, IndexedDB write, service worker and offline reload');
 await context.close();
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
