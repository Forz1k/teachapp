import test from 'node:test';import assert from 'node:assert/strict';
import {validateNormAssignment,assignmentOverview} from '../js/school-tools.js';
import {validateWorkRecord} from '../js/workbench.js';
const a={id:'a',kind:'normAssignment',name:'7А · Прыжок',classId:'c',normId:'n',yearFrom:'2026-09-01',yearTo:'2027-08-31',from:'2026-10-01',to:'2026-10-31',targetGrade:4};
const s={settings:{year:{from:a.yearFrom,to:a.yearTo}},classes:[{id:'c',name:'7А',gradeLevel:7}],norms:[{id:'n',name:'Прыжок',activityId:'standing',unit:'см',direction:'max',scale:[100,120,140,160,180]}],students:[{id:'p',classId:'c',fullName:'Тест',normGroup:'girls'}],normResults:[],activityCategories:[],activityRestrictions:[],exemptions:[]};
test('Назначение явно ограничено учебным годом и не изменяет оценки',()=>{validateWorkRecord(a);assert.throws(()=>validateNormAssignment({...a,to:'2028-01-01'}));assert.equal(assignmentOverview(s,a,'2026-09-30').state,'upcoming');const v=assignmentOverview(s,a,'2026-11-01');assert.equal(v.overdue,1);assert.equal(v.rows[0].status,'missing');assert.equal(s.normResults.length,0);});
test('Удалённая ссылка и архивный год не превращаются в задолженность',()=>{assert.equal(assignmentOverview({...s,norms:[]},a,'2026-11-01').state,'unavailable');assert.equal(assignmentOverview({...s,settings:{year:{from:'2027-09-01',to:'2028-08-31'}}},a,'2027-11-01').state,'archive');});
