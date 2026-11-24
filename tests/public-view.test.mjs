import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
test('Страница зрителя переключается по опубликованным данным, не интерпретирует HTML',async()=>{
 const dom=new JSDOM('<header id="connection"></header><nav id="portal-nav"></nav><button id="theme"></button><button id="fan-motion"></button><main id="portal"></main>',{url:'https://example.com/teachapp/live/?db=https%3A%2F%2Fdemo.firebaseio.com&owner=uid&team=slug'});
 const w=dom.window;Object.assign(globalThis,{document:w.document,window:w,location:w.location});
 const animations=[];w.Element.prototype.animate=function(frames,options){animations.push({side:this.dataset.scoreSide||null,cls:this.className,frames,options});return {};};
 let stream;class FakeEventSource{constructor(url){this.url=url;this.listeners={};stream=this;}addEventListener(type,fn){this.listeners[type]=fn;}close(){this.closed=true;}emit(type,data){this.listeners[type]?.({type,data:JSON.stringify({path:'/',data})});}}
 globalThis.EventSource=FakeEventSource;
 try{
  await import('../js/public-view.js');
  stream.onopen();const payload={schema:1,team:'<img src=x>',updatedAt:Date.now(),schedule:[{id:'a',opponent:'Гости',startAt:Date.now()+60000}],archive:[]};
  stream.emit('put',payload);assert.match(document.body.textContent,/Следующий матч/);assert.equal(document.querySelector('img'),null);assert.equal(document.querySelectorAll('.clock strong').length,4);document.querySelector('[data-tab=schedule]').click();assert.match(document.body.textContent,/Расписание/);assert.equal(document.querySelector('.clock'),null);document.querySelector('[data-tab=overview]').click();assert.ok(document.querySelector('.clock'));document.querySelector('#theme').click();assert.equal(document.documentElement.dataset.theme,'light');
  stream.emit('put',{...payload,schedule:[{id:'a',opponent:'Гости',startAt:Date.now()-1000}]});assert.match(document.body.textContent,/Ожидаем начала/);
  const match={id:'m',opponent:'Гости',startedAt:Date.now(),status:'live',set:1,score:{ours:4,theirs:3},setsWon:{ours:0,theirs:0},sets:[],serve:'ours',colors:{ours:'blue',theirs:'red'},events:[{set:1,score:'4:3',side:'ours',kind:'tip',actor:'ours',number:8}],stats:[],scheduledId:'a'};
  stream.emit('put',{...payload,match});assert.match(document.body.textContent,/LIVE/);assert.match(document.body.textContent,/№8/);assert.match(document.body.textContent,/Скидка/);const old=document.querySelector('.hero');stream.listeners.patch({type:'patch',data:JSON.stringify({path:'/',data:{updatedAt:Date.now()+1000}})});assert.equal(document.querySelector('.hero'),old,'heartbeat should not replace scoreboard');animations.length=0;stream.listeners.patch({type:'patch',data:JSON.stringify({path:'/match/score',data:{ours:5}})});assert.match(document.querySelector('.team-score').textContent,/5/);assert.deepEqual(animations.filter(x=>x.side).map(x=>x.side),['ours']);document.querySelector('#fan-motion').click();document.querySelector('#fan-motion').click();assert.equal(document.documentElement.dataset.motion,'off');animations.length=0;stream.listeners.patch({type:'patch',data:JSON.stringify({path:'/match/score',data:{ours:6}})});assert.equal(animations.length,0);assert.match(document.querySelector('.team-score').textContent,/6/);stream.onerror();assert.match(document.body.textContent,/Соединение восстанавливается/);
  stream.emit('put',{...payload,match:{...match,status:'finished',setsWon:{ours:2,theirs:0}}});assert.match(document.body.textContent,/Матч завершён/);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
 assert.equal(stream.closed,true);
});

test('Публичная страница содержит подпись разработчика и настоящий URL репозитория',()=>{const html=readFileSync(new URL('../live/index.html',import.meta.url),'utf8');assert.match(html,/Разработано <strong>Forzik<\/strong>/);assert.match(html,/https:\/\/github\.com\/Forz1k\/teachapp/);});
