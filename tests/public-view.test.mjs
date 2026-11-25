import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {fanResults,resultSummary} from '../js/public-portal.js';
test('Страница зрителя переключается по опубликованным данным, не интерпретирует HTML',async()=>{
 const dom=new JSDOM('<header id="connection"></header><span id="brand-team"></span><span id="footer-team"></span><nav id="portal-nav"></nav><button id="theme"></button><button id="fan-motion"></button><main id="portal"></main>',{url:'https://example.com/teachapp/live/?db=https%3A%2F%2Fdemo.firebaseio.com&owner=uid&team=slug'});
 const w=dom.window;Object.assign(globalThis,{document:w.document,window:w,location:w.location});
 const animations=[];w.Element.prototype.animate=function(frames,options){animations.push({side:this.dataset.scoreSide||null,cls:this.className,frames,options});return {};};
 let stream;class FakeEventSource{constructor(url){this.url=url;this.listeners={};stream=this;}addEventListener(type,fn){this.listeners[type]=fn;}close(){this.closed=true;}emit(type,data){this.listeners[type]?.({type,data:JSON.stringify({path:'/',data})});}}
 globalThis.EventSource=FakeEventSource;
 try{
  await import('../js/public-view.js');
  stream.onopen();const payload={schema:1,team:'<img src=x>',updatedAt:Date.now(),schedule:[{id:'a',opponent:'Гости',startAt:Date.now()+60000}],archive:[]};
  stream.emit('put',payload);assert.match(document.body.textContent,/Следующий матч/);assert.equal(document.querySelector('img'),null);assert.equal(document.querySelector('#brand-team').textContent,'<img src=x>');assert.equal(document.querySelectorAll('.clock strong').length,4);document.querySelector('[data-tab=schedule]').click();assert.match(document.body.textContent,/Расписание/);assert.equal(document.querySelector('.clock'),null);document.querySelector('[data-tab=overview]').click();assert.ok(document.querySelector('.clock'));document.querySelector('#theme').click();assert.equal(document.documentElement.dataset.theme,'light');
  stream.emit('put',{...payload,schedule:[{id:'a',opponent:'Гости',startAt:Date.now()-1000}]});assert.match(document.body.textContent,/Ожидаем начала/);
  const match={id:'m',opponent:'Гости',startedAt:Date.now(),status:'live',set:1,score:{ours:4,theirs:3},setsWon:{ours:0,theirs:0},sets:[],serve:'ours',colors:{ours:'blue',theirs:'red'},events:[{set:1,score:'4:3',side:'ours',kind:'tip',actor:'ours',number:8}],stats:[],scheduledId:'a'};
  stream.emit('put',{...payload,match});assert.match(document.body.textContent,/LIVE/);assert.match(document.body.textContent,/№8/);assert.match(document.body.textContent,/Скидка/);const old=document.querySelector('.hero');stream.listeners.patch({type:'patch',data:JSON.stringify({path:'/',data:{updatedAt:Date.now()+1000}})});assert.equal(document.querySelector('.hero'),old,'heartbeat should not replace scoreboard');assert.match(document.querySelector('.portal-updated').textContent,/Последнее обновление/);animations.length=0;stream.listeners.patch({type:'patch',data:JSON.stringify({path:'/match/score',data:{ours:5}})});assert.match(document.querySelector('.team-score').textContent,/5/);assert.deepEqual(animations.filter(x=>x.side).map(x=>x.side),['ours']);document.querySelector('#fan-motion').click();document.querySelector('#fan-motion').click();assert.equal(document.documentElement.dataset.motion,'off');animations.length=0;stream.listeners.patch({type:'patch',data:JSON.stringify({path:'/match/score',data:{ours:6}})});assert.equal(animations.length,0);assert.match(document.querySelector('.team-score').textContent,/6/);stream.onerror();assert.match(document.body.textContent,/Соединение восстанавливается/);assert.equal(document.querySelector('.status-pill').textContent,'ПОСЛЕДНИЙ СЧЁТ');assert.equal(document.querySelector('.status-pill.live'),null);stream.onopen();assert.equal(document.querySelector('.status-pill').textContent,'ПОСЛЕДНИЙ СЧЁТ');stream.emit('put',{...payload,updatedAt:Date.now(),match});assert.equal(document.querySelector('.status-pill').textContent,'LIVE');stream.emit('put',{...payload,updatedAt:Date.now()-120000,match});assert.equal(document.querySelector('.status-pill').textContent,'ПОСЛЕДНИЙ СЧЁТ');assert.match(document.body.textContent,/Данные давно не обновлялись/);stream.listeners.patch({type:'patch',data:JSON.stringify({path:'/',data:{updatedAt:Date.now()}})});assert.equal(document.querySelector('.status-pill').textContent,'LIVE');
  stream.emit('put',{...payload,match:{...match,status:'finished',setsWon:{ours:2,theirs:0}}});assert.match(document.body.textContent,/Матч завершён/);
  stream.emit('put',{...payload,schedule:[],archive:[{id:'result_demo',opponent:'Архивный соперник',startedAt:Date.now(),setsWon:{ours:2,theirs:0},sets:[{ours:25,theirs:18},{ours:25,theirs:21}]}]});assert.match(document.querySelector('.hero').textContent,/Последний результат/);assert.match(document.querySelector('.hero').textContent,/Архивный соперник/);document.querySelector('[data-tab=results]').click();assert.match(document.body.textContent,/25:18/);assert.equal(document.querySelectorAll('.result-card.win .trophy').length,1);assert.equal(document.querySelectorAll('.result-card .set-chip').length,2);assert.ok(document.querySelector('.result-date').textContent);
  const archive=[{id:'result_a',opponent:'Победа А',startedAt:Date.parse('2026-11-20T12:00:00Z'),setsWon:{ours:2,theirs:0},sets:[{ours:25,theirs:18},{ours:25,theirs:21}]},{id:'result_b',opponent:'Победа Б',startedAt:Date.parse('2026-11-19T12:00:00Z'),setsWon:{ours:2,theirs:1},sets:[{ours:25,theirs:18},{ours:23,theirs:25},{ours:15,theirs:10}]},{id:'result_c',opponent:'Поражение В',startedAt:Date.parse('2026-11-18T12:00:00Z'),setsWon:{ours:0,theirs:2},sets:[{ours:20,theirs:25},{ours:18,theirs:25}]}];stream.emit('put',{...payload,schedule:[],archive});assert.match(document.querySelector('.record-streak').textContent,/2 подряд/);assert.equal(document.querySelectorAll('.result-card').length,3);document.querySelector('[data-filter=loss]').click();assert.equal(document.querySelectorAll('.result-card').length,1);assert.equal(document.querySelectorAll('.result-card .trophy').length,0);document.querySelector('[data-filter=win]').click();assert.equal(document.querySelectorAll('.result-card').length,2);assert.equal(document.querySelectorAll('.result-card .trophy').length,2);
  const search=document.querySelector('.archive-search');search.focus();search.value='победа б';search.dispatchEvent(new w.Event('input'));assert.equal(document.querySelectorAll('.result-card').length,1);assert.match(document.querySelector('.result-card').textContent,/Победа Б/);assert.match(document.querySelector('.record-streak').textContent,/2 подряд/);
  stream.emit('put',{...payload,updatedAt:Date.now(),schedule:[],archive:[...archive,{...archive[2],id:'new',opponent:'Другой',startedAt:Date.parse('2026-11-17T12:00:00Z')}]});assert.equal(document.activeElement.className,'archive-search');assert.equal(document.querySelector('.archive-search').value,'победа б');
  [...document.querySelectorAll('button')].find(n=>n.textContent==='Очистить поиск').click();assert.equal(document.querySelectorAll('.result-card').length,2);
  document.querySelector('[data-tab=overview]').click();assert.ok([...document.querySelectorAll('button')].some(n=>n.textContent==='Скачать карточку PNG'));
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
 assert.equal(stream.closed,true);
});

test('Публичная страница содержит подпись разработчика и настоящий URL репозитория',()=>{const html=readFileSync(new URL('../live/index.html',import.meta.url),'utf8');assert.match(html,/Разработано <strong>Forzik<\/strong>/);assert.match(html,/https:\/\/github\.com\/Forz1k\/teachapp/);});

test('Серия побед не включает live, дубли и неизвестный порядок матчей одного дня',()=>{const row=(id,date,ours,theirs)=>({id,startedAt:Date.parse(date),setsWon:{ours,theirs},opponent:'Гости',sets:[]});const a=row('result_a','2026-11-20T12:00:00Z',3,0),b=row('result_b','2026-11-19T12:00:00Z',3,2),c=row('result_c','2026-11-18T12:00:00Z',0,3);assert.deepEqual(resultSummary(fanResults({archive:[c,a,b],match:{...a,status:'finished'}})),{win:2,loss:1,draw:0,total:3,streak:2});assert.equal(resultSummary(fanResults({archive:[a,b,c],match:{...row('m','2026-11-21T12:00:00Z',0,0),status:'live'}})).streak,2);assert.equal(resultSummary(fanResults({archive:[a,{...c,startedAt:a.startedAt},b]})).streak,0);const x=row('match_a','2026-11-22T16:00:00Z',2,0),y=row('match_b','2026-11-22T14:00:00Z',0,2);assert.equal(resultSummary(fanResults({archive:[x,y]})).streak,1);});

test('Pinned fixture follows only its published match and scoreboard survives updates',async()=>{
 const dom=new JSDOM('<header id="connection"></header><nav id="portal-nav"></nav><main id="portal"></main>',{url:'https://example.com/live/?fixture=target'});
 const w=dom.window;Object.assign(globalThis,{document:w.document,window:w,location:w.location});let stream;
 globalThis.EventSource=class{constructor(){this.listeners={};stream=this;}addEventListener(type,fn){this.listeners[type]=fn;}close(){}emit(data){this.listeners.put({type:'put',data:JSON.stringify({path:'/',data})});}};
 try{
  await import('../js/public-view.js?fixture-test=1');stream.onopen();
  const payload={schema:1,team:'Команда',updatedAt:Date.now(),schedule:[{id:'target',opponent:'Цель',startAt:Date.now()+600000},{id:'other',opponent:'Другие',startAt:Date.now()+1000}],archive:[]};
  const match={id:'m',opponent:'Другие',startedAt:Date.now(),status:'live',set:1,score:{ours:4,theirs:3},setsWon:{ours:0,theirs:0},sets:[],serve:'ours',colors:{ours:'blue',theirs:'red'},events:[],stats:[],scheduledId:'other'};
  stream.emit({...payload,match});assert.match(document.querySelector('.hero').textContent,/Цель/);assert.ok(document.querySelector('.clock'));assert.equal(document.querySelector('.team-score'),null);
  document.querySelector('.scoreboard-toggle').click();assert.equal(document.body.classList.contains('fan-fullscreen'),true);
  stream.emit({...payload,match:{...match,opponent:'Цель',scheduledId:'target'}});assert.equal(document.querySelector('.team-score').textContent,'4');assert.equal(document.querySelector('.scoreboard-toggle').getAttribute('aria-pressed'),'true');assert.equal(document.querySelector('.scoreboard-toggle').textContent,'Выйти из табло');
  document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape'}));assert.equal(document.body.classList.contains('fan-fullscreen'),false);
  stream.emit({...payload,schedule:[],match:{...match,opponent:'Цель',scheduledId:'target',status:'finished',setsWon:{ours:2,theirs:0}}});assert.match(document.querySelector('.hero').textContent,/Матч завершён/);
  stream.emit({...payload,schedule:[],match});assert.match(document.body.textContent,/Встреча недоступна/);assert.equal(document.querySelector('.team-score'),null);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
});

test('Spectator can open a previously unknown season and ignores an older pending response',async()=>{
 const dom=new JSDOM('<header id="connection"></header><nav id="portal-nav"></nav><main id="portal"></main>',{url:'https://example.com/live/'});
 const w=dom.window,originalFetch=globalThis.fetch;Object.assign(globalThis,{document:w.document,window:w,location:w.location});let stream;
 globalThis.EventSource=class{constructor(){this.listeners={};stream=this;}addEventListener(type,fn){this.listeners[type]=fn;}close(){}emit(data){this.listeners.put({type:'put',data:JSON.stringify({path:'/',data})});}};
 const pending=[];globalThis.fetch=url=>new Promise(resolve=>pending.push({url,resolve}));
 const wait=()=>new Promise(resolve=>setImmediate(resolve));
 const row=(year,id)=>({id,opponent:'Соперник '+year,startedAt:Date.UTC(year,9,1),setsWon:{ours:1,theirs:0},sets:[{ours:25,theirs:21}]});
 const reply=(i,r)=>pending[i].resolve(new Response(JSON.stringify({[String(r.startedAt).padStart(16,'0')+'_'+r.id]:r})));
 try{
  await import('../js/public-view.js?season-test=1');stream.onopen();
  stream.emit({schema:1,team:'Команда',updatedAt:Date.now(),schedule:[],archive:[row(2026,'recent')]});
  document.querySelector('[data-tab=results]').click();
  const choose=year=>{document.querySelector('.archive-season-year').value=String(year);[...document.querySelectorAll('button')].find(n=>n.textContent==='Загрузить сезон').click();};
  choose(2023);choose(2024);assert.equal(pending.length,2);
  assert.equal(JSON.parse(new URL(pending[1].url).searchParams.get('startAt')),String(Date.UTC(2024,8,1)).padStart(16,'0')+'_');
  reply(1,row(2024,'old24'));await wait();
  assert.match(document.querySelector('.result-card').textContent,/Соперник 2024/);assert.equal(document.querySelector('.season-filter').value,'2024');
  reply(0,row(2023,'old23'));await wait();assert.equal(document.querySelectorAll('.result-card').length,1);assert.match(document.querySelector('.result-card').textContent,/Соперник 2024/);
  assert.match(document.querySelector('.result-card a').href,/archive=/);
 }finally{globalThis.fetch=originalFetch;w.dispatchEvent(new w.Event('pagehide'));w.close();}
});
