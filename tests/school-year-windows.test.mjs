import test from 'node:test';
import assert from 'node:assert/strict';
import {schoolYearComparison} from '../js/school-archive.js';
import {buildDocument} from '../js/documents.js';
import {addDays} from '../js/model.js';

function fixture(from,to){
 const year={from,to};
 return {year,snapshot:{meta:[{id:'settings',year}],classes:[{id:'c',name:'7А'},{id:'d',name:'8Б'}],students:[{id:'p',classId:'c',fullName:'PRIVATE_PUPIL'},{id:'q',classId:'d'}],lessons:[{id:'a',classId:'c',date:from,held:true},{id:'b',classId:'c',date:addDays(from,1),held:true},...(to>=addDays(from,4)?[{id:'late',classId:'c',date:addDays(from,4),held:true}]:[])],marks:[{lessonId:'a',studentId:'p',value:'5',weight:2,source:'manual'},{lessonId:'b',studentId:'p',value:'3',source:'manual'},...(to>=addDays(from,4)?[{lessonId:'late',studentId:'p',value:'1',source:'manual'}]:[])],participation:[]}};
}
test('Matched elapsed year windows exclude later archived records and label truncated periods',()=>{
 const old=fixture('2024-08-31','2025-05-31'),short=fixture('2023-09-01','2023-09-02'),current=fixture('2026-09-01','2027-05-31');
 const options={gradeLevel:7,today:'2026-09-03',mode:'elapsed'};
 const [a,b,c]=schoolYearComparison(current.snapshot,[old,short],options);
 assert.equal(a.windowDays,2);assert.equal(a.truncated,true);assert.equal(b.cutoff,'2024-09-02');assert.equal(b.windowDays,3);assert.equal(c.windowDays,3);
 for(const row of [a,b,c]){assert.equal(row.gradeCount,2);assert.equal(row.gradeWeight,3);assert.equal(row.mean,13/3);assert.equal(row.lessons,2);assert.equal(row.classes,1);}
 const full=schoolYearComparison(current.snapshot,[old],{...options,mode:'full'});assert.equal(full[0].gradeCount,3);assert.equal(full[1].gradeCount,2);assert.equal(full[1].lessons,3);
 assert.throws(()=>schoolYearComparison(current.snapshot,[old],{...options,today:'2026-08-31'}),/ещё не начался/);
 const conflict=schoolYearComparison(current.snapshot,[old,old],options);assert.equal(conflict[0].conflict,true);
});
test('Matched comparison document retains exact cutoffs, days and no individual names',()=>{
 const old=fixture('2024-09-01','2025-05-31'),current=fixture('2026-09-01','2027-05-31'),short=fixture('2023-09-01','2023-09-02');
 const years=schoolYearComparison(current.snapshot,[old,short],{gradeLevel:7,today:'2026-09-03',mode:'elapsed'});
 const report=buildDocument('schoolYearReport',{years,comparisonMode:'elapsed',includeClasses:true});
 assert.match(report.sections[1].paragraphs.join(' '),/одинаковый календарный срок/);
 const matrix=report.sections[1].matrix;assert.equal(matrix[0].at(-1),'Дней в срезе');assert.equal(matrix[1].at(-1),2);assert.match(matrix[1][1],/короткий срез/);assert.equal(matrix[2][2],'2024-09-03');assert.equal(matrix[2].at(-1),3);
 assert.equal(report.sections[2].matrix[2].at(-2),'2024-09-03');assert.doesNotMatch(JSON.stringify(report),/PRIVATE_PUPIL/);
 assert.throws(()=>buildDocument('schoolYearReport',{years:[{...years[0],mode:'full'}],comparisonMode:'elapsed'}),/сопоставимые/);
});
