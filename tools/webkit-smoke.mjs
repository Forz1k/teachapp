/* Real WebKit smoke; only synthetic records in an isolated browser context. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRelay} from '../server/sync-relay.mjs';
import {createPersonalCode,personalCredentials} from '../js/personal-sync.js';
import {resolve,sep,extname} from 'node:path';
import {webkit,devices} from 'playwright';
import {timingRows,timingPdf} from '../tests/fixtures/volleypoint-timing-fixture.mjs';

const root=process.cwd();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
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
 const vault=await page.evaluate(async()=>{
  const V=await import('/tools/prototypes/local-vault.mjs'),password='synthetic-webkit-password',data={students:[{id:'synthetic',name:'Synthetic'}]},db=await V.openVaultLab('teachapp-vault-lab-webkit'),dest=await V.openVaultLab('teachapp-vault-lab-webkit-restore');
  try{await V.stageVaultLab(db,{scope:'school',password,data});const old=await V.readVaultLab(db,{scope:'school',password});const update=await V.replaceVaultLab(db,{scope:'school',password,expectedRevision:old.revision,data:{students:[{id:'synthetic',name:'Changed'}]}});const file=await V.exportVaultLab(db,{scope:'school',password});await V.restoreVaultLab(dest,{scope:'school',password,file});const restored=await V.readVaultLab(dest,{scope:'school',password});return {changed:update.revision!==old.revision,independent:restored.revision!==update.revision,name:restored.data.students[0].name,plaintext:file.includes('Changed')};}
  finally{db.close();dest.close();}
 });assert.deepEqual(vault,{changed:true,independent:true,name:'Changed',plaintext:false});
 console.log('WEBKIT VAULT LAB PASS: independent encrypted snapshot update and recovery using real IndexedDB and WebCrypto.');
 const schemaVault=await page.evaluate(async()=>{
  const V=await import('/tools/prototypes/local-vault.mjs'),A=await import('/tools/prototypes/vault-schema-adapter.mjs'),D=await import('./js/db.js'),B=await import('./js/backup.js'),password='synthetic-schema-webkit',data=Object.fromEntries(Object.keys(D.SCHEMA).map(n=>[n,[]]));
  data.classes=[{id:'c',name:'Synthetic class',gradeLevel:7}];data.students=[{id:'p',classId:'c',fullName:'Synthetic pupil',number:1,normGroup:'girls'}];data.lessons=[{id:'l',classId:'c',date:'2026-11-24',slot:1,time:'09:00'}];data.marks=[{id:'m',studentId:'p',lessonId:'l',value:'4',source:'manual'}];
  const db=await V.openVaultLab('teachapp-vault-lab-schema-webkit');try{await A.stageSchemaVault(db,{backup:{app:'teachapp',version:B.BACKUP_VERSION,data},password});const a=A.schemaVaultAdapter(db,{password});const before=await a.transaction('marks','readonly',s=>s.marks.index('lessonId_studentId').get(['l','p']));await a.transaction('marks','readwrite',s=>s.marks.put({...before,value:'5'}));const after=await a.snapshot();return {before:before.value,after:after.marks[0].value,private: (await V.exportVaultLab(db,{scope:'workspace',password})).includes('Synthetic pupil')};}finally{db.close();}
 });assert.deepEqual(schemaVault,{before:'4',after:'5',private:false});
 console.log('WEBKIT FULL SCHEMA VAULT PASS: validated synthetic school snapshot, compound index, atomic encrypted update.');
 const atomicVault=await page.evaluate(async()=>{
  const V=await import('/tools/prototypes/local-vault.mjs'),A=await import('/tools/prototypes/vault-schema-adapter.mjs'),D=await import('./js/db.js'),B=await import('./js/backup.js');
  const password='synthetic-webkit-atomic',data=Object.fromEntries(Object.keys(D.SCHEMA).map(n=>[n,[]]));data.meta=[{id:'fixture',value:1}];
  const db=await V.openVaultLab('teachapp-vault-lab-webkit-atomic');let adapter;
  try{
   await A.stageSchemaVault(db,{backup:{app:'teachapp',version:B.BACKUP_VERSION,data},password});
   adapter=A.schemaVaultAdapter(db,{password});
   const before=await V.readVaultLab(db,{scope:'workspace',password}),errors=[];
   for(const ignored of [false,true]){
    try{
     await adapter.transaction(['meta','classes'],'readwrite',async stores=>{
      await stores.meta.put({id:'new',value:2});
      await stores.classes.put({id:'c',name:'Synthetic class',gradeLevel:7});
      const request=stores.meta.add({id:'fixture',value:3});
      if(!ignored)try{await request;}catch{}
     });
     errors.push('unexpected success');
    }catch(e){errors.push(e.name);}
   }
   const after=await V.readVaultLab(db,{scope:'workspace',password});
   await adapter.transaction(['meta','classes'],'readwrite',async stores=>{
    await stores.meta.put({id:'new',value:2});await stores.classes.put({id:'c',name:'Synthetic class',gradeLevel:7});
   });
   const committed=await V.readVaultLab(db,{scope:'workspace',password});
   return {errors,unchangedRevision:before.revision===after.revision,unchangedData:JSON.stringify(before.data)===JSON.stringify(after.data),newRevision:committed.revision!==before.revision,records:[committed.data.meta.length,committed.data.classes.length]};
  }finally{adapter?.close();db.close();}
 });
 assert.deepEqual(atomicVault,{errors:['ConstraintError','ConstraintError'],unchangedRevision:true,unchangedData:true,newRevision:true,records:[2,1]});
 console.log('WEBKIT VAULT ATOMICITY PASS: caught and ignored request failures preserve encrypted revision and both stores; valid commit succeeds.');


 const keyContext=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
 try{
  const url=origin+'/vault-session-smoke.html';
  await keyContext.route(url,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><title>Vault key session LAB</title>'}));
  const tab=await keyContext.newPage();await tab.goto(url);await tab.bringToFront();
  const keyTest=await tab.evaluate(async()=>{
   const {openVaultLab,stageVaultLab,openVaultReadSessionLab}=await import('/tools/prototypes/local-vault.mjs');
   const {vaultSessionLifecycleLab}=await import('/tools/prototypes/vault-session-lifecycle-lab.mjs');
   const db=await openVaultLab('teachapp-vault-lab-webkit-key'),password='synthetic-webkit-key-session';
   let lifecycle;
   try{
    await stageVaultLab(db,{scope:'school',password,data:{students:[{id:'p',name:'Synthetic pupil'}]}});
    lifecycle=vaultSessionLifecycleLab({openScopeSession:options=>openVaultReadSessionLab(db,options)});
    await lifecycle.unlock('school',password);
    const before=(await lifecycle.read('school')).data.students[0].id;
    const pending=lifecycle.read('school').then(()=>false,e=>/заблокирован/.test(e.message));
    window.dispatchEvent(new Event('pagehide'));
    const invalidated=await pending,locked=!lifecycle.isUnlocked('school');
    await lifecycle.unlock('school',password);
    const after=(await lifecycle.read('school')).data.students[0].id;
    return {before,after,locked,invalidated};
   }finally{lifecycle?.dispose();db.close();}
  });assert.deepEqual(keyTest,{before:'p',after:'p',locked:true,invalidated:true});
  console.log('WEBKIT VAULT KEY SESSION PASS: native WebCrypto key, pagehide event, pending read blocked, explicit reopen.');
 }finally{await keyContext.close();}

 const vaultUiContext=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
 try{
  const tab=await vaultUiContext.newPage(),errors=[];tab.on('pageerror',e=>errors.push(e.message));
  await tab.goto(origin+'/tools/prototypes/vault-ui/index.html?id=webkit-ui');await tab.bringToFront();
  if(await tab.evaluate(()=>typeof navigator.locks?.request==='function'&&typeof BroadcastChannel==='function')){
   await tab.getByRole('button',{name:'Создать демо-набор'}).click();
   await tab.getByText('Демо-набор активен. Откройте нужную область.').waitFor();
   const school=tab.locator('[data-scope=school]'),coach=tab.locator('[data-scope=coach]');
   await school.getByLabel('Пароль').fill('incorrect-demo');
   await school.getByRole('button',{name:'Открыть',exact:true}).click();
   await school.getByText('Введите указанный демо-пароль.').waitFor();
   assert.equal(await school.locator('.result').textContent(),'');
   await school.getByLabel('Пароль').fill('teachapp-school-demo');
   await school.getByRole('button',{name:'Открыть',exact:true}).click();
   await school.locator('.result').filter({hasText:'Записей: 1'}).waitFor();
   assert.equal(await school.getByLabel('Пароль').inputValue(),'');
   assert.equal(await coach.locator('.state').textContent(),'Заблокировано');
   await tab.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
   assert.equal(await school.locator('.result').textContent(),'');
   assert.equal(await school.locator('.state').textContent(),'Заблокировано');
   await tab.reload();await tab.getByText('Демо-набор активен. Откройте нужную область.').waitFor();
   assert.equal(await school.locator('.result').textContent(),'');
   await school.getByLabel('Пароль').fill('teachapp-school-demo');
   await school.getByRole('button',{name:'Открыть',exact:true}).click();
   await school.locator('.result').filter({hasText:'Записей: 1'}).waitFor();
   // A second real tab sends only the lock control message, never fixture data.
   const sender=await vaultUiContext.newPage();
   try{
    await sender.goto(origin+'/tools/prototypes/vault-ui/index.html?id=webkit-ui');
    await tab.bringToFront();await tab.waitForFunction(()=>document.visibilityState==='visible');
    if(await school.getByRole('button',{name:'Открыть',exact:true}).isEnabled()){
     await school.getByLabel('Пароль').fill('teachapp-school-demo');await school.getByRole('button',{name:'Открыть',exact:true}).click();
    }
    await school.locator('.result').filter({hasText:'Записей: 1'}).waitFor();
    await sender.evaluate(()=>{window.labLockSender=new BroadcastChannel('teachapp-vault-lock-lab-webkit-ui');window.labLockSender.postMessage({kind:'lock-all',version:1});});
    await tab.getByText('Получена блокировка всех вкладок демо-набора.').waitFor();
    assert.equal(await school.locator('.result').textContent(),'');
   }finally{await sender.close();}
   await tab.bringToFront();await tab.waitForFunction(()=>document.visibilityState==='visible');
   await school.getByLabel('Пароль').fill('teachapp-school-demo');
   await school.getByRole('button',{name:'Открыть',exact:true}).click();
   await school.locator('.result').filter({hasText:'Записей: 1'}).waitFor();
   await tab.getByRole('button',{name:'Заблокировать все вкладки',exact:true}).click();
   assert.equal(await school.locator('.result').textContent(),'');
   assert.ok(await tab.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   console.log('WEBKIT VAULT UI LAB PASS: synthetic setup, scoped unlock, wrong demo password, pagehide, reload, manual lock and mobile layout.');
  }else{
   await tab.getByText(/Неверный ID набора или Web Locks недоступен|Межвкладочная блокировка LAB недоступна/).waitFor();
   assert.equal(await tab.locator('#scopes').isVisible(),false);
   console.log('WEBKIT VAULT UI LAB: Web Locks unavailable, fail-closed confirmed.');
  }
  assert.deepEqual(errors,[]);
 }finally{await vaultUiContext.close();}



 // A separate same-origin context with two actual tabs, no application boot
 // or service worker; all records and keys below are synthetic.
 const routingContext=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
 try{
  const fixtureUrl=origin+'/vault-routing-smoke.html';
  await routingContext.route(fixtureUrl,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><title>Vault routing LAB smoke</title>'}));
  const a=await routingContext.newPage(),b=await routingContext.newPage();
  await Promise.all([a.goto(fixtureUrl),b.goto(fixtureUrl)]);
  const supported=await a.evaluate(()=>typeof navigator.locks?.request==='function');
  if(!supported){
   assert.equal(await a.evaluate(async()=>{const {vaultRouterLab}=await import('/tools/prototypes/vault-router-lab.mjs');try{vaultRouterLab('webkit-tabs');return false;}catch(e){return /Web Locks/.test(e.message);}}),true);
   console.log('WEBKIT VAULT ROUTER: Web Locks unavailable; verified fail-closed, cross-tab test not supported.');
  }else{
   const init=async()=>{const {vaultRouterLab}=await import('/tools/prototypes/vault-router-lab.mjs');window.labRouter=vaultRouterLab('webkit-tabs');};
   await Promise.all([a.evaluate(init),b.evaluate(init)]);
   const password='synthetic-webkit-router-password',lock='teachapp-vault-routing-lab-webkit-tabs';
   await a.evaluate(async password=>{await labRouter.initialize();await labRouter.put('meta',{id:'fixture',value:1});await labRouter.stage({password});},password);
   await a.evaluate(lock=>{window.holding=navigator.locks.request(lock,{mode:'exclusive'},()=>new Promise(resolve=>{window.releaseRoutingLock=resolve;}));},lock);
   await a.waitForFunction(()=>typeof window.releaseRoutingLock==='function');
   await a.evaluate(password=>{window.activation=labRouter.activate({password}).then(s=>({generation:s.generation}),e=>({error:e.message}));},password);
   await a.waitForFunction(async lock=>(await navigator.locks.query()).pending.filter(x=>x.name===lock).length===1,lock);
   await b.evaluate(password=>{window.queuedWrite=labRouter.put('meta',{id:'fixture',value:2},{password}).then(()=>({ok:true}),e=>({error:e.message}));},password);
   await a.waitForFunction(async lock=>(await navigator.locks.query()).pending.filter(x=>x.name===lock).length===2,lock);
   await a.evaluate(()=>window.releaseRoutingLock());
   assert.deepEqual(await a.evaluate(()=>window.activation),{generation:2});
   assert.deepEqual(await b.evaluate(()=>window.queuedWrite),{ok:true});
   assert.equal(await b.evaluate(async password=>(await labRouter.snapshot({password})).meta[0].value,password),2);
   const original=await a.evaluate(async()=>{const {openPlainSchemaLab,readPlainSchemaLab}=await import('/tools/prototypes/vault-migration-rehearsal.mjs');const db=await openPlainSchemaLab('teachapp-plain-lab-source-webkit-tabs');try{return (await readPlainSchemaLab(db)).meta[0].value;}finally{db.close();}});
   assert.equal(original,1);
   assert.equal(await b.evaluate(async()=>{try{await labRouter.snapshot({password:'incorrect-webkit-key'});return false;}catch(e){return /неверный пароль/.test(e.message);}}),true);
   await b.evaluate(password=>labRouter.rollback({password}),password);
   assert.equal(await a.evaluate(async()=>(await labRouter.snapshot()).meta[0].value),2);
   console.log('WEBKIT VAULT ROUTER PASS: real two-tab Web Locks, queued encrypted write, no plaintext fallback, explicit rollback.');
  }
 }finally{await routingContext.close();}


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
 // Teacher preparation and all-class period review on a real mobile viewport.
 await page.getByRole('button',{name:'Подготовить следующий урок',exact:true}).click();
 await page.getByRole('heading',{name:'Подготовка к уроку',exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'preparation overflow');
 await page.locator('.sheet.show').getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Закрытие периода',exact:true}).click();
 await page.locator('.period-class-summary').waitFor();assert.equal(await page.locator('.period-class-summary').count(),1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'period overview overflow');
 await page.locator('.sheet.show').getByRole('button',{name:'Закрыть',exact:true}).click();
 // KTP checkpoint, replacement and independent copy in the real mobile UI.
 const ktpId=await page.evaluate(async()=>{const S=await import('./js/store.js'),H=await import('./js/ktp-history.js');const k=await S.addKtp({name:'Синтетическое КТП',classIds:[]});await S.appendKtpTopics(k.id,[{name:'Бег'},{name:'Прыжок'}]);await H.saveKtpVersion(k.id,'Первая редакция');await S.replaceKtpTopics(k.id,[{name:'Новая тема'}]);await (await import('./js/screens/ktp.js')).openKtpHistory(k.id);return k.id;});
 await page.locator('.sheet.show').getByRole('heading',{name:'История версий КТП',exact:true}).waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('.sheet.show button')].filter(n=>n.textContent==='Создать новый КТП из версии').length===2);
 assert.equal(await page.locator('.sheet.show').getByRole('button',{name:'Создать новый КТП из версии',exact:true}).count(),2);
 const firstVersion=page.locator('.sheet.show .coach-card').filter({has:page.getByRole('heading',{name:'Первая редакция',exact:true})});
 await firstVersion.locator('summary').click();
 await firstVersion.getByText('Удалено: Бег',{exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'KTP history overflow');
 await firstVersion.getByRole('button',{name:'Создать новый КТП из версии',exact:true}).click();
 await page.locator('.dialog-backdrop.show .dialog input[type=text]').fill('Восстановленная редакция');
 await page.locator('.dialog-backdrop.show .dialog').getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.locator('.dialog-backdrop.show .dialog').getByRole('heading',{name:'Создать независимую копию?',exact:true}).waitFor();
 await page.locator('.dialog-backdrop.show .dialog').getByRole('button',{name:'Создать',exact:true}).click();
 await page.locator('.sheet.show').getByRole('heading',{name:'Восстановленная редакция',exact:true}).waitFor();
 const restoredKtp=await page.evaluate(async id=>{const S=await import('./js/store.js');const copy=S.state.ktp.find(k=>k.name==='Восстановленная редакция');return {source:S.topicsOfKtp(id).map(t=>t.name),copy:S.topicsOfKtp(copy.id).map(t=>({name:t.name,confirmed:t.activitiesConfirmed})),classes:copy.classIds};},ktpId);
 assert.deepEqual(restoredKtp,{source:['Новая тема'],copy:[{name:'Бег',confirmed:false},{name:'Прыжок',confirmed:false}],classes:[]});
 await page.evaluate(async()=>{(await import('./js/ui.js')).closeSheet();});
 console.log('WEBKIT KTP HISTORY PASS: actual history sheet, comparison, confirmed independent copy, original untouched, unreviewed load tags, mobile viewport.');
 // All four 5.3 school tools through real controls.
 const schoolFixture=await page.evaluate(async f=>{
  const S=await import('./js/store.js'),M=await import('./js/model.js'),P=await import('./js/teacher-portfolio.js'),d=M.todayIso();
  const student=S.state.students.find(s=>s.id===f.studentId),r=await P.saveSchoolCompetition({name:'Синтетическая олимпиада',eventType:'olympiad',stage:'school',date:d,time:'',venue:'',status:'completed',note:'',participants:[{studentId:student.lineageId||student.id,className:'',status:'participated',result:'10 баллов',place:1}]});
  await (await import('./js/screens/teacher-portfolio.js')).openSchoolCompetitions();return {id:r.id,date:d};
 },fixture);
 const shown=page.locator('.sheet.show'),dialog=page.locator('.dialog-backdrop.show .dialog');
 await shown.getByRole('heading',{name:'Олимпиады и школьные мероприятия',exact:true}).waitFor();
 await shown.getByRole('button',{name:'Подготовить следующий этап',exact:true}).click();
 await shown.getByRole('heading',{name:'Следующий этап · Муниципальный',exact:true}).waitFor();
 await shown.getByRole('checkbox').check();
 // Reproduce the update notification while a long form is open; do not force-click through it.
 await page.evaluate(()=>{if(!document.querySelector('.update-banner')){const b=document.createElement('div');b.className='update-banner';b.dataset.testBanner='yes';b.textContent='Доступна новая версия TeachApp';document.body.append(b);}});
 assert.equal(await page.locator('.update-banner').first().evaluate(n=>getComputedStyle(n).visibility),'hidden');
 await shown.getByLabel('Срок заявки',{exact:true}).fill(schoolFixture.date);
 await shown.getByRole('button',{name:'Создать следующий этап',exact:true}).click();
 await dialog.getByRole('button',{name:'Создать',exact:true}).click();
 await shown.getByText('Предыдущий этап: Школьный',{exact:true}).waitFor();
 await page.evaluate(()=>document.querySelector('.update-banner[data-test-banner]')?.remove());
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'olympiad overflow');
 await page.evaluate(async f=>{const S=await import('./js/store.js');(await import('./js/screens/health.js')).openLessonRestrictions(S.state.lessons.find(l=>l.id===f.lessonId));},fixture);
 await shown.getByRole('button',{name:'Альтернативные задания урока',exact:true}).click();
 await shown.getByRole('heading',{name:'Альтернативные задания урока',exact:true}).waitFor();
 await shown.getByRole('button',{name:'Подобрать задание',exact:true}).click();
 await shown.getByRole('button',{name:'Своё теоретическое задание',exact:true}).click();
 await shown.getByLabel('Задание',{exact:true}).fill('Синтетическое теоретическое задание');
 await shown.getByRole('button',{name:'Сохранить задание',exact:true}).click();
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
 await shown.getByText('Сохранённое задание · Запланировано',{exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'alternatives overflow');
 await page.evaluate(async()=>{const S=await import('./js/store.js');await S.saveNorm({name:'Синтетический прыжок',activityId:'standing',unit:'см',direction:'max',scale:[100,120,140,160,180]});await (await import('./js/screens/school-tools.js')).openNormAssignments();});
 await shown.getByRole('button',{name:'+ Назначить норматив',exact:true}).click();
 await shown.getByRole('heading',{name:'Назначить норматив классу',exact:true}).waitFor().catch(async e=>{throw Error('Norm form: '+JSON.stringify({errors,sheet:await shown.textContent()})+' '+e.message);});
 await shown.getByLabel('Кому назначено',{exact:true}).selectOption('selected');
 await shown.getByRole('checkbox').check();
 await shown.getByLabel('Минимум результатов по критерию',{exact:true}).fill('2');
 await shown.getByRole('button',{name:'Сохранить назначение',exact:true}).click();
 await shown.getByText(/минимум 2 · выбранные ученики: 1/).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'assignment overflow');
 await page.evaluate(async()=>{await (await import('./js/screens/library.js')).openCircuitBuilder();});
 await shown.getByRole('heading',{name:'Конструктор круговой тренировки',exact:true}).waitFor();
 await shown.getByRole('button',{name:'Сохранить станцию в библиотеку',exact:true}).first().click();
 await dialog.locator('input[type=text]').fill('Синтетическая станция');
 await dialog.getByRole('button',{name:'Сохранить',exact:true}).click();
 await shown.locator('select[aria-label="Библиотека станций"] option').filter({hasText:'Синтетическая станция'}).waitFor({state:'attached'});
 await shown.getByLabel('Библиотека станций',{exact:true}).selectOption({label:'Синтетическая станция'});
 await shown.getByRole('button',{name:'Добавить станцию из библиотеки',exact:true}).click();
 await shown.getByRole('heading',{name:'Станция 3',exact:true}).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'station overflow');
 const schoolRecords=await page.evaluate(async()=>{const W=await import('./js/workbench.js');return {events:(await W.listWork('schoolCompetition')).length,alternatives:(await W.listWork('lessonAlternative')).length,assignments:(await W.listWork('normAssignment')).map(a=>a.minAttempts),stations:(await W.listWork('stationTemplate')).length};});
 assert.deepEqual(schoolRecords,{events:2,alternatives:1,assignments:[2],stations:1});
 await page.evaluate(async()=>{(await import('./js/ui.js')).closeSheet();});
 console.log('WEBKIT SCHOOL NEXT PASS: linked olympiad and deadline, persisted lesson task, targeted norm criteria and saved/reused station, no viewport overflow.');
 // Actual mobile live clock, persistence, pause/resume and private player-time view.
 const timedId=await page.evaluate(async()=>{const C=await import('./js/coach.js'),M=await import('./js/model.js'),team=await C.saveTeam({name:'Тест времени'}),players=[];for(let i=0;i<7;i++)players.push(await C.savePlayer({teamId:team.id,name:'Спортсменка '+i,number:i,position:'universal'}));const ids=players.map(p=>p.id),d=await C.startDetailedMatch({teamId:team.id,date:M.todayIso(),teamName:team.name,opponent:'Гости',competition:'',venue:'',roster:ids,ourPlayers:players,awayPlayers:[],lineup:ids.slice(0,6),awayLineup:[],libero:null,scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'ours'});(await import('./js/screens/match-protocol.js')).openDetailedMatch(d,()=>{},async()=>{});return d.id;});
 await shown.getByRole('button',{name:'Запустить время',exact:true}).click();
 await shown.getByRole('button',{name:'Пауза времени',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.court-time-panel [data-court-time]')?.textContent==='0:01'||Number(document.querySelector('.court-time-panel [data-court-time]')?.textContent.split(':').at(-1))>=2);
 await shown.getByRole('button',{name:'Тайм-аут Тест времени',exact:true}).click();
 await shown.getByRole('button',{name:'Возобновить время',exact:true}).waitFor();
 const beforeClock=await shown.locator('.court-time-panel [data-court-time]').first().textContent();await page.waitForTimeout(1100);assert.equal(await shown.locator('.court-time-panel [data-court-time]').first().textContent(),beforeClock);
 await shown.getByRole('button',{name:'Возобновить время',exact:true}).click();await shown.getByRole('button',{name:'Пауза времени',exact:true}).waitFor();
 await shown.getByRole('button',{name:'Пауза времени',exact:true}).click();await shown.getByRole('button',{name:'Возобновить время',exact:true}).waitFor();
 await shown.getByRole('button',{name:'Статистика',exact:true}).click();await shown.getByRole('heading',{name:'Игровое время',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'court time overflow');
 const persistedClock=await page.evaluate(async id=>{const C=await import('./js/coach.js'),V=await import('./js/match-protocol.js'),d=(await C.loadCoach()).coachLive.find(x=>x.id===id),t=V.courtTime(V.replayDetailed(d));return {running:t.running,measured:t.measured,elapsed:t.elapsedMs,events:d.events.map(e=>e.type),players:Object.keys(t.players.ours).length};},timedId);
 assert.equal(persistedClock.running,false);assert.equal(persistedClock.measured,true);assert.ok(persistedClock.elapsed>=1000);assert.equal(persistedClock.players,6);assert.deepEqual(persistedClock.events,['clock','timeout','clock','clock']);
 await page.evaluate(async id=>{const C=await import('./js/coach.js'),d=(await C.loadCoach()).coachLive.find(x=>x.id===id);(await import('./js/screens/match-protocol.js')).openDetailedMatch(d,()=>{},async()=>{});},timedId);
 await shown.getByRole('button',{name:'Возобновить время',exact:true}).waitFor();assert.equal(await shown.locator('.court-time-panel [data-court-time]').first().textContent(),(await page.evaluate(async id=>{const C=await import('./js/coach.js'),V=await import('./js/match-protocol.js'),T=await import('./js/court-time.js');return T.courtTimeLabel(V.courtTime(V.replayDetailed((await C.loadCoach()).coachLive.find(x=>x.id===id))).elapsedMs);},timedId)));
 await page.evaluate(async()=>{(await import('./js/ui.js')).closeSheet();});
 console.log('WEBKIT COURT TIME PASS: live tick, timeout pause, explicit resume, persisted exact clock and six players, reopen and mobile stats.');
 // Isolated rehearsal: no real coach records or public publishing, even when offline.
 const rehearsalContext=await browser.newContext({...devices['iPhone 13'],locale:'ru-RU',serviceWorkers:'allow'});
 try{
  const rp=await rehearsalContext.newPage(),requests=[];
  rp.on('request',req=>{if(!req.url().startsWith(origin+'/'))requests.push(req.url());});
  await rp.goto(origin+'/index.html');await rp.locator('.workspace-nav').waitFor();
  const before=await rp.evaluate(async()=>JSON.stringify(await (await import('./js/coach.js')).loadCoach()));
  const open=()=>rp.evaluate(async()=>{(await import('./js/screens/match-protocol.js')).openRehearsal();});
  await open();await rp.getByRole('button',{name:'Быстрый тест · до 5 очков',exact:true}).click();
  await rp.locator('.vp-board-points').waitFor();
  assert.match(await rp.locator('.match-live-label').textContent(),/ТЕСТ/);
  assert.equal(await rp.locator('.vp-mini-player').count(),12);
  await rehearsalContext.setOffline(true);
  await rp.locator('.vp-points .vp-ours').click();await rp.locator('[data-reason="tip"]').click();await rp.locator('.vp-author-grid [data-player]').first().click();
  await rp.waitForFunction(()=>document.querySelector('.vp-score-side.ours strong')?.textContent==='1');
  assert.match(await rp.locator('[data-live-save-status]').textContent(),/Сохранено/);
  await rehearsalContext.setOffline(false);
  await rp.reload();await rp.locator('.workspace-nav').waitFor();
  await open();await rp.getByRole('button',{name:'Продолжить / открыть тест',exact:true}).click();
  await rp.waitForFunction(()=>document.querySelector('.vp-score-side.ours strong')?.textContent==='1');
  await rp.locator('.vp-undo').click();await rp.waitForFunction(()=>document.querySelector('.vp-score-side.ours strong')?.textContent==='0');
  assert.equal(await rp.evaluate(async()=>JSON.stringify(await (await import('./js/coach.js')).loadCoach())),before);
  assert.equal(await rp.evaluate(()=>JSON.parse(localStorage.getItem('teachapp.live.rehearsal.v1')).events.length),0);
  assert.deepEqual(requests,[]);
 }finally{await rehearsalContext.close();}
 console.log('WEBKIT LIVE REHEARSAL PASS: offline score, reload, undo, untouched coach data and no external requests.');

 const vpFixture=await page.evaluate(async rows=>{const C=await import('./js/coach.js'),V=await import('./js/volleypoint-import.js'),U=await import('./js/screens/volleypoint-import.js');const report=V.parseVolleyRows(rows),team=await C.saveTeam({name:'История VolleyPoint'}),mapping={};for(const p of report.teams[0].players){const r=await C.savePlayer({teamId:team.id,name:p.name,number:p.number,position:'universal'});mapping[p.number]=r.id;}const input={...V.buildVolleyImport(report,0,mapping),teamId:team.id};delete input.imported.timing;input.opponent='Старое имя соперника';const m=await C.saveVolleyImport(input),view=C.teamView(await C.loadCoach(),team.id);U.openImportedReport(m,view,()=>U.openVolleyImport(team,view,async()=>{},{matchId:m.id}));return {teamId:team.id,matchId:m.id,playerId:mapping[1]};},timingRows);
 await shown.getByRole('heading',{name:'Игровое время по PDF',exact:true}).waitFor();await shown.getByRole('button',{name:'Дополнить из исходного PDF',exact:true}).click();
 await shown.getByLabel('PDF VolleyPoint',{exact:true}).setInputFiles({name:'synthetic-volley.pdf',mimeType:'application/pdf',buffer:timingPdf()});
 const timingPreview=shown.locator('[aria-label="Предварительный расчёт времени"]');await timingPreview.waitFor();await shown.getByRole('button',{name:'Дополнить существующий матч',exact:true}).waitFor();
 assert.match(await timingPreview.textContent(),/7:00/);assert.match(await timingPreview.textContent(),/0:00–4:00/);
 await shown.getByLabel('Подтверждаю прежние сопоставления и дополнение матча',{exact:true}).check();await shown.getByRole('button',{name:'Дополнить существующий матч',exact:true}).click();
 await page.waitForFunction(async f=>{const C=await import('./js/coach.js'),matches=(await C.loadCoach()).coachMatches.filter(m=>m.teamId===f.teamId);return matches.length===1&&matches[0].id===f.matchId&&!!matches[0].imported.timing;},vpFixture);
 await page.evaluate(async f=>{const C=await import('./js/coach.js'),S=await import('./js/screens/coach.js');S.openCoachSearchResult(await C.loadCoach(),{kind:'player',teamId:f.teamId,id:f.playerId},async()=>{});},vpFixture);
 await shown.getByRole('heading',{name:'VolleyPoint · восстановлено по PDF',exact:true}).waitFor();await shown.getByRole('button',{name:'Весь архив',exact:true}).click();
 assert.match(await shown.textContent(),/По длительности партий: 7:00/);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'historical time overflow');
 await page.evaluate(async()=>{(await import('./js/ui.js')).closeSheet();});
 console.log('WEBKIT VOLLEYPOINT TIME PASS: actual synthetic PDF upload, timing preview, re-import same ID with preserved record, historical player profile and mobile layout.');
 // Real mobile lineup screen using a persisted imported match and a completed
 // detailed synthetic match. No real names/data in the fixture.
 const lineupFixture=await page.evaluate(async f=>{
  const C=await import('./js/coach.js'),V=await import('./js/match-protocol.js'),D=await import('./js/db.js'),M=await import('./js/model.js');
  const data=await C.loadCoach(),team=data.coachTeams.find(t=>t.id===f.teamId),players=data.coachPlayers.filter(p=>p.teamId===team.id),ordered=[players.find(p=>p.id===f.playerId),...players.filter(p=>p.id!==f.playerId)].slice(0,6).map(p=>p.id);
  let d=await C.startDetailedMatch({teamId:team.id,date:M.todayIso(),teamName:team.name,opponent:'Синтетический LIVE',competition:'',venue:'',roster:players.map(p=>p.id),ourPlayers:players,awayPlayers:[],lineup:ordered,awayLineup:[],libero:null,scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'ours'});
  const start=Date.parse(d.startedAt),add=(e,t)=>{d=V.detailEvent(d,e,new Date(start+t*1000).toISOString());d.revision++;};add({type:'clock',running:true},0);
  for(let i=1;i<=15;i++)add({type:'rally',side:'ours',kind:'kill',player:ordered[0]},i*60);
  add({type:'next',lineup:ordered,awayLineup:[],serve:'ours'},1000);add({type:'clock',running:true},1000);
  for(let i=1;i<=15;i++)add({type:'rally',side:'ours',kind:'point'},1000+i*60);
  await D.put('coachLive',d);const m=await C.finishLiveMatch(d.id,d.revision),view=C.teamView(await C.loadCoach(),team.id);
  (await import('./js/screens/lineup-analysis.js')).openLineupAnalysis(view,{initial:{from:'',to:''}});
  return {matchId:m.id,playerId:f.playerId,teamId:team.id};
 },vpFixture);
 await shown.getByRole('heading',{name:'Аналитика игровых составов',exact:true}).waitFor();
 assert.match(await shown.textContent(),/LIVE-розыгрыши: 30/);
 assert.match(await shown.textContent(),/Совместное время LIVE: 30:00/);
 await shown.getByLabel('Источник составов',{exact:true}).selectOption('imported');assert.match(await shown.textContent(),/LIVE-розыгрыши: 0/);
 await shown.getByLabel('Вид состава',{exact:true}).selectOption('orderedStarts');assert.match(await shown.textContent(),/P1/);assert.match(await shown.textContent(),/Выиграно партий/);
 await shown.getByLabel('Вид состава',{exact:true}).selectOption('pairs');await shown.getByLabel('Игрок в составе',{exact:true}).selectOption(lineupFixture.playerId);
 assert.match(await shown.textContent(),/На подаче \(break-point\): нет данных/);assert.match(await shown.textContent(),/Длительность подтверждённых полных партий PDF: 7:00/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'lineup analysis overflow');
 await page.evaluate(async f=>{const C=await import('./js/coach.js'),S=await import('./js/screens/coach.js');S.openCoachSearchResult(await C.loadCoach(),{kind:'player',teamId:f.teamId,id:f.playerId},async()=>{});},lineupFixture);
 await shown.getByRole('heading',{name:'Результативность за 10 минут LIVE',exact:true}).waitFor();assert.match(await shown.textContent(),/Отмеченные личные очки за 10 минут: 5/);
 await page.evaluate(async()=>{(await import('./js/ui.js')).closeSheet();});
 console.log('WEBKIT LINEUP ANALYSIS PASS: actual persisted LIVE and VolleyPoint, measured joint time, source and player filters, starting positions and player points per 10 minutes.');
 // Actual weekly dynamics: two weeks with different effort coverage, plus the
 // persisted match time. The test uses a synthetic training date range.
 const trainingFixture=await page.evaluate(async f=>{
  const C=await import('./js/coach.js'),M=await import('./js/model.js'),U=await import('./js/screens/training-dynamics.js'),today=M.todayIso(),week=M.addDays(today,1-M.weekdayOf(today)),prev=M.addDays(week,-7);
  const training={teamId:f.teamId,time:'12:00',title:'Синтетическая тренировка',minutes:60,exercises:[],roster:[f.playerId],held:true,attendance:{[f.playerId]:'present'}};
  await C.saveTraining({...training,date:prev,effort:{[f.playerId]:{minutes:50,rpe:4}}});
  await C.saveTraining({...training,date:week});
  U.openTrainingDynamics(C.teamView(await C.loadCoach(),f.teamId),{playerId:f.playerId,initial:{from:prev,to:today}});
  return {week,prev};
 },lineupFixture);
 await shown.getByRole('heading',{name:'Недельная динамика подготовки',exact:true}).waitFor();
 assert.match(await shown.textContent(),/sRPE: 200/);assert.match(await shown.textContent(),/Фактические замеры: 0\/1/);
 assert.match(await shown.textContent(),/LIVE 30:00/);
 await shown.getByLabel('Спортсменка для нагрузки',{exact:true}).selectOption('');assert.match(await shown.textContent(),/сумма записей спортсменка × занятие/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'weekly dynamics overflow');
 await page.evaluate(async()=>{(await import('./js/ui.js')).closeSheet();});
 console.log('WEBKIT TRAINING DYNAMICS PASS: persisted training, missing effort coverage, match exposure, player filter and mobile layout.');
 // Historical PDF video journal is usable without a file for notes; no guessed timestamps.
 await page.evaluate(async f=>{const C=await import('./js/coach.js'),W=await import('./js/workbench.js'),U=await import('./js/screens/video-review.js'),data=await C.loadCoach(),m=data.coachMatches.find(m=>m.id===f.matchId);await W.saveWork({kind:'videoReview',matchId:m.id,anchors:[{index:1,seconds:5},{index:4,seconds:90}],notes:[]});await U.openVideoReview(m,{players:data.coachPlayers.filter(p=>p.teamId===f.teamId)});},vpFixture);
 await shown.getByRole('heading',{name:'Видеоразбор · Старое имя соперника',exact:true}).waitFor();
 const unlinked=shown.locator('[data-review-rally="2"]');assert.match(await unlinked.textContent(),/Без привязки/);assert.equal(await unlinked.getByRole('button',{name:/Без привязки/}).isDisabled(),true);
 assert.match(await shown.locator('[data-review-rally="1"]').textContent(),/0:05/);
 await shown.getByLabel('Только привязанные события',{exact:true}).check();assert.equal(await shown.locator('[data-review-rally]').count(),2);
 await shown.getByLabel('Только привязанные события',{exact:true}).uncheck();
 await shown.locator('[data-review-rally="2"]').getByRole('button',{name:'☆ Добавить в подборку',exact:true}).click();await shown.locator('[data-review-rally="2"]').getByRole('button',{name:'★ Убрать из подборки',exact:true}).waitFor();
 await shown.getByLabel('Только подборка',{exact:true}).check();assert.equal(await shown.locator('[data-review-rally]').count(),1);assert.match(await shown.textContent(),/Без привязки/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'historical video review overflow');
 await shown.getByRole('button',{name:'Закрыть',exact:true}).click();
 console.log('WEBKIT HISTORICAL VIDEO PASS: imported journal, manually saved anchors, unlinked seek disabled, favorite and linked filters, local-only UI.');

 await page.evaluate(async()=>{
  const {openTeamSkillMap}=await import('./js/screens/coach-tests.js'),{testPresets}=await import('./js/coach-tests.js'),{todayIso}=await import('./js/model.js');
  const team={id:'synthetic-skill-team',name:'Синтетическая команда'},players=[{id:'p',teamId:team.id,name:'Демо Полное',number:1},{id:'q',teamId:team.id,name:'Демо Малое',number:2},{id:'r',teamId:team.id,name:'Демо Без записи',number:3}];
  const result=(attempts,success)=>({status:'done',attempts,success,errors:attempts-success,target:null,value:null,adapted:false,note:''});
  openTeamSkillMap(team,{players,tests:[{id:'synthetic-skill-test',teamId:team.id,date:todayIso(),definition:testPresets.serve,results:{p:result(15,10),q:result(2,1)}}]});
 });
 await shown.getByRole('heading',{name:'Покрытие наблюдений',exact:true}).waitFor();
 assert.match(await shown.textContent(),/Показано спортсменок: 3 из 3/);
 await shown.getByLabel('Только неполные наблюдения',{exact:true}).check();
 assert.match(await shown.textContent(),/Показано спортсменок: 2 из 3/);
 assert.doesNotMatch(await shown.textContent(),/Демо Полное/);
 assert.match(await shown.textContent(),/Демо Малое/);assert.match(await shown.textContent(),/Демо Без записи/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'skill coverage overflow');
 await shown.getByRole('button',{name:'Закрыть',exact:true}).click();
 console.log('WEBKIT SKILL COVERAGE PASS: synthetic coverage counts, incomplete filter and mobile layout.');



 await page.evaluate(async()=>{(await import('./js/screens/studio.js')).openStudio({scope:'test',template:'result',team:'Демо',opponent:'Гости',score:'2:1'});});
 await page.locator('.studio-editor canvas').waitFor();assert.equal(await page.locator('.studio-editor textarea[aria-label="Текст публикации"]').inputValue(),'Итоговый результат\n\nДемо — Гости\n\n2:1');
 await page.getByRole('button',{name:'Сохранить фирменный стиль',exact:true}).click();
 assert.match(await page.locator('.studio-status').textContent(),/сохранено/);
 await page.getByLabel('Дизайн',{exact:true}).selectOption('arena');await page.getByLabel('Положение фотографии',{exact:true}).selectOption('top');await page.getByRole('textbox',{name:'Название оформления',exact:true}).fill('Арена');await page.getByRole('button',{name:'Сохранить как пресет',exact:true}).click();assert.equal(await page.getByRole('combobox',{name:'Сохранённое оформление',exact:true}).inputValue(),'Арена');await page.getByLabel('Дизайн',{exact:true}).selectOption('editorial');await page.getByRole('button',{name:'Применить оформление',exact:true}).click();assert.equal(await page.getByLabel('Дизайн',{exact:true}).inputValue(),'arena');assert.equal(await page.getByLabel('Положение фотографии',{exact:true}).inputValue(),'top');
 assert.equal(await page.locator('.studio-editor textarea[aria-label="Текст публикации"]').inputValue(),'Итоговый результат\n\nДемо — Гости\n\n2:1');
 await page.getByRole('textbox',{name:'Дата, время и место встречи',exact:true}).fill('12 декабря · зал');assert.match(await page.locator('.studio-kit-summary').textContent(),/6 PNG \+ 2 TXT/);assert.equal(await page.getByRole('button',{name:'Скачать комплект матча ZIP',exact:true}).isEnabled(),true);
 await page.getByLabel('Масштаб фотографии',{exact:true}).fill('150');
 assert.equal(await page.getByLabel('Масштаб фотографии',{exact:true}).inputValue(),'150');
 await page.getByRole('button',{name:'Сохранить фирменный стиль',exact:true}).click();
 assert.equal(await page.evaluate(async()=> (await import('./js/media-studio.js')).readStudioStyle('test').photoZoom),150);
 await page.getByRole('button',{name:'+ Текстовый слой',exact:true}).click();
 await page.getByLabel('Текст слоя 1',{exact:true}).fill('Синтетический слой');
 await page.getByLabel('Выравнивание текста слоя 1',{exact:true}).selectOption('center');
 await page.getByLabel('Вертикальное выравнивание слоя 1',{exact:true}).selectOption('bottom');
 await page.locator('.studio-editor fieldset').getByRole('button',{name:'Дублировать слой',exact:true}).first().click();
 assert.equal(await page.getByLabel('Текст слоя 2',{exact:true}).inputValue(),'Синтетический слой');
 assert.equal(await page.getByLabel('Выравнивание текста слоя 2',{exact:true}).inputValue(),'center');
 assert.equal(await page.getByLabel('Вертикальное выравнивание слоя 2',{exact:true}).inputValue(),'bottom');
 assert.equal(await page.getByLabel('X (%) слоя 2',{exact:true}).inputValue(),'13');
 await page.locator('.studio-editor fieldset').getByRole('button',{name:'Удалить слой',exact:true}).last().click();
 await page.getByRole('button',{name:'+ Прямоугольник',exact:true}).click();
 await page.getByLabel('X (%) слоя 2',{exact:true}).fill('20');
 await page.getByLabel('X (%) слоя 2',{exact:true}).press('Tab');
 await page.locator('.studio-editor fieldset').getByRole('button',{name:'Переместить ниже',exact:true}).last().click();
 assert.equal(await page.getByLabel('Текст слоя 2',{exact:true}).inputValue(),'Синтетический слой');
 assert.doesNotMatch(await page.getByLabel('Текст публикации',{exact:true}).inputValue(),/Синтетический слой/);
 await page.locator('.studio-editor fieldset').getByRole('button',{name:'Удалить слой',exact:true}).first().click();
 assert.equal(await page.getByLabel('Текст слоя 1',{exact:true}).inputValue(),'Синтетический слой');
 const kitFiles=await page.evaluate(async()=>{const m=await import('./js/media-studio.js'),b=await m.studioMatchPackage(document.createElement('canvas'),{team:'Демо',opponent:'Гости',score:'2:1'},['square'],{eventDetails:'Зал',includeText:true});const v=new DataView(await b.arrayBuffer());return v.getUint16(v.byteLength-12,true);});assert.equal(kitFiles,4);
 const studioBatch=await page.evaluate(async()=>{const m=await import('./js/media-studio.js'),b=await m.studioBatch(document.createElement('canvas'),{team:'Демо'},['square','story','wide'],{text:'Демо'});const v=new DataView(await b.arrayBuffer());return {signature:v.getUint32(0,true),count:v.getUint16(v.byteLength-12,true)};});assert.deepEqual(studioBatch,{signature:0x04034b50,count:4});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'studio overflow');await page.locator('.studio-editor').getByRole('button',{name:'Назад',exact:true}).click();
 await page.evaluate(async()=>{await (await import('./js/screens/documents.js')).openDocuments('schoolYearReport');});
 await shown.getByRole('heading',{name:'Генератор документов',exact:true}).waitFor();
 await shown.getByLabel('Добавить сводку по классам',{exact:true}).check();
 await shown.getByLabel('Режим сравнения',{exact:true}).selectOption('elapsed');
 await shown.getByRole('button',{name:'Предпросмотр',exact:true}).click();
 await shown.getByRole('heading',{name:'Сравнение учебных лет',exact:true}).waitFor();
 await shown.getByRole('heading',{name:'По классам',exact:true}).waitFor();assert.match(await shown.textContent(),/Содержит персональные данные/);assert.doesNotMatch(await shown.locator('.document-preview').textContent(),/Тестовый ученик/);
 assert.match(await shown.locator('.document-preview').textContent(),/одинаковый календарный срок/);assert.match(await shown.locator('.document-preview').textContent(),/Дней в срезе/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'year document overflow');
 await page.evaluate(async f=>{const M=await import('./js/model.js'),P=await import('./js/season-plan.js'),date=M.todayIso();await P.saveSeasonPlan({teamId:f.teamId,name:'Синтетический план сезона',from:date,to:M.addDays(date,14),revision:0,phases:[{name:'Техника',kind:'technical',from:date,to:M.addDays(date,7),goal:'PRIVATE PHASE NOTE',sessions:2,minutes:120}]});await (await import('./js/screens/documents.js')).openDocuments('seasonPlanReport');},vpFixture);
 await shown.getByRole('heading',{name:'Генератор документов',exact:true}).waitFor().catch(async e=>{throw Error('Season document form: '+JSON.stringify({errors,sheet:await shown.textContent().catch(()=>null),toast:await page.locator('.toast').textContent().catch(()=>null)})+' '+e.message);});
 await shown.getByLabel('Команда',{exact:true}).selectOption(vpFixture.teamId);
 await shown.getByLabel('План сезона',{exact:true}).selectOption({label:await shown.getByLabel('План сезона',{exact:true}).locator('option').first().textContent()});
 await shown.getByRole('button',{name:'Предпросмотр',exact:true}).click();
 await shown.getByRole('heading',{name:'Недельные циклы',exact:true}).waitFor();await shown.getByRole('heading',{name:'Вне этапов',exact:true}).waitFor();assert.doesNotMatch(await shown.locator('.document-preview').textContent(),/PRIVATE PHASE NOTE/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'season document overflow');
 await page.evaluate(async()=>{(await import('./js/ui.js')).closeSheet();});
 console.log('WEBKIT DOCUMENTS PASS: actual school-year and season plan selectors, preview, privacy and mobile layout.');
 // Public viewer uses a synthetic stream; no production Firebase access.
 const fan=await context.newPage();fan.on('pageerror',error=>errors.push(error.message));
 await fan.addInitScript(()=>{window.EventSource=class{constructor(){this.handlers={};window.__fanPush=data=>this.handlers.put?.({type:'put',data:JSON.stringify({path:'/',data})});setTimeout(()=>this.onopen?.(),0);}addEventListener(k,f){this.handlers[k]=f;}close(){}};});
 await fan.goto(origin+'/live/index.html');
 await fan.waitForFunction(()=>typeof window.__fanPush==='function');
 const future={schema:1,team:'Тестовая команда',updatedAt:Date.now(),schedule:[{id:'fixture1',opponent:'Гости',startAt:Date.now()+3600000}],archive:[]};
 await fan.evaluate(x=>window.__fanPush(x),future);await fan.locator('.clock').waitFor();
 assert.equal(await fan.locator('.credit a').getAttribute('href'),'https://github.com/Forz1k/teachapp');
 await fan.locator('[data-tab="schedule"]').click();await fan.locator('.fixture').waitFor();
 const fixtureHref=await fan.locator('.fixture a').getAttribute('href');assert.equal(new URL(fixtureHref).searchParams.get('fixture'),'fixture1');await fan.goto(fixtureHref);await fan.waitForFunction(()=>typeof window.__fanPush==='function');await fan.evaluate(x=>window.__fanPush(x),future);await fan.locator('.clock').waitFor();await fan.locator('.scoreboard-toggle').click();assert.equal(await fan.locator('.scoreboard-toggle').getAttribute('aria-pressed'),'true');await fan.locator('.scoreboard-toggle').click();await fan.goto(origin+'/live/index.html');await fan.waitForFunction(()=>typeof window.__fanPush==='function');await fan.evaluate(x=>window.__fanPush(x),future);await fan.locator('.clock').waitFor();
 await fan.locator('#theme').click();assert.equal(await fan.locator('html').getAttribute('data-theme'),'light');
 assert.ok(await fan.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'public viewport overflow');
 await fan.locator('#fan-motion').click();await fan.locator('#fan-motion').click();assert.equal(await fan.locator('html').getAttribute('data-motion'),'off');
 await fan.emulateMedia({reducedMotion:'reduce'});assert.equal(await fan.evaluate(()=>getComputedStyle(document.querySelector('.brand img')).animationName),'none');
 assert.equal(await fan.locator('#brand-team').textContent(),'Гимназия №26');
 const archive=[0,1,2].map(i=>({id:'result_'+i,opponent:'Тест '+i,startedAt:Date.now()-i*86400000,setsWon:i===2?{ours:0,theirs:2}:{ours:2,theirs:0},sets:i===2?[{ours:19,theirs:25},{ours:22,theirs:25}]:[{ours:25,theirs:18},{ours:25,theirs:20}]}));
 await fan.evaluate(x=>window.__fanPush(x),{...future,schedule:[],archive});
 await fan.locator('.record-streak').waitFor();assert.match(await fan.locator('.record-streak').textContent(),/2 подряд/);
 assert.equal(await fan.locator('.record-streak .flame').evaluate(n=>getComputedStyle(n).animationName),'none');
 await fan.locator('[data-tab=results]').click();await fan.locator('[data-filter=loss]').click();assert.equal(await fan.locator('.result-card').count(),1);
 await fan.locator('[data-filter=win]').click();assert.equal(await fan.locator('.result-card .trophy').count(),2);
 await fan.locator('.archive-search').fill('Тест 1');assert.equal(await fan.locator('.result-card').count(),1);await fan.getByRole('button',{name:'Очистить поиск',exact:true}).click();assert.equal(await fan.locator('.result-card').count(),2);
 assert.ok(await fan.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'public result cards overflow');
 // 5.5: real mobile viewport, historical protocol and an evicted legacy link.
 await fan.getByRole('combobox',{name:'Соперник для сравнения'}).selectOption('тест 1');
 assert.match(await fan.locator('.opponent-details').textContent(),/Партии: 2:0 · очки: 50:38/);
 const old={id:'result_older',opponent:'Архивная команда с длинным названием',startedAt:Date.UTC(2023,9,1),setsWon:{ours:2,theirs:1},sets:[{ours:25,theirs:20},{ours:21,theirs:25},{ours:15,theirs:10}]},oldKey=String(old.startedAt).padStart(16,'0')+'_'+old.id;
 // Stub only the archive fetch API, like the synthetic EventSource above.
 // The real Firebase emulator independently verifies the REST queries/rules.
 const mockArchive=({old,oldKey})=>{
  const original=window.fetch.bind(window);window.__archiveRequests=[];
  window.fetch=async(input,options)=>{
   const url=new URL(typeof input==='string'?input:input.url,location.href);
   if(url.pathname.includes('/archiveMigration/'))return new Response('null');
   if(!url.pathname.includes('/publicMatchArchive/'))return original(input,options);
   window.__archiveRequests.push(url.href);
   const value=url.pathname.endsWith('/'+oldKey+'.json')?old:url.searchParams.get('equalTo')===JSON.stringify(old.id)?{[oldKey]:old}:url.searchParams.has('startAt')?{[oldKey]:old}:null;
   return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
  };
 };
 await fan.addInitScript(mockArchive,{old,oldKey});await fan.evaluate(mockArchive,{old,oldKey});
 await fan.locator('.archive-season-year').fill('2023');await fan.getByRole('button',{name:'Загрузить сезон',exact:true}).click();
 await fan.waitForFunction(()=>window.__archiveRequests.length>0);try{await fan.locator('.result-card').filter({hasText:old.opponent}).waitFor({timeout:5000});}catch(e){console.error('Archive request diagnostic',await fan.evaluate(()=>({urls:window.__archiveRequests,text:document.getElementById('portal').innerText})));throw e;}assert.equal(await fan.locator('.season-filter').first().inputValue(),'2023');
 const oldHref=await fan.locator('.result-card').filter({hasText:old.opponent}).locator('a').getAttribute('href');assert.equal(new URL(oldHref).searchParams.get('archive'),oldKey);
 await fan.goto(oldHref);await fan.waitForFunction(()=>typeof window.__fanPush==='function');await fan.evaluate(x=>window.__fanPush(x),{...future,schedule:[],archive});
 await fan.locator('.historical-score').waitFor();assert.match(await fan.locator('.historical-totals').textContent(),/61 : 55/);
 assert.equal(await fan.locator('.historical-set').count(),3);assert.ok(await fan.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'historical page overflow');
 const legacy=new URL(oldHref);legacy.searchParams.delete('archive');legacy.searchParams.set('match',old.id);
 await fan.goto(legacy.href);await fan.waitForFunction(()=>typeof window.__fanPush==='function');await fan.evaluate(x=>window.__fanPush(x),{...future,schedule:[],archive});
 await fan.locator('.historical-score').waitFor();assert.match(await fan.locator('.historical-score').textContent(),/Архивная команда/);
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
 // Verify a selected encrypted file through the actual settings UI offline,
 // rather than only invoking the helper. No restore or backup timestamp write.
 await page.bringToFront();
 const savedCopy=await page.evaluate(async()=>{
  const S=await import('./js/store.js'),P=await import('./js/privacy.js'),payload=await S.makeBackup(),before=JSON.stringify(payload.data),password='synthetic-webkit-copy-password';
  const matching=JSON.stringify(await P.encryptBackup(payload,password));
  const stale=structuredClone(payload);stale.data.meta.push({id:'synthetic-backup-verification-only',value:'Synthetic changed copy'});
  return {before,matching,different:JSON.stringify(await P.encryptBackup(stale,password))};
 });
 await context.setOffline(true);
 const verifyField=page.locator('input[type=file][aria-label="Файл для проверки копии"]'),verifyBtn=page.getByRole('button',{name:'Проверить сохранённую защищённую копию',exact:true});
 async function verifySaved(text,password,expected){
  await verifyField.setInputFiles({name:'synthetic-backup.json',mimeType:'application/json',buffer:Buffer.from(text)});
  const dialog=page.locator('.dialog-backdrop.show .dialog');
  await dialog.getByRole('heading',{name:'Пароль сохранённой копии',exact:true}).waitFor();
  await dialog.locator('input[type=password]').fill(password);
  await dialog.getByRole('button',{name:'Проверить',exact:true}).click();
  await page.getByText(expected).waitFor({timeout:30000});
  await verifyBtn.waitFor({state:'visible'});
  assert.equal(await verifyBtn.isEnabled(),true);
 }
 await verifySaved(savedCopy.matching,'incorrect-webkit-password',/Не удалось подтвердить копию/);
 await verifySaved(savedCopy.matching,'synthetic-webkit-copy-password',/Переносимые записи совпадают с текущим снимком/);
 await verifySaved(savedCopy.different,'synthetic-webkit-copy-password',/Отличаются разделы: 1/);
 assert.equal(await page.evaluate(async()=>JSON.stringify((await (await import('./js/store.js')).makeBackup()).data)),savedCopy.before);
 await context.setOffline(false);
 console.log('WEBKIT BACKUP VERIFY PASS: selected encrypted file, wrong password, current and different snapshot, offline UI and unchanged data.');
 await page.getByRole('button',{name:'Синхронизация устройств · бета',exact:true}).click();
 await page.getByText('Расширенные настройки',{exact:true}).click();
 await page.locator('select[aria-label="Контур синхронизации"]').waitFor();
 assert.equal(relayRequests,0);
 relayDirectory=await mkdtemp(join(tmpdir(),'teachapp-webkit-relay-'));
 const tokenA='X'.repeat(43),tokenB='Y'.repeat(43),password='webkit-synthetic-test-password';
 const personalEndpoint='https://synthetic-sync.example',personalCode=createPersonalCode(personalEndpoint);
 const personalCoach=await personalCredentials(personalCode,'coach');
 relay=await createRelay({directory:relayDirectory,tokens:{school:[tokenA,tokenB],coach:[personalCoach.token]},allowedOrigin:origin});
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
 const importedSchool=await otherPage.evaluate(async()=>{const W=await import('./js/workbench.js');return {events:(await W.listWork('schoolCompetition')).length,alternatives:(await W.listWork('lessonAlternative')).length,assignments:(await W.listWork('normAssignment')).map(a=>a.minAttempts),stations:(await W.listWork('stationTemplate')).length};});
 assert.deepEqual(importedSchool,schoolRecords,'new school tools must survive encrypted synchronization into another independent browser context');
 await second.close();
 // Only in this synthetic browser test: map the personal code's HTTPS endpoint to the real loopback relay.
 // Use native browser fetch, including CORS/preflight, rather than WebKit's unreliable request interception.
 const personalMobile=await browser.newContext({...devices['iPhone 13'],locale:'ru-RU',serviceWorkers:'allow'});
 const personalDesktop=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU',serviceWorkers:'allow'});
 async function routePersonal(ctx){
  await ctx.addInitScript(({personalEndpoint,endpoint})=>{
   const nativeFetch=window.fetch.bind(window);
   window.fetch=(input,init)=>{
    if(typeof input==='string'&&input.startsWith(personalEndpoint+'/v1/snapshot/')){
     return nativeFetch(endpoint+input.slice(personalEndpoint.length),init);
    }
    return nativeFetch(input,init);
   };
  },{personalEndpoint,endpoint});
 }
 await routePersonal(personalMobile);await routePersonal(personalDesktop);
 const phone=await personalMobile.newPage(),pc=await personalDesktop.newPage();
 for(const p of [phone,pc])p.on('pageerror',error=>errors.push(error.message));
 async function connect(p){
  await p.goto(origin+'/index.html');await p.locator('.workspace-nav').waitFor();
  await p.evaluate(async()=>{(await import('./js/screens/sync.js')).openSync();});
  await p.getByRole('button',{name:'Ввести личный код',exact:true}).click();
  await p.locator('.dialog input[type=password]').fill(personalCode);
  await p.getByRole('button',{name:'Продолжить',exact:true}).click();
  await p.getByRole('button',{name:'Сохранить',exact:true}).click();
  await p.getByText('Личный код сохранён на этом устройстве.',{exact:true}).waitFor();
  await p.locator('.sheet.show').getByRole('button',{name:'Закрыть',exact:true}).click();
  await p.locator('.personal-sync-action').waitFor();
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'personal sync header overflow');
  assert.equal(await p.evaluate(async()=>Boolean((await import('./js/personal-sync.js')).readPersonalCode())),true);
 }
 await connect(phone);await connect(pc);
 const initial=async p=>p.evaluate(async()=>{
  const {readPersonalCode,personalCredentials}=await import('./js/personal-sync.js');
  const {relayClient,prepareSync,executeSync}=await import('./js/sync.js');
  const credentials=await personalCredentials(readPersonalCode(),'coach');
  const client=relayClient(credentials.endpoint,credentials.area,credentials.token);
  const plan=await prepareSync({...credentials,client});
  return executeSync({plan,choices:{},password:credentials.password,client,confirmed:true,reuseRemote:true});
 });
 await phone.evaluate(async()=>{await (await import('./js/db.js')).put('coachTeams',{id:'personal-team-1',name:'Synthetic personal team',archived:false});});
 assert.equal((await initial(phone)).revision,1);
 assert.equal((await initial(pc)).revision,1);
 await personalMobile.setOffline(true);
 await phone.evaluate(async()=>{await (await import('./js/db.js')).put('coachTeams',{id:'personal-team-2',name:'Synthetic offline team',archived:false});});
 await personalMobile.setOffline(false);
 await phone.bringToFront();await phone.reload();await phone.locator('.workspace-nav').waitFor();
 if(await phone.evaluate(()=>Boolean(navigator.locks?.request))){
  await phone.waitForFunction(async()=> (await (await import('./js/sync.js')).syncStatus('coach'))?.revision===2,undefined,{timeout:25000}).catch(async error=>{const info=await phone.evaluate(async()=>({visibility:document.visibilityState,online:navigator.onLine,report:(await import('./js/auto-sync.js')).autoSyncStatus(),lockState:await navigator.locks.query()}));throw Error('Phone foreground sync: '+JSON.stringify(info)+' '+error.message);});
  const phoneRevision=await phone.evaluate(async()=> (await (await import('./js/sync.js')).syncStatus('coach')).revision);
  assert.equal(phoneRevision,2,'foreground personal sync must push offline edit');
  await pc.bringToFront();await pc.reload();await pc.locator('.workspace-nav').waitFor();
  const team=await pc.evaluate(async()=> (await import('./js/db.js')).get('coachTeams','personal-team-2'));
  assert.equal(team?.name,'Synthetic offline team','desktop must receive edit automatically');
  assert.equal(await pc.evaluate(async()=> (await (await import('./js/sync.js')).syncStatus('coach')).revision),2,'pull should not create a revision');
 }else{
  assert.equal((await initial(phone)).revision,2);
  assert.equal((await initial(pc)).revision,2);
 }
 // A desktop edit must also reach the phone.
 await pc.evaluate(async()=>{await (await import('./js/db.js')).put('coachTeams',{id:'personal-team-3',name:'Synthetic desktop team',archived:false});});
 if(await pc.evaluate(()=>Boolean(navigator.locks?.request))){
  await pc.bringToFront();await pc.reload();await pc.locator('.workspace-nav').waitFor();
 }else assert.equal((await initial(pc)).revision,3);
 if(await phone.evaluate(()=>Boolean(navigator.locks?.request))){
  await phone.bringToFront();await phone.reload();await phone.locator('.workspace-nav').waitFor();
 }else assert.equal((await initial(phone)).revision,3);
 assert.equal(await phone.evaluate(async()=> (await (await import('./js/db.js')).get('coachTeams','personal-team-3'))?.name),'Synthetic desktop team','phone must receive desktop edit');
 await personalMobile.close();await personalDesktop.close();
 console.log('WEBKIT PERSONAL PASS: saved code on mobile and desktop, offline edit, bidirectional sync and no duplicate revision');
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
