import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {testPresets,definitionKey} from '../js/coach-tests.js';
import {matchComparison,testComparison,ranked,personalInsights} from '../js/coach-season.js';
const players=[{id:'a',name:'А',position:'setter',archived:false},{id:'b',name:'Б',position:'middle',archived:false},{id:'c',name:'В',position:'setter',archived:true}];
const m=(date,stats,extra={})=>({date,opponent:'Тест',roster:['a','b','c'],stats,...extra});
const matches=[m('2026-09-01',{a:{aces:3,serves:20,serveErrors:2},b:{aces:2,serves:1,serveErrors:0}}),m('2026-09-02',{a:{aces:2,serves:20,serveErrors:2},b:{aces:3}}),m('2026-09-03',{a:{aces:7,serves:10,serveErrors:0}},{imported:{}}),m('2026-08-01',{a:{aces:100},c:{aces:200}})];
const s=(id,date,results,definition=testPresets.serve)=>({id,date,definition,results});
const result=(n,k,adapted=false,target=null)=>({status:'done',attempts:n,success:k,errors:n-k,adapted,target,value:null,note:''});
const tests=[s('1','2026-09-01',{a:result(10,8),b:result(1,1)}),s('2','2026-09-02',{a:result(10,8)}),s('3','2026-09-03',{a:result(10,10),b:result(20,20,true)}),s('4','2026-09-04',{a:result(10,10)}),s('5','2026-09-05',{a:result(20,0)}, {...testPresets.serve,protocol:'Другая методика'})];
const view={players,matches,tests,trainings:[]};
test('Сезон: фильтры, источники, неизвестные значения, равное место',()=>{
 const range={from:'2026-09-01',to:'2027-08-31'};
 let r=ranked(matchComparison(view,'aces',{...range,source:'manual'}));assert.deepEqual(r.map(x=>[x.player.id,x.value,x.place]),[['a',5,1],['b',5,1]]);
 r=ranked(matchComparison(view,'aces',{...range,source:'imported'}));assert.equal(r[0].value,7);
 assert.equal(matchComparison(view,'aces',{...range,position:'setter'}).length,1);
 r=ranked(matchComparison(view,'serveRate',range));assert.equal(r.length,1);assert.equal(r[0].value,90);assert.equal(r[0].attempts,40);
});
test('Сезон: тренировочные рейтинги, методики, выборка, прогресс и рекомендации',()=>{
 const key=definitionKey(testPresets.serve);
 const r=testComparison(view,key,'success');assert.equal(r[0].value,90);assert.equal(r[0].attempts,40);assert.equal(r[1].eligible,false);assert.equal(r[1].adapted,1);
 assert.equal(ranked(testComparison(view,key,'progress'))[0].value,20);
 assert.equal(ranked(testComparison(view,key,'stability'))[0].value,10);
 assert.equal(ranked(testComparison(view,key,'target')).length,0);
 const notes=personalInsights(tests,'a');assert.ok(notes.some(x=>x.text.includes('рост 20')));assert.ok(notes.every(x=>!x.text.includes('Другая методика')));
 assert.deepEqual(personalInsights(tests,'b'),[]);
});
test('Сезон: интерфейс строит рейтинги, меняет источник и сравнение',async()=>{
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.window=dom.window;globalThis.Node=dom.window.Node;globalThis.Element=dom.window.Element;globalThis.HTMLElement=dom.window.HTMLElement;
 const {seasonPanel}=await import('../js/screens/coach-season.js');
 const panel=seasonPanel(view);document.body.append(panel);
 assert.match(panel.textContent,/Сезонная аналитика/);
 const selects=[...panel.querySelectorAll('select')];
 const mode=selects.find(x=>[...x.options].some(o=>o.value==='test'));
 mode.value='test';mode.dispatchEvent(new dom.window.Event('change'));
 assert.match(panel.textContent,/Методика/);assert.match(panel.textContent,/Попадания в цель/);
 const method=[...panel.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.value===definitionKey(testPresets.serve)));
 method.value=definitionKey(testPresets.serve);method.dispatchEvent(new dom.window.Event('change'));
 assert.match(panel.textContent,/Лидер по показателю/);assert.match(panel.textContent,/40 попыток/);
 const choices=[...panel.querySelectorAll('select')].filter(x=>[...x.options].some(o=>o.value==='a')&&[...x.options].some(o=>o.value==='b'));
 assert.equal(choices.length,2);choices[0].value='a';choices[0].dispatchEvent(new dom.window.Event('change'));choices[1].value='b';choices[1].dispatchEvent(new dom.window.Event('change'));
 assert.match(panel.textContent,/Сравнение игроков/);assert.match(panel.textContent,/Динамика · А/);assert.match(panel.textContent,/вне рейтинга/);
 dom.window.close();
});

test('Indexed seasonal test history equals individual scans for all methods, filters and edits',async()=>{
 const {indexTestHistory,testHistory}=await import('../js/coach-tests.js');
 const measure={kind:'measure',name:'Jump',protocol:'A',activityId:'jump',unit:'cm',direction:'higher'};
 const other={...testPresets.serve,protocol:'Other'};
 const sessions=[
  s('z','2026-09-02',{a:result(10,7),b:result(5,5),outside:result(1,1)}),
  s('a','2026-09-02',{a:result(20,15,true),c:result(10,10)}),
  s('b','2026-09-01',{a:{status:'skipped'},b:{status:'restricted'}}),
  s('q','2026-09-03',{a:result(10,0)},other),
  s('m','2026-09-03',{a:{status:'done',adapted:false,value:40}},measure),
  s('old','2026-08-01',{a:result(10,10)})
 ];
 const ids=['a','b','c','missing'];
 for(const d of [testPresets.serve,other,measure])for(const range of [{},{from:'2026-09-02',to:'2026-09-03'},{from:'2027-01-01'}]){
  const key=definitionKey(d),idx=indexTestHistory(sessions,ids,key,range);
  assert.equal(idx.has('outside'),false);assert.equal(idx.size,4);
  for(const id of ids)assert.deepEqual(idx.get(id),testHistory(sessions,id,range).filter(x=>definitionKey(x.definition)===key));
 }
 const key=definitionKey(testPresets.serve);
 assert.deepEqual(indexTestHistory(sessions,[],key),new Map());
 sessions[0]={...sessions[0],results:{b:result(5,5)}};
 assert.deepEqual(indexTestHistory(sessions,ids,key).get('a'),testHistory(sessions,'a').filter(x=>definitionKey(x.definition)===key));
 const comparison=testComparison({...view,tests:sessions},key,'success',{from:'2026-09-01',archived:true});
 assert.equal(comparison.find(r=>r.player.id==='a').value,null);
 assert.equal(comparison.find(r=>r.player.id==='c').value,100);
});
test('Seasonal history index enumerates each selected session result only once, never out-of-period or other methods',async()=>{
 const {indexTestHistory}=await import('../js/coach-tests.js');
 const players=Array.from({length:80},(_,i)=>'p'+i),key=definitionKey(testPresets.serve);
 let scans=0;
 const results=new Proxy(Object.fromEntries(players.slice(0,14).map(id=>[id,result(10,8)])),{ownKeys(target){scans++;return Reflect.ownKeys(target);}});
 const sessions=Array.from({length:120},(_,i)=>s('s'+i,'2026-09-01',results,i%3===0?testPresets.serve:{...testPresets.serve,protocol:'Other'}));
 sessions.push(s('old','2026-08-01',results));
 const indexed=indexTestHistory(sessions,players,key,{from:'2026-09-01'});
 assert.equal(scans,40);assert.equal(indexed.get('p0').length,40);assert.equal(indexed.get('p79').length,0);
});
