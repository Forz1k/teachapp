import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
test('Страница зрителя переключается по опубликованным данным, не интерпретирует HTML',async()=>{
 const dom=new JSDOM('<header id="connection"></header><main id="portal"></main>',{url:'https://example.com/teachapp/live/?db=https%3A%2F%2Fdemo.firebaseio.com&owner=uid&team=slug'});
 const w=dom.window;Object.assign(globalThis,{document:w.document,window:w,location:w.location});
 let stream;class FakeEventSource{constructor(url){this.url=url;this.listeners={};stream=this;}addEventListener(type,fn){this.listeners[type]=fn;}close(){this.closed=true;}emit(type,data){this.listeners[type]?.({data:JSON.stringify({path:'/',data})});}}
 globalThis.EventSource=FakeEventSource;
 try{
  await import('../js/public-view.js');
  stream.onopen();const payload={schema:1,team:'<img src=x>',updatedAt:Date.now(),schedule:[{id:'a',opponent:'Гости',startAt:Date.now()+60000}],archive:[]};
  stream.emit('put',payload);assert.match(document.body.textContent,/Следующий матч/);assert.equal(document.querySelector('img'),null);assert.equal(document.querySelectorAll('.clock strong').length,4);
  stream.emit('put',{...payload,schedule:[{id:'a',opponent:'Гости',startAt:Date.now()-1000}]});assert.match(document.body.textContent,/Ожидаем начала/);
  const match={id:'m',opponent:'Гости',startedAt:Date.now(),status:'live',set:1,score:{ours:4,theirs:3},setsWon:{ours:0,theirs:0},sets:[],serve:'ours',colors:{ours:'blue',theirs:'red'},events:[{set:1,score:'4:3',side:'ours',kind:'tip',actor:'ours',number:8}],stats:[],scheduledId:'a'};
  stream.emit('put',{...payload,match});assert.match(document.body.textContent,/LIVE/);assert.match(document.body.textContent,/№8/);assert.match(document.body.textContent,/Скидка/);stream.onerror();assert.match(document.body.textContent,/Соединение восстанавливается/);
  stream.emit('put',{...payload,match:{...match,status:'finished',setsWon:{ours:2,theirs:0}}});assert.match(document.body.textContent,/Матч завершён/);
 }finally{w.dispatchEvent(new w.Event('pagehide'));w.close();}
 assert.equal(stream.closed,true);
});
