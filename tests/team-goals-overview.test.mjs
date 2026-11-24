import test from 'node:test';
import assert from 'node:assert/strict';
import {teamGoalOverview} from '../js/coach-goals.js';
import {testPresets} from '../js/coach-tests.js';
const goal={id:'g',kind:'coachGoal',teamId:'t',playerId:'p',name:'Прыжок',from:'2026-01-01',to:'2026-01-31',definition:testPresets.jump,metric:'measure',baseline:30,target:40,status:'active',actions:'',exercises:[],observations:[],revision:0};
const players=[{id:'p',teamId:'t',name:'А'},{id:'b',teamId:'t',name:'Б'},{id:'c',teamId:'t',name:'В',archived:true}];
test('Командные цели: просрочено, недостаточно данных, без активных целей',()=>{const v=teamGoalOverview([goal],[],players,'t','2026-02-01');assert.equal(v.overdue,1);assert.equal(v.rows[0].state,'overdue');assert.deepEqual(v.withoutGoals.map(x=>x.id),['b']);});
test('Достигнутый порог не меняет статус цели',()=>{const s={id:'s',teamId:'t',date:'2026-01-20',definition:testPresets.jump,results:{p:{status:'done',adapted:false,value:42}}};const v=teamGoalOverview([goal],[s],players,'t','2026-01-21');assert.equal(v.review,1);assert.equal(v.rows[0].state,'review');assert.equal(goal.status,'active');});
