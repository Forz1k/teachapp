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
