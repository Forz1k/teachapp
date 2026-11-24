/* Real Chromium smoke: synthetic data in a temporary profile, no external network. */
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const root=process.cwd(),dir=resolve('artifacts/ui');await mkdir(dir,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'teachapp-browser-'));
const binaries=[process.env.CHROME_BIN,'google-chrome','google-chrome-stable','chromium','chromium-browser','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
const binary=binaries.find(p=>existsSync(p)||spawnSync(p,['--version'],{stdio:'ignore'}).status===0);
if(!binary)throw Error('Chromium / Chrome not found; set CHROME_BIN');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://localhost'),path=resolve(root,'.'+decodeURIComponent(u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname));
  if(path!==root&&!path.startsWith(root+sep))throw Error('path');
  const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const proc=spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let ws,closed=false;const pending=new Map(),exceptions=[],report=[];
const wait=async(fn,label,timeout=20000)=>{const end=Date.now()+timeout;let last;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch(e){last=e.message;}await sleep(100);}throw Error(label+' timed out'+(last?': '+last:''));};
try{
 const port=await wait(async()=>Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]),'Chrome port');
 const page=await wait(async()=>{const a=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());return a.find(x=>x.type==='page');},'CDP target');
 ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
 let id=0;
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text+' '+(m.params.exceptionDetails.exception?.description||''));};
 function send(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout '+method));},30000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});}
 async function evalJs(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
 const exists=selector=>evalJs('Boolean(document.querySelector('+JSON.stringify(selector)+'))');
 const ready=selector=>wait(()=>exists(selector),selector);
 const click=selector=>evalJs('(()=>{const n=document.querySelector('+JSON.stringify(selector)+');if(!n)throw Error("Missing selector");n.click();return true})()');
 const clickText=(selector,value)=>evalJs('(()=>{const n=[...document.querySelectorAll('+JSON.stringify(selector)+')].find(n=>n.textContent.trim()==='+JSON.stringify(value)+');if(!n)throw Error("Missing button");n.click();return true})()');
 async function closeSheet(){await evalJs('(async()=>{const u=await import("./js/ui.js");u.closeSheet();return true})()');await sleep(350);}
 async function nav(label){await click('.workspace-nav [aria-label="'+label+'"]');await sleep(120);}
 async function theme(value){await evalJs('(async()=>{const s=await import("./js/store.js"),v=await import("./js/screens/settings.js");await s.saveSettings({theme:'+JSON.stringify(value)+'});v.applyTheme('+JSON.stringify(value)+');return true})()');await sleep(100);}
 async function viewport(width,height){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<700});await sleep(100);}
 async function capture(name){
  const g=await evalJs('(()=>{const w=innerWidth,doc=document.documentElement,nav=document.querySelector(".workspace-nav"),sheet=document.querySelector(".sheet.show");return {w,scroll:doc.scrollWidth,nav:nav?nav.getBoundingClientRect().toJSON():null,sheet:sheet?sheet.getBoundingClientRect().toJSON():null,theme:doc.dataset.theme}})()');
  assert.ok(g.scroll<=g.w+3,name+' document overflow '+JSON.stringify(g));
  if(g.nav)assert.ok(g.nav.left>=-2&&g.nav.right<=g.w+2,name+' navigation outside viewport');
  if(g.sheet)assert.ok(g.sheet.left>=-2&&g.sheet.right<=g.w+2,name+' sheet outside viewport');
  const s=await send('Page.captureScreenshot',{format:'png',fromSurface:true});await writeFile(join(dir,name+'.png'),Buffer.from(s.data,'base64'));report.push({name,...g});console.log('UI PASS '+name+' '+g.w+'px '+g.theme);
 }
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
 await viewport(390,844);await send('Page.navigate',{url:origin+'/index.html'});await ready('.workspace-nav');
 await evalJs("(async()=>{const S=await import('./js/store.js'),M=await import('./js/model.js'),C=await import('./js/coach.js'),W=await import('./js/workbench.js'),T=await import('./js/tournaments.js');\n const today=M.todayIso(),y=today.slice(0,4),year={from:y+'-01-01',to:y+'-12-31'};\n await S.saveSettings({year,trimesters:[{id:'t1',kind:'custom',name:'Тестовый период',from:year.from,to:year.to}],theme:'light'});\n const cls=await S.addClass('7А'),other=await S.addClass('8Б');\n const pupils=[];for(let i=1;i<=8;i++)pupils.push(await S.addStudent(cls.id,'Демо Ученик '+i,i,i%2?'girls':'boys'));\n await S.addStudent(other.id,'Демо Ученик 9',1,'girls');\n const lesson=await S.addLesson(cls.id,today);await S.setMark(pupils[0].id,lesson.id,{value:'5'});await S.setScheduleEntry({weekday:M.weekdayOf(today),slot:1,classId:cls.id,time:'10:00'});\n S.state.currentClassId=cls.id;S.notify();\n const team=await C.saveTeam({name:'Демо-команда'}),players=[];for(let i=1;i<=7;i++)players.push(await C.savePlayer({teamId:team.id,name:'Игрок '+i,number:i,position:'setter'}));\n await C.saveTraining({teamId:team.id,date:today,time:'16:00',title:'Демо-тренировка',minutes:60,roster:players.map(p=>p.id),exercises:[],attendance:{},held:false});\n await C.saveMatch({teamId:team.id,date:today,opponent:'Демо-соперник',competition:'Демо',sets:[{ours:25,theirs:19},{ours:25,theirs:21}],roster:players.map(p=>p.id),stats:{[players[0].id]:{points:5,aces:2,serves:10,serveErrors:1}}});\n const away=Array.from({length:6},(_,i)=>({id:'away'+i,name:'Гость '+(i+1),number:i+1}));\n const draft=await C.startDetailedMatch({teamId:team.id,date:today,teamName:team.name,opponent:'Гости',competition:'Демо',venue:'Зал',roster:players.map(p=>p.id),ourPlayers:players,awayPlayers:away,lineup:players.slice(0,6).map(p=>p.id),awayLineup:away.map(p=>p.id),libero:null,scheme:'5-1',bestOf:3,target:25,decider:15,firstServe:'ours'});\n await W.saveWork({kind:'event',name:'Демо-задача',date:today,time:'12:00',minutes:30,eventType:'task',note:'',remind:30,done:false});\n await T.createTournament({name:'Демо-кубок',system:'league',format:'score',bestOf:3,target:25,decider:15,names:['7А','8Б','9В']});\n window.__smoke={draftId:draft.id};return true;})()");
 await evalJs("(async()=>{const W=await import('./js/workbench.js'),C=await import('./js/coach.js'),R=await import('./js/resources.js'),T=await import('./js/tactics.js');const team=(await C.loadCoach()).coachTeams[0];await W.saveWork({kind:'plan',name:'Демо-конспект',context:'school',minutes:45,goal:'Учебная цель',equipment:'Мячи',audience:'7А',items:[{phase:'intro',exercise:W.builtinExercises[0],minutes:5,notes:'Разминка'}]});await R.saveInventory({name:'Демо-мячи',category:'Волейбол',unit:'шт.',location:'Зал',minimum:5,initial:{good:8,repair:1,unusable:0},archived:false});await T.saveBoard({kind:'tacticBoard',teamId:team.id,name:'Демо-схема',note:'Приём',markers:T.initialMarkers(),arrows:[],revision:0});return true;})()");
 await theme('light');await ready('.dashboard');await ready('.attention-panel');await ready('.focus-hero');await capture('390-school-light');
 await click('[aria-label="Поиск"]');await ready('.sheet.show input[type="search"]');await evalJs('(()=>{const n=document.querySelector(".sheet input[type=search]");n.value="Демо Ученик 1";n.dispatchEvent(new Event("input"));return true})()');await clickText('.sheet button','Демо Ученик 1 · 7А');await ready('.student-profile');await capture('390-search-student');await closeSheet();
 await clickText('button','Документы');await ready('.sheet.show');await clickText('.sheet button','Предпросмотр');await ready('.document-preview');await capture('390-document-preview');await closeSheet();
 await evalJs(`(async()=>{const S=await import('./js/store.js'),W=await import('./js/workbench.js'),n=await S.saveNorm({name:'Тестовый прыжок',activityId:'standing',unit:'см',direction:'max',scale:[100,120,140,160,180]}),y=S.state.settings.year;await W.saveWork({kind:'normAssignment',name:'Тестовый прыжок',classId:S.state.currentClassId,normId:n.id,yearFrom:y.from,yearTo:y.to,from:y.from,to:y.to,targetGrade:4});await (await import('./js/screens/school-tools.js')).openNormAssignments();return true;})()`);await wait(()=>evalJs('document.querySelector(".sheet.show")?.textContent.includes("Тестовый прыжок")'),'norm assignment');await capture('390-norm-assignment');await closeSheet();
 await clickText('button','Инвентарь');await ready('.sheet.show');await wait(()=>evalJs('document.querySelector(".sheet.show")?.textContent.includes("Демо-мячи")'),'inventory card');await capture('390-inventory');await closeSheet();
 await nav('Классы');await ready('.class-entry');await capture('390-classes');
 await click('.class-entry .class-card');await ready('table.journal');await capture('390-journal');
 await click('.name-cell');await ready('.student-profile');await sleep(320);await capture('390-student');await clickText('.sheet button','История оценок');await wait(()=>evalJs('document.querySelector(".sheet.show")?.textContent.includes("Ручная запись")'),'grade history');await capture('390-grade-history');await closeSheet();
 await nav('Календарь');await clickText('button','Общий рабочий календарь');await ready('.sheet.show');
 await evalJs('(()=>{const n=[...document.querySelectorAll(".sheet select")].find(s=>[...s.options].some(o=>o.value==="month"));n.value="month";n.dispatchEvent(new Event("change"));return true})()');
 await ready('.month-grid');await capture('390-calendar');await closeSheet();
 await nav('Ещё');await ready('.sheet.show');await clickText('.sheet button','Настройки');await ready('.settings-group');await sleep(350);await capture('390-settings');await evalJs(`(()=>{const n=document.querySelector('select[aria-label="Анимации"]');n.value='off';n.dispatchEvent(new Event('change'));return true;})()`);assert.equal(await evalJs('document.documentElement.dataset.motion'),'off');assert.equal(await evalJs('getComputedStyle(document.querySelector(".workspace-nav")).animationName'),'none');await capture('390-motion-off');await evalJs(`(()=>{const n=document.querySelector('select[aria-label="Анимации"]');n.value='full';n.dispatchEvent(new Event('change'));return true;})()`);
 await clickText('button','Синхронизация устройств · бета');await ready('select[aria-label="Контур синхронизации"]');await capture('390-sync-settings');await closeSheet();
 await clickText('.workspace-option','Тренер');await ready('.coach-body .dashboard-metrics');await capture('390-coach-light');await ready('.competition-card');await capture('390-competition-center');await clickText('button','Цели спортсменок');await wait(()=>evalJs('document.querySelector(".sheet.show")?.textContent.includes("Развитие команды")'),'team goals');await capture('390-team-goals');await closeSheet();
 await clickText('button','Тактическая доска');await ready('.tactic-board');await capture('390-tactics');await closeSheet();
 await nav('Тренировки');await clickText('button','План сезона и недельные циклы');await ready('.sheet.show');await clickText('.sheet button','+ План сезона');await clickText('.sheet button','Сохранить план');await wait(()=>evalJs('document.querySelector(".sheet.show")?.textContent.includes("Недельные циклы")'),'season saved');await capture('390-season-plan');await closeSheet();
 await nav('Команда');await ready('.player-directory-row');await click('.player-directory-row');await ready('.player-profile');await sleep(320);await capture('390-player');await closeSheet();
 await nav('Матчи');await ready('.match-history');await capture('390-match-history');await clickText('button','Результат на зрительский сайт');await ready('.public-result-score');assert.equal(await evalJs('document.querySelector(".public-result-score").textContent'),'2 : 0');await capture('390-public-result-preview');await closeSheet();await clickText('button','Площадка и live-матч');await ready('.sheet.show');await clickText('.sheet button','Публичная страница команды');await ready('.vp-portal-status');await capture('390-public-portal-settings');await clickText('.sheet button','+ Добавить результат из истории');await ready('input[aria-label="Поиск результата"]');await clickText('.sheet button','Выбрать результат');await ready('.public-result-score');await clickText('.sheet button','Назад');await ready('input[aria-label="Поиск результата"]');await clickText('.sheet button','Назад');await ready('.vp-portal-status');await clickText('.sheet button','Назад');await wait(()=>evalJs('Array.from(document.querySelectorAll(".sheet button")).some(n=>n.textContent==="Продолжить матч")'),'back to match center');await clickText('.sheet button','Продолжить матч');await ready('.vp-court');await sleep(320);await capture('390-live');
 assert.equal(await evalJs('document.querySelectorAll(".vp-mini-player").length'),12);
 await clickText('.sheet button','↔ Сменить стороны');
 assert.equal(await evalJs('document.querySelector(".vp-board-score .vp-score-side").classList.contains("theirs")'),true);
 await clickText('.sheet button','↔ Сменить стороны');
 await click('.vp-score-side.ours .vp-mini-player');await ready('.vp-player-overlay');await clickText('.sheet button','Отмена');await ready('.vp-board-points');
 await click('.vp-points .vp-ours');await ready('.match-attribution');
 assert.equal(await evalJs('document.querySelector(".vp-score-side.ours strong").textContent'),'0');
 await capture('390-live-reasons');await clickText('.sheet button','Отмена');await ready('.vp-points');
 assert.equal(await evalJs('document.querySelector(".vp-score-side.ours strong").textContent'),'0');
 await click('.vp-points .vp-ours');await ready('.match-attribution');await click('[data-reason="tip"]');await ready('.vp-author-grid [data-player]');await capture('390-live-author');
 await click('.vp-author-grid [data-player]');await ready('.vp-points');
 assert.equal(await evalJs('document.querySelector(".vp-score-side.ours strong").textContent'),'1');
 await clickText('.sheet summary','Детали последнего очка');await click('[data-zone="4"]');
 await wait(()=>evalJs('document.querySelector(".vp-last-event")?.textContent.includes("зона 4")'),'placement saved');
 await clickText('.vp-tabs button','Статистика');await ready('.vp-heat-grid');
 assert.equal(await evalJs('Array.from(document.querySelectorAll(".vp-heat-cell")).some(n=>n.getAttribute("aria-label")==="Зона 4: 1")'),true);
 await capture('390-live-analytics');
 await clickText('.vp-tabs button','События');await clickText('.vp-history-row button','Уточнить');await ready('.vp-report-section');await clickText('.sheet button','Сохранить уточнение');await ready('.vp-history-row');
 await clickText('.vp-tabs button','Матч');await ready('.vp-undo');
 await click('.vp-scout-open');await ready('.vp-scout-panel');await capture('390-live-scout');await click('.vp-radar-grid .vp-scout-cell');assert.equal(await evalJs('document.querySelector(".vp-scout-cell[aria-pressed=true]")?.getAttribute("aria-pressed")'),'true');
 await click('[data-scout-entry]');await clickText('.sheet button','Вернуться к матчу');await ready('.vp-undo');
 await click('.vp-undo');await wait(()=>evalJs('document.querySelector(".vp-score-side.ours strong")?.textContent==="0"'),'undo score');
 await click('.vp-points .vp-ours');await click('[data-reason="tip"]');await click('.vp-author-grid [data-player]');await ready('[data-scout-zone]');await click('[data-scout-zone="6"]');await clickText('.sheet button','Начислить очко');await wait(()=>evalJs('document.querySelector(".vp-score-side.ours strong")?.textContent==="1"'),'scout point saved');
 await click('.vp-scout-open');await ready('.vp-scout-panel');assert.ok(await evalJs('document.querySelector(".vp-scout-panel").textContent.includes("с зоной: 1 из 1")'));await clickText('.sheet button','Вернуться к матчу');await click('.vp-undo');await wait(()=>evalJs('document.querySelector(".vp-score-side.ours strong")?.textContent==="0"'),'scout undo');
 await closeSheet();
 await nav('Главная');await ready('.coach-body .dashboard-metrics');await theme('dark');await ready('.coach-body .dashboard-metrics');await capture('390-coach-dark');
 await viewport(320,740);await capture('320-coach-dark');
 await clickText('.workspace-option','Учитель');await nav('Главная');await ready('.dashboard');await capture('320-school-dark');
 await viewport(844,390);await capture('844-landscape-dark');
 await viewport(768,1024);await nav('Журнал');await ready('table.journal');await capture('768-journal-dark');
 await viewport(1280,900);await capture('1280-journal-dark');await nav('Главная');await capture('1280-school-dark');
 await theme('light');await capture('1280-school-light');
 await click('.privacy-action');await ready('.privacy-cover');assert.equal(await evalJs('document.querySelector("#app").inert'),true);await clickText('.privacy-cover button','Показать данные');assert.equal(await evalJs('document.querySelector("#app").inert'),false);
 await viewport(390,844);
 await nav('Ещё');await ready('.sheet.show');await clickText('.sheet button','Настройки');await ready('.settings-group');await sleep(350);await clickText('button','Выборочная копия / восстановление');await ready('.sheet.show');await clickText('.sheet button','Создать выборочную копию');await ready('select[aria-label="Область выборочной копии"]');await capture('390-selective-backup');await closeSheet();await nav('Главная');await ready('.dashboard');
 await wait(()=>evalJs('(async()=>{const r=await navigator.serviceWorker.getRegistration();return Boolean(r?.active&&navigator.serviceWorker.controller)})()'),'service worker active',30000);
 // Public viewer is a separate navigation even when the private PWA worker controls the origin.
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.pathname.startsWith('/live/')){window.EventSource=class{constructor(url){this.handlers={};window.__portalTestPush=data=>this.handlers.put?.({type:'put',data:JSON.stringify({path:'/',data})});setTimeout(()=>this.onopen?.(),0);}addEventListener(k,f){this.handlers[k]=f;}close(){}};}`});
 await send('Page.navigate',{url:origin+'/live/?db=https%3A%2F%2Fdemo.firebaseio.com&owner=owner&team=team'});await ready('#portal');
 await wait(()=>evalJs('typeof window.__portalTestPush==="function"'),'mock public stream');
 const upcoming={schema:1,team:'Демо-команда',updatedAt:Date.now(),schedule:[{id:'f1',opponent:'Гости',startAt:Date.now()+3600000}],archive:[]};
 await evalJs('window.__portalTestPush('+JSON.stringify(upcoming)+')');await ready('.clock');await capture('390-public-upcoming');assert.equal(await evalJs('document.querySelector(".credit a").href'),'https://github.com/Forz1k/teachapp');await click('[data-tab="schedule"]');await ready('.fixture');await capture('390-public-schedule');await click('[data-tab="overview"]');await ready('.clock');
 const current={id:'m1',opponent:'Гости',startedAt:Date.now(),status:'live',set:1,score:{ours:8,theirs:6},setsWon:{ours:0,theirs:0},sets:[],serve:'ours',colors:{ours:'blue',theirs:'red'},events:[{set:1,score:'8:6',side:'ours',kind:'tip',actor:'ours',number:8}],stats:[{side:'ours',number:8,points:1,attack:1,tip:1,ace:0,block:0}],scheduledId:'f1'};
 await evalJs('window.__portalTestPush('+JSON.stringify({...upcoming,match:current})+')');await ready('.event');assert.equal(await exists('.workspace-nav'),false);await capture('390-public-live');await evalJs('window.__portalTestPush('+JSON.stringify({...upcoming,match:{...current,score:{ours:9,theirs:6}}})+')');await wait(()=>evalJs('document.querySelector("[data-score-side=ours]")?.textContent==="9"'),'animated public score');await click('#fan-motion');await click('#fan-motion');assert.equal(await evalJs('document.documentElement.dataset.motion'),'off');await capture('390-public-motion-off');
 await viewport(320,740);await capture('320-public-live');await click('#theme');assert.equal(await evalJs('document.documentElement.dataset.theme'),'light');await capture('320-public-light');await viewport(1280,900);await capture('1280-public-live');
 const archiveDemo=[0,1,2,3,4].map((i)=>({id:'result_'+i,opponent:['Школа 94','Лицей 102','Школа 115','СОШ №147','Очень длинное название команды для проверки'][i],startedAt:Date.now()-i*86400000,setsWon:i===2?{ours:0,theirs:3}:{ours:3,theirs:1},sets:i===2?[{ours:20,theirs:25},{ours:22,theirs:25},{ours:19,theirs:25}]:[{ours:23,theirs:25},{ours:25,theirs:19},{ours:25,theirs:15},{ours:25,theirs:21}]}));
 await evalJs('window.__portalTestPush('+JSON.stringify({...upcoming,schedule:[],archive:archiveDemo})+')');await ready('.result-card');await capture('1280-public-results-light');await click('#theme');await capture('1280-public-results-dark');await click('[data-tab=results]');await click('[data-filter=loss]');assert.equal(await evalJs('document.querySelectorAll(".result-card").length'),1);await click('[data-filter=win]');assert.equal(await evalJs('document.querySelectorAll(".result-card .trophy").length'),4);await click('[data-filter=all]');assert.equal(await evalJs('document.querySelectorAll(".result-card").length'),5);await viewport(320,740);await capture('320-public-results');await viewport(390,844);await capture('390-public-results');
 await send('Page.navigate',{url:origin+'/index.html'});await ready('.workspace-nav');await ready('.dashboard');
 const version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
 const cached=await evalJs('(async()=>{const keys=await caches.keys();return keys.some(k=>k.endsWith('+JSON.stringify('v'+version)+'))})()');assert.equal(cached,true);
 await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
 server.close();server.closeAllConnections?.();closed=true;
 await send('Page.reload',{ignoreCache:false});await ready('.workspace-nav');await ready('.dashboard');
 const count=await evalJs('(async()=>{const S=await import("./js/store.js"),C=await import("./js/coach.js");return {pupils:S.state.students.length,teams:(await C.loadCoach()).coachTeams.length,marks:S.state.marks.length}})()');assert.deepEqual(count,{pupils:9,teams:1,marks:1});assert.equal(await evalJs(`(async()=>{const W=await import('./js/workbench.js');return (await W.listWork('normAssignment')).length})()`),1);
 await capture('390-offline-reload');
 await click('[aria-label="Поиск"]');await ready('.sheet.show input[type="search"]');await evalJs('(()=>{const n=document.querySelector(".sheet input[type=search]");n.value="7А";n.dispatchEvent(new Event("input"));return true})()');await clickText('.sheet button','7А · Класс');await ready('table.journal');await capture('390-offline-search');
 await nav('Журнал');await ready('table.journal');await capture('390-offline-journal');
 assert.deepEqual(exceptions,[],'Unhandled browser exceptions');
 console.log('BROWSER PASS: '+report.length+' screenshots; real Chromium, offline reload, persistent IndexedDB, score/undo.');
}finally{
 await writeFile(join(dir,'report.json'),JSON.stringify({screens:report,exceptions},null,2));
 ws?.close();proc.kill();if(!closed){server.close();server.closeAllConnections?.();}
 await sleep(500);await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});
}
