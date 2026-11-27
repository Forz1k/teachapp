/* Actual published module graph; no db interception or synthetic key injection
 * into production code. All database contents are generated in isolated CI. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {webkit,devices} from 'playwright';
const root=resolve(process.argv[2]||process.cwd()),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://localhost'),path=resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));if(!path.startsWith(root+sep))throw Error('Path');const data=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port,passwords={school:'synthetic-school-app',coach:'synthetic-coach-app',workspace:'synthetic-owner-app'},backupPassword='synthetic-backup-app';
let browser;
try{
 browser=await webkit.launch();const context=await browser.newContext({...devices['iPhone 13'],locale:'ru-RU',serviceWorkers:'block',acceptDownloads:true});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/index.html');await page.locator('.workspace-nav').waitFor({timeout:90000});
 await page.evaluate(async()=>{
  const D=await import('/js/db.js'),M=await import('/js/model.js'),data=Object.fromEntries(Object.keys(D.SCHEMA).map(n=>[n,[]])),date=M.todayIso(),year={from:M.addDays(date,-30),to:M.addDays(date,30)};
  data.meta=[{...M.defaultSettings(),year,trimesters:[{id:'t1',kind:'trimester',index:1,...year}]}];data.classes=[{id:'c',name:'7А',gradeLevel:7}];data.students=[{id:'p',classId:'c',fullName:'Демо Ученик',number:1,normGroup:'girls'}];data.lessons=[{id:'l',classId:'c',date,slot:1,time:'09:00',topicId:null,note:'',activityIds:[]}];data.coachTeams=[{id:'t',name:'Демо команда',archived:false}];
  await D.replaceAll(data);localStorage.setItem('teachapp.journal.view','table');
 });
 await page.goto(origin+'/index.html?secure-migration=1#journal');await page.getByRole('button',{name:'Создать защищённую копию'}).waitFor();
 const locks=await page.evaluate(()=>typeof navigator.locks?.request==='function');assert.ok(locks,'Web Locks required for production candidate');
 await page.locator('input[name=backup]').fill(backupPassword);
 const downloadPromise=page.waitForEvent('download',{timeout:90000});await page.getByRole('button',{name:'Создать защищённую копию'}).click();const dl=await downloadPromise,bytes=await readFile(await dl.path());assert.doesNotMatch(bytes.toString(),/Демо Ученик/);
 await page.locator('input[type=file]').setInputFiles({name:'recovery.json',mimeType:'application/json',buffer:bytes});
 await page.locator('input[name=backup]').fill(backupPassword);for(const [scope,password] of Object.entries(passwords))await page.locator('input[name='+scope+']').fill(password);
 await page.locator('input[type=checkbox]').check();await page.getByRole('button',{name:'Перенести в зашифрованную базу'}).click();
 await page.getByRole('heading',{name:'Защищённый TeachApp'}).waitFor({timeout:90000});assert.equal(await page.locator('.workspace-nav').count(),0);
 const login=async(values=passwords)=>{for(const [scope,password] of Object.entries(values))await page.locator('input[name='+scope+']').fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();};
 await login({...passwords,coach:'wrong-key-password'});await page.getByText('Неверный пароль или повреждение хранилища. Данные не изменены.').waitFor({timeout:90000});
 await login();await page.locator('.workspace-nav').waitFor({timeout:90000});const cell=page.locator('[data-student="p"][data-lesson="l"]');await cell.waitFor({timeout:90000});await cell.click();await page.locator('.sheet.show').getByRole('button',{name:'5',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-student="p"][data-lesson="l"]')?.textContent.trim()==='5',{},{timeout:90000});
 const verified=await page.evaluate(async()=>{
  const D=await import('/js/db.js'),C=await import('/js/coach.js'),P=await import('/js/personal-sync.js');await C.saveTeam({id:'t',name:'Демо команда 2',archived:false});
  const code=P.createPersonalCode('https://synthetic.invalid');P.savePersonalCode(code);
  let denied=false;try{await D.open();}catch{denied=true;}
  const q=indexedDB.open('teachapp'),raw=await new Promise((resolve,reject)=>{q.onsuccess=()=>{const db=q.result;const version=db.version,names=[...db.objectStoreNames];db.close();resolve({version,names});};q.onerror=()=>reject(q.error);});
  const all=await D.dumpAll();return {grade:all.marks[0]?.value,team:all.coachTeams[0].name,raw,denied,secretInStorage:localStorage.getItem('teachapp.personal-sync.v1')!==null};
 });
 assert.deepEqual(verified,{grade:'5',team:'Демо команда 2',raw:{version:11,names:['coach','school','state','workspace']},denied:true,secretInStorage:false});
 await page.locator('.privacy-action').click();await page.getByRole('heading',{name:'Защищённый TeachApp'}).waitFor({timeout:90000});
 assert.equal(await page.locator('.workspace-nav').count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/Демо Ученик/);
 await login();await page.locator('.workspace-nav').waitFor({timeout:90000});
 await page.waitForFunction(()=>document.querySelector('[data-student="p"][data-lesson="l"]')?.textContent.trim()==='5',{},{timeout:90000});
 assert.equal(await page.evaluate(async()=> (await import('/js/personal-sync.js')).readPersonalCode()),null);
 assert.deepEqual(errors,[]);
 console.log('WEBKIT V11 APP PASS: real static bootstrap, saved copy, native v10->v11, bad key denied, actual grade and coach write, no native fallback, session-only sync credential, lock/relogin.');
 await context.close();
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
