import test from 'node:test';import assert from 'node:assert/strict';
import {workloadReview,periodReview,ktpForecast} from '../js/school-review.js';import {weekdayOf} from '../js/model.js';
const date='2026-09-01',s={settings:{year:{from:'2026-09-01',to:'2026-09-03'},holidays:[]},classes:[{id:'c',name:'7А'}],students:[{id:'p',classId:'c',fullName:'Synthetic'}],schedule:[{id:'r1',classId:'c',weekday:weekdayOf(date),slot:1},{id:'r2',classId:'c',weekday:weekdayOf(date),slot:2}],scheduleOverrides:[],lessons:[{id:'l1',classId:'c',date,slot:1,held:true,topicId:'t1'},{id:'l2',classId:'c',date,slot:2,held:true,topicId:'t2'}],marks:[{lessonId:'l1',studentId:'p',value:'5',weight:2},{lessonId:'l2',studentId:'p',value:'2'}],participation:[],finalGrades:[],normResults:[]};
test('workload distinguishes scheduled, confirmed and cancelled slots',()=>{
 const result=workloadReview(s,{from:date,to:date,today:date});
 assert.equal(result.total.planned,2);assert.equal(result.total.confirmed,2);assert.equal(result.total.extra,0);
 const cancelled=workloadReview({...s,scheduleOverrides:[{id:'x',date,ruleId:'r2',action:'cancel'}]},{from:date,to:date,today:date});
 assert.equal(cancelled.total.planned,1);assert.equal(cancelled.total.cancelled,1);assert.equal(cancelled.total.extra,1);
});
test('period proposal is weighted, separate from approved final and respects missing data',()=>{
 const a=periodReview(s,{classId:'c',period:{from:date,to:date},today:date});
 assert.equal(a.results[0].mean,4);assert.equal(a.results[0].suggested,'4');assert.equal(a.results[0].final,null);
 assert.equal(a.results[0].count,2);assert.equal(a.results[0].weight,3);
 const none=periodReview({...s,marks:[]},{classId:'c',period:{from:date,to:date},today:date});
 assert.equal(none.results[0].mean,null);assert.equal(none.withoutGrades,1);
});
test('forecast uses already confirmed topics and unfilled slots; never edits lessons',()=>{
 const before=structuredClone(s.lessons),a=ktpForecast(s,'c',[{id:'t1',name:'A'},{id:'t2',name:'B'},{id:'t3',name:'C'}],date);
 assert.equal(a.completed,2);assert.equal(a.remaining,1);assert.equal(a.shortfall,1);assert.deepEqual(s.lessons,before);
});
