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
