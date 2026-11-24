import test from 'node:test';
import assert from 'node:assert/strict';
import {schoolTasks,coachTasks,commonTasks} from '../js/attention.js';
test('Центр управления: реальная неполная явка, отменённые дни и сроки',()=>{
 const s={settings:{year:{from:'2026-09-01',to:'2027-05-31'},holidays:[{from:'2026-11-23',to:'2026-11-23'}]},classes:[{id:'c',name:'7А'}],students:[{id:'a',classId:'c'},{id:'b',classId:'c'}],lessons:[{id:'l',date:'2026-11-24',classId:'c',held:true},{id:'f',date:'2026-11-25',classId:'c'}],marks:[{lessonId:'l',studentId:'a',value:'5'}],participation:[],schedule:[{id:'s',weekday:1,slot:1,classId:'c',time:'10:00'}],scheduleOverrides:[],exemptions:[{studentId:'a',dateTo:'2026-11-26'},{studentId:'b',dateTo:'2026-11-27'}]};
 const rows=schoolTasks(s,'2026-11-24',2);
 assert.equal(rows.filter(r=>r.kind==='lesson').length,1);
 assert.match(rows.find(r=>r.kind==='lesson').detail,/1 из 2/);
 assert.match(rows.find(r=>r.kind==='review').detail,/2/);
 assert.equal(rows.some(r=>r.date==='2026-11-25'),false);
});
test('Центр управления тренера и общие задачи не учитывают завершённые',()=>{
 const data={coachTrainings:[{id:'a',teamId:'t',date:'2026-11-23',held:true,title:'Тренировка',roster:['a','b'],attendance:{a:'present'}},{id:'b',teamId:'t',date:'2026-11-23',held:true,title:'Готово',roster:['a'],attendance:{a:'present'}}],coachLive:[{id:'d',teamId:'t',date:'2026-11-24'}]};
 assert.deepEqual(coachTasks(data,'t','2026-11-24').map(x=>x.kind),['match','training']);
 const common=commonTasks({lastBackupAt:'2026-11-23T12:00:00Z'},[{id:'e',name:'Задача',date:'2026-11-22',done:false},{id:'f',name:'Будущее',date:'2026-11-25',done:false}],'2026-11-24');assert.deepEqual(common.map(x=>x.kind),['custom']);
});

test('expiry warnings keep the specific record category',()=>{
 const state={settings:{year:{from:'2026-09-01',to:'2027-05-31'}},classes:[{id:'c',name:'7А'}],students:[{id:'a',classId:'c'}],lessons:[],marks:[],participation:[],schedule:[],scheduleOverrides:[],exemptions:[{studentId:'a',dateTo:'2026-11-24'}],activityRestrictions:[{studentId:'a',dateTo:'2026-12-01'},{studentId:'a',dateTo:'2026-11-25',enabled:false}],studentHealthProfiles:[{id:'a',dateTo:'2026-11-26'}]};
 const review=schoolTasks(state,'2026-11-24').filter(t=>t.kind==='review');
 assert.equal(review.length,3);
 assert.deepEqual(new Set(review.map(t=>t.target.reviewType)),new Set(['exemptions','activityRestrictions','studentHealthProfiles']));
 assert.ok(review.every(t=>t.target.classId==='c'&&t.detail.endsWith(': 1')));
});
