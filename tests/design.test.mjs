import test from 'node:test';
import assert from 'node:assert/strict';
import {readAccent,applyAccent,initializeDesign} from '../js/design.js';
import {readFileSync} from 'node:fs';
test('Дизайн: выбор акцента сохраняется отдельно и защищён от некорректных значений',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},root={dataset:{}};
 assert.equal(initializeDesign(root,storage),'default');
 applyAccent('orange',root,storage);assert.equal(readAccent(storage),'orange');assert.equal(root.dataset.accent,'orange');
 assert.equal(applyAccent('invalid',root,storage),'default');
 assert.equal(readAccent({getItem(){throw Error()}}),'default');
});
test('Дизайн: локальные ресурсы и доступность',()=>{
 const css=readFileSync('css/design.css','utf8'),html=readFileSync('index.html','utf8'),sw=readFileSync('sw.js','utf8');
 assert.match(css,/prefers-reduced-motion/);assert.match(css,/focus-visible/);assert.match(css,/data-theme="dark"/);assert.doesNotMatch(html,/user-scalable=no/);
 assert.ok(sw.includes('./css/design.css')&&sw.includes('./js/design.js'));
});

test('Навигация: отдельные маршруты и безопасное восстановление',async()=>{
 const {readNavigation,saveNavigation}=await import('../js/design.js');
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 assert.deepEqual(readNavigation(storage),{workspace:'school',school:'today',coach:'home'});
 saveNavigation({workspace:'coach',school:'journal',coach:'matches'},storage);
 assert.deepEqual(readNavigation(storage),{workspace:'coach',school:'journal',coach:'matches'});
 assert.deepEqual(saveNavigation({workspace:'x',school:'x',coach:'x'},storage),{workspace:'school',school:'today',coach:'home'});
});

test('Панель уроков: незавершённое занятие и реальные итоги',async()=>{
 const {lessonOverview}=await import('../js/dashboard.js');
 const rows=[{lesson:{held:true}},{lesson:null},{lesson:{held:false}}];
 const s=lessonOverview(rows,l=>l.held);
 assert.equal(s.total,3);assert.equal(s.done,1);assert.equal(s.next,rows[1]);
});

test('КТП: выполненные темы считаются отдельно по классам и без дублей',async()=>{
 const {curriculumProgress}=await import('../js/dashboard.js');
 const lessons=[{classId:'a',topicId:'x',held:true},{classId:'a',topicId:'x',held:true},{classId:'b',topicId:'x',held:false},{classId:'b',topicId:'y',held:true}];
 assert.deepEqual(curriculumProgress([{id:'x'},{id:'y'}],['a','b'],lessons,l=>l.held),{done:2,total:4});
});

test('Графики: общая шкала сохраняет ноль и отрицательные значения',async()=>{
 const {trendDomain}=await import('../js/dashboard.js');
 assert.deepEqual(trendDomain([-4,8,NaN]),{low:-4,high:8});
 assert.deepEqual(trendDomain([0,0]),{low:0,high:1});
 assert.deepEqual(trendDomain([22,90],{min:0,max:100}),{low:0,high:100});
});

test('Календарь: месячная сетка, високосный февраль и начало недели',async()=>{
 const {calendarMonth}=await import('../js/dashboard.js');
 const m=calendarMonth('2024-02-13');assert.equal(m.from,'2024-02-01');assert.equal(m.to,'2024-02-29');assert.equal(m.offset,3);assert.equal(m.days.length,29);
 assert.equal(calendarMonth('2026-11-24').days.length,30);
});
