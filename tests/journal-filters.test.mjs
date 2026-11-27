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

import {journalAttendanceSnapshot,journalRefreshPlan} from '../js/journal-filters.js';
import {buildAttendanceIndex} from '../js/attendance-index.js';
test('Journal incremental attendance refresh scopes ordinary edits and invalidates shared evidence and filters',()=>{
 const today='2026-11-25',lessons=[{id:'a',date:'2026-11-20'},{id:'b',date:'2026-11-21',held:true},{id:'c',date:'2026-11-26'}],students=Array.from({length:30},(_,i)=>({id:'p'+i}));
 const marks=[{lessonId:'b',studentId:'p0',value:'4',source:'manual'}],snapshot=(date=today)=>{const a=buildAttendanceIndex(lessons,lessons,marks,[],date);return {a,s:journalAttendanceSnapshot(lessons,a.held,date)};};
 const before=snapshot();marks[0].value='5';const edit=snapshot(),plan=journalRefreshPlan(before.s,edit.s,students,['p0','p0','outside']);
 assert.equal(plan.rebuild,false);assert.deepEqual(plan.rows,['p0']);assert.equal(plan.changed.size,2);
 for(const st of students.slice(1))assert.deepEqual(before.a.forStudents([st]),edit.a.forStudents([st]));
 marks.push({lessonId:'a',studentId:'p0',value:'5',source:'manual'});const first=snapshot();
 assert.deepEqual(journalRefreshPlan(edit.s,first.s,students,['p0']).rows,students.map(s=>s.id));
 assert.equal(first.a.forStudents([students[1]]).unknown,2);assert.equal(edit.a.forStudents([students[1]]).unknown,1);
 for(const status of ['held','pending'])assert.equal(journalRefreshPlan(edit.s,first.s,students,['p0'],status).rebuild,true);
 assert.equal(journalRefreshPlan(edit.s,first.s,students,['p0'],'all').rebuild,false);
 marks.pop();const removed=snapshot();assert.deepEqual(journalRefreshPlan(first.s,removed.s,students,['p0']).rows,students.map(s=>s.id));
 assert.equal(journalRefreshPlan(removed.s,snapshot('2026-11-26').s,students,['p0']).rebuild,true);
});
