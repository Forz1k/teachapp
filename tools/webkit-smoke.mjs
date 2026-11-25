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
 await page.evaluate(async()=>{(await import('./js/screens/studio.js')).openStudio({scope:'test',template:'result',team:'Демо',opponent:'Гости',score:'2:1'});});
 await page.locator('.studio-editor canvas').waitFor();assert.equal(await page.locator('.studio-editor textarea[aria-label="Текст публикации"]').inputValue(),'Итоговый результат\n\nДемо — Гости\n\n2:1');
 await page.getByRole('button',{name:'Сохранить фирменный стиль',exact:true}).click();
 assert.match(await page.locator('.studio-status').textContent(),/сохранено/);
 const studioBatch=await page.evaluate(async()=>{const m=await import('./js/media-studio.js'),b=await m.studioBatch(document.createElement('canvas'),{team:'Демо'},['square','story','wide'],{text:'Демо'});const v=new DataView(await b.arrayBuffer());return {signature:v.getUint32(0,true),count:v.getUint16(v.byteLength-12,true)};});assert.deepEqual(studioBatch,{signature:0x04034b50,count:4});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth<=3),'studio overflow');await page.locator('.studio-editor').getByRole('button',{name:'Назад',exact:true}).click();
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
