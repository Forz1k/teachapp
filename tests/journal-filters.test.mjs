import test from 'node:test';import assert from 'node:assert/strict';import {filterJournalLessons,periodMarks} from '../js/journal-filters.js';
const rows=[{id:'a',date:'2026-11-24',topicId:'t',held:true},{id:'b',date:'2026-11-25',slot:1},{id:'c',date:'2026-11-25',slot:2,topicId:'t',held:true},{id:'d',date:'2026-11-26'}],ctx={today:'2026-11-25',topics:new Map([['t',{name:'Волейбол'}]])};
test('filters preserve double lessons, match topic and distinguish past and future',()=>{assert.deepEqual(filterJournalLessons(rows,{status:'today'},ctx).map(x=>x.id),['b','c']);assert.deepEqual(filterJournalLessons(rows,{status:'pending'},ctx).map(x=>x.id),['b']);assert.deepEqual(filterJournalLessons(rows,{status:'held',query:'волей'},ctx).map(x=>x.id),['a','c']);assert.deepEqual(filterJournalLessons(rows,{status:'future'},ctx).map(x=>x.id),['d']);assert.deepEqual(filterJournalLessons(rows,{from:'2026-11-26',to:'2026-11-25'},ctx),[]);});
test('period average is independent of visible lessons',()=>{const marks=new Map([['a|p',{value:'5'}],['c|p',{value:'3'}]]);assert.equal(periodMarks(rows,marks,'p'),4);assert.equal(periodMarks(rows,marks,'missing'),null);});

test('Journal density is device-local, validated, and defaults safely',async()=>{
 const {readJournalDensity,saveJournalDensity}=await import('../js/journal-filters.js');const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
 assert.equal(readJournalDensity(storage),'standard');assert.equal(saveJournalDensity('compact',storage),'compact');assert.equal(readJournalDensity(storage),'compact');
 assert.throws(()=>saveJournalDensity('unknown',storage));map.set('teachapp.journal.density','bad');assert.equal(readJournalDensity(storage),'standard');
});

import {planJournalPaste} from '../js/journal-filters.js';
test('Journal TSV respects explicit anchor and preserves blanks and same-day lesson IDs',()=>{const pupils=[{id:'p',fullName:'P'},{id:'q',fullName:'Q'}],plan=planJournalPaste('5\t\n\tН\n',pupils,rows,{studentId:'p',lessonId:'b'});assert.deepEqual(plan.entries.map(x=>[x.studentId,x.lessonId,x.value]),[['p','b','5'],['q','c','Н']]);assert.throws(()=>planJournalPaste('5\t4\n3',pupils,rows,{studentId:'p',lessonId:'b'}));assert.throws(()=>planJournalPaste('5\t4',pupils,rows,{studentId:'p',lessonId:'d'}));assert.throws(()=>planJournalPaste('=SUM(A1)',pupils,rows,{studentId:'p',lessonId:'b'}));});
