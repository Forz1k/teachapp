import test from 'node:test';import assert from 'node:assert/strict';
import {workloadReview,periodReview,ktpForecast,ktpRedistribution,schoolPeriodOverview,periodMissingLessons,lessonPreparation} from '../js/school-review.js';import {weekdayOf} from '../js/model.js';
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

test('KTP suggestions preserve existing topics and marked or confirmed lessons',()=>{
 const next={...s,lessons:[...s.lessons,{id:'future',classId:'c',date:'2026-09-02',slot:2},{id:'assigned',classId:'c',date:'2026-09-03',slot:1,topicId:'t3'},{id:'recorded',classId:'c',date:'2026-09-03',slot:2}],marks:[...s.marks,{lessonId:'recorded',studentId:'p',value:'4'}]};
 const topics=[{id:'t1',name:'A'},{id:'t2',name:'B'},{id:'t3',name:'C'},{id:'t4',name:'D'},{id:'t5',name:'E'}],before=structuredClone(next);
 const r=ktpRedistribution(next,'c',topics,date);assert.equal(r.covered,3);assert.equal(r.rows.length,1);assert.equal(r.rows[0].lessonId,'future');assert.equal(r.rows[0].topicId,'t4');assert.deepEqual(r.unplaced,[{id:'t5',name:'E'}]);assert.deepEqual(next,before);
});

test('Period overview counts all slots, inferred lessons and unknown rows class-wide, respects holiday/cancellation and future dates',()=>{
 const date2='2026-09-02',date3='2026-09-03',next=structuredClone(s);
 next.classes.push({id:'b',name:'8Б'},{id:'empty',name:'6А'});
 next.students.push({id:'q',classId:'c',fullName:'Q'},{id:'r',classId:'b',fullName:'R'});
 next.lessons[0].held=false;
 next.schedule.push({id:'r3',classId:'c',weekday:weekdayOf(date),slot:3},{id:'b1',classId:'b',weekday:weekdayOf(date),slot:4},{id:'b2',classId:'b',weekday:weekdayOf(date2),slot:1},{id:'c3',classId:'c',weekday:weekdayOf(date3),slot:1});
 next.scheduleOverrides=[{id:'cancel',date,ruleId:'r3',action:'cancel'}];
 next.settings.holidays=[{from:date2,to:date2}];
 const before=structuredClone(next),period={from:date,to:date3};
 const slots=periodMissingLessons(next,period,date2);assert.deepEqual(slots.map(r=>[r.classId,r.date,r.slot]),[['b',date,4]]);
 const review=periodReview(next,{classId:'c',period,today:date2});
 assert.equal(review.held,2);assert.equal(review.explicitlyHeld,1);assert.equal(review.unconfirmed,1);
 assert.equal(review.results.find(r=>r.student.id==='q').unknown,2);assert.equal(review.unknown,2);
 const overview=schoolPeriodOverview(next,{period,today:date2});
 assert.equal(overview.total.missing,1);assert.equal(overview.total.unknown,2);
 assert.equal(overview.total.unconfirmed,1);assert.equal(overview.needsReview,2);assert.equal(overview.ready,0);
 assert.equal(overview.rows.find(r=>r.classId==='empty').status,'empty');
 assert.ok(!overview.rows.find(r=>r.classId==='c').issues.includes('withoutFinal'));
 const future=schoolPeriodOverview(next,{period:{from:date3,to:date3},today:date});
 assert.equal(future.needsReview,0);assert.ok(future.rows.every(r=>r.status==='future'));
 assert.deepEqual(next,before);
});
test('Period overview distinguishes ready classes from missing finals and due norm review',()=>{
 const next=structuredClone(s);next.norms=[];next.activityCategories=[];next.activityRestrictions=[];next.exemptions=[];
 const period={from:date,to:date};next.finalGrades=[{studentId:'p',from:date,to:date,value:'4'}];
 assert.equal(schoolPeriodOverview(next,{period,today:date}).ready,1);
 next.finalGrades=[];assert.equal(schoolPeriodOverview(next,{period,today:date}).rows[0].status,'review');
 next.finalGrades=[{studentId:'p',from:date,to:date,value:'4'}];
 const assignment={id:'a',kind:'normAssignment',name:'Недоступный норматив',classId:'c',normId:'missing',yearFrom:next.settings.year.from,yearTo:next.settings.year.to,from:date,to:date,targetGrade:null};
 const upcoming={...assignment,id:'future',to:'2026-09-03'};
 const overview=schoolPeriodOverview(next,{period,assignments:[assignment,upcoming],today:date});
 assert.equal(overview.total.normUnavailable,1);assert.equal(overview.ready,0);assert.equal(overview.needsReview,1);
});

test('Lesson preparation is slot-specific, read-only, date-aware and keeps possible restrictions distinct',()=>{
 const state=structuredClone(s);
 state.students.push({id:'q',classId:'c',fullName:'Q'},{id:'foreign',classId:'x',fullName:'Foreign'});
 state.topics=[{id:'run',name:'Бег',activityIds:['run']}];state.activityCategories=[];
 state.activityRestrictions=[{studentId:'p',activityId:'sprint',type:'avoid',dateFrom:date},{studentId:'q',activityId:'jump',type:'avoid',dateFrom:date},{studentId:'foreign',activityId:'run',type:'avoid',dateFrom:date},{studentId:'q',activityId:'run',type:'avoid',dateFrom:'2026-09-02'}];
 state.exemptions=[{studentId:'q',dateFrom:date,dateTo:date}];state.studentHealthProfiles=[{id:'q',group:'Подготовительная',dateFrom:date,dateTo:date}];
 state.norms=[{id:'n',name:'Бег',activityId:'run',unit:'с',direction:'min',scale:[10,9,8,7,6]}];
 const assignment={id:'a',kind:'normAssignment',name:'Бег',classId:'c',normId:'n',yearFrom:state.settings.year.from,yearTo:state.settings.year.to,from:date,to:date,targetGrade:null};
 const before=structuredClone(state),slot={classId:'c',date,slot:3,topicId:'run'};
 const a=lessonPreparation(state,slot,{assignments:[assignment],today:date});
 assert.equal(a.pupils.length,2);assert.deepEqual(a.full,['q']);assert.deepEqual(a.profiles.map(x=>x.id),['q']);
 assert.equal(a.matches.length,0);assert.deepEqual(a.potentialMatches.map(x=>x.studentId),['p']);
 assert.deepEqual(a.otherRestrictions.map(x=>x.activityId),['jump']);assert.equal(a.norms[0].review,2);assert.equal(a.norms[0].due,true);
 const unknown=lessonPreparation(state,{classId:'c',date,slot:4},{today:date});
 assert.equal(unknown.needsReview,true);assert.equal(unknown.otherRestrictions.length,2);
 const specific=lessonPreparation(state,{...slot,activityIds:['long']},{today:date});assert.equal(specific.potentialMatches.length,0);
 assert.deepEqual(state,before);assert.equal(slot.id,undefined);
});

test('Indexed period review matches single-class summaries and isolates finals by exact period',()=>{
 const state=structuredClone(s),period={from:date,to:date},today=date;
 state.classes.push({id:'b',name:'8Б'});state.students.push({id:'q',classId:'b',fullName:'Q'});
 state.lessons.push({id:'lb',classId:'b',date,held:true},{id:'future',classId:'b',date:'2026-09-02',held:true});
 state.marks.push({lessonId:'lb',studentId:'q',value:'3',weight:1});
 state.finalGrades=[{studentId:'q',from:'2026-08-01',to:date,value:'2'},{studentId:'q',from:date,to:date,value:'3'},{studentId:'p',from:date,to:'2026-09-03',value:'5'}];
 const before=structuredClone(state),summary=schoolPeriodOverview(state,{period,today});
 for(const cls of state.classes){const a=periodReview(state,{classId:cls.id,period,today}),b=summary.rows.find(r=>r.classId===cls.id);
  assert.equal(b.held,a.held);assert.equal(b.stats.unknown,a.unknown);assert.equal(b.stats.withoutFinal,a.withoutFinal);assert.equal(b.stats.withoutGrades,a.withoutGrades);
 }
 assert.equal(summary.rows.find(r=>r.classId==='b').status,'ready');assert.equal(summary.rows.find(r=>r.classId==='c').stats.withoutFinal,1);
 assert.deepEqual(state,before);
});
