import {schoolTasks,coachTasks,commonTasks,goalTasks,orderTasks} from './attention.js';
import {assignmentOverview} from './school-tools.js';
import {matchDebrief} from './match-tactics.js';
import {ktpForecast} from './school-review.js';
import {todayIso,exemptionActive} from './model.js';
import {active} from './health.js';
export const assistantQuestions={school:[['lessons','Незавершённые уроки'],['norms','Кто не сдал назначенный норматив?'],['ktp','Какие классы отстают от КТП?'],['health','Ограничения на сегодня'],['docs','Документы и рабочие задачи']],coach:[['training','Незавершённые тренировки и матчи'],['goals','Индивидуальные цели'],['analysis','Что отработать на тренировке?'],['docs','Документы и рабочие задачи']]};
const taskRows=(tasks)=>orderTasks(tasks).map(t=>({title:t.title,detail:t.detail+' · '+t.date,task:t}));
export function schoolAssistant(question,s,{events=[],assignments=[],date=todayIso()}={}){
 if(question==='lessons')return taskRows(schoolTasks(s,date).filter(t=>t.kind==='lesson'));
 if(question==='docs')return taskRows(commonTasks(s.settings,events,date));
 if(question==='health'){const pupils=new Map(s.students.map(x=>[x.id,x])),classes=new Map(s.classes.map(x=>[x.id,x.name]));const rows=[];for(const [key,label] of [['exemptions','Освобождение'],['activityRestrictions','Ограничение'],['studentHealthProfiles','Группа здоровья']])for(const r of s[key]||[]){if(!(key==='exemptions'?exemptionActive(r,date):active(r,date)))continue;const p=pupils.get(key==='studentHealthProfiles'?r.id:r.studentId);if(!p)continue;rows.push({title:p.fullName+' · '+(classes.get(p.classId)||''),detail:label+' · проверьте действующие условия в карточке ученика.',task:{kind:'review',target:{classId:p.classId,reviewType:key}}});}return rows;}
 if(question==='norms'){const out=[];for(const a of assignments.filter(a=>a.from<=date)){try{const overview=assignmentOverview(s,a,date);const rows=overview.rows||overview.students||[];for(const r of rows){if(!['missing','retake','review','noScale'].includes(r.status))continue;out.push({title:r.student.fullName,detail:({missing:'Нет результата',retake:'Ниже выбранной цели',review:'Проверить ограничения',noScale:'Нет шкалы'}[r.status]||r.status)+' · '+(s.norms.find(n=>n.id===a.normId)?.name||'Норматив')+' · '+a.to});}}catch{out.push({title:'Проверьте назначение',detail:'Недоступен расчёт для '+a.id});}}return out;}
 if(question==='ktp'){return s.classes.map(c=>{try{const a=ktpForecast(s,c.id,s.topics.filter(t=>!t.ktpId||s.ktp.some(k=>k.id===t.ktpId&&k.classIds.includes(c.id))),date);return {title:c.name,detail:'Выполнено '+a.completed+' из '+a.total+'; осталось '+a.remaining+'; доступно уроков '+a.available+'; дефицит '+a.shortfall};}catch{return {title:c.name,detail:'Откройте прогноз КТП для класса'};}});}
 return [];
}
export function coachAssistant(question,data,teamId,{goals=[],events=[],settings={},date=todayIso()}={}){
 if(question==='training')return taskRows(coachTasks(data,teamId,date));
 if(question==='goals')return taskRows(goalTasks(goals,teamId,date));
 if(question==='docs')return taskRows(commonTasks(settings,events,date));
 if(question==='analysis'){const matches=data.coachMatches.filter(m=>m.teamId===teamId&&m.detail).sort((a,b)=>b.date.localeCompare(a.date));if(!matches.length)return [{title:'Недостаточно данных',detail:'Нужен хотя бы один подробно зарегистрированный матч.'}];try{const m=matches[0],r=matchDebrief(m.detail);const notes=r.notes||[];return notes.map(n=>({title:n.title,detail:m.date+' · '+m.opponent+' · '+n.text}));}catch{return [{title:'Проверьте протокол',detail:'Не удалось рассчитать показатели последнего матча.'}];}}
 return [];
}
