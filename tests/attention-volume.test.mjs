import test from 'node:test';
import assert from 'node:assert/strict';
import {schoolTasks} from '../js/attention.js';

test('school attention ignores large historical records and respects cancellations',()=>{
 const today='2026-11-24';
 const classes=[{id:'c',name:'7А'}],students=Array.from({length:3000},(_,i)=>({id:'p'+i,classId:'c'}));
 const lessons=[{id:'old',classId:'c',date:'2026-09-01',held:true},{id:'recent',classId:'c',date:'2026-11-23',held:true}];
 const marks=Array.from({length:60000},(_,i)=>({lessonId:'old',studentId:'p'+(i%3000),value:'5'}));
 marks.push({lessonId:'recent',studentId:'p0',value:'5'});
 const state={settings:{year:{from:'2026-09-01',to:'2027-05-31'},holidays:[]},classes,students,lessons,marks,participation:[],schedule:[{id:'r',classId:'c',weekday:1,slot:1}],scheduleOverrides:[{id:'o',date:'2026-11-16',action:'cancel',ruleId:'r'}],exemptions:[],activityRestrictions:[],studentHealthProfiles:[]};
 const result=schoolTasks(state,today,10);
 assert.ok(result.some(t=>t.id==='lesson-recent'&&t.detail.includes('2999')));
 assert.ok(!result.some(t=>t.date==='2026-11-16'||t.id==='lesson-old'));
 assert.equal(result.length,1);
});
