import {validateNormRetake} from './norm-retakes.js';
import {validateNewsDraft} from './public-media-drafts.js';
import {validateSchoolCompetition,validateTeacherPortfolio} from './teacher-portfolio.js';
import {validateStudentGoal} from './student-goals.js';
import {validateMaterial,materialKinds} from './library-materials.js';
import {validateOpponentNote} from './coach-opponents.js';
import {validateVideoReview} from './video-review.js';
import {validateBriefing,validateGymBoard} from './methodical.js';
import * as db from './db.js';
import {uid,exemptionCovers} from './model.js';
import {validateGradeHistory} from './grade-history.js';
import {validateInventory,validateAchievement} from './resources.js';
import {validateBoard} from './tactics.js';
import {validateGoal} from './coach-goals.js';
import {validateSeasonPlan} from './season-plan.js';
import {validateRubric,validateNormAssignment} from './school-tools.js';
import {validateTournament} from './tournaments.js';
import {validateEvent} from './work-calendar.js';
import {catalog,checkLessonRestrictions} from './health.js';
export const exerciseCategories={warmup:'Разминка',athletics:'Лёгкая атлетика',gymnastics:'Гимнастика',volleyball:'Волейбол',games:'Игры',fitness:'ОФП / СФП',cooldown:'Заминка',other:'Другое'};
export const phases={intro:'Подготовительная',main:'Основная',end:'Заключительная'};
export const contexts={school:'Урок',coach:'Тренировка'};
export const builtinExercises=[
 {id:'builtin-warmup',kind:'exercise',name:'Суставная разминка',category:'warmup',activityId:'other',minutes:5,description:'Последовательные движения суставов в комфортной амплитуде, без рывков.',equipment:'',level:'all'},
 {id:'builtin-pass',kind:'exercise',name:'Передачи мяча в парах',category:'volleyball',activityId:'pass',minutes:8,description:'Передача сверху в парах. Начать с удобного расстояния, следить за техникой.',equipment:'Волейбольные мячи',level:'all'},
 {id:'builtin-serve',kind:'exercise',name:'Подача в заданную зону',category:'volleyball',activityId:'volley',minutes:10,description:'Серия подач с контролем попадания в выбранную зону. Дистанция по подготовленности.',equipment:'Мячи, сетка',level:'all'},
 {id:'builtin-cool',kind:'exercise',name:'Спокойное восстановление',category:'cooldown',activityId:'other',minutes:5,description:'Ходьба, спокойное дыхание, мягкие движения без боли.',equipment:'',level:'all'}
];
export const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
export const txt=(v,max=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
export const opt=(v,max=2000)=>typeof v==='string'&&v.length<=max;
export const require=(ok,msg)=>{if(!ok)throw Error(msg);};
const minutes=v=>Number.isInteger(v)&&v>=1&&v<=600;
const activity=v=>catalog.some(a=>a.id===v);
function validateExercise(e){
 require(only(e,['id','kind','name','category','activityId','minutes','description','equipment','level'])&&txt(e.id)&&e.kind==='exercise'&&txt(e.name)&&Object.hasOwn(exerciseCategories,e.category)&&activity(e.activityId)&&minutes(e.minutes)&&txt(e.description,4000)&&opt(e.equipment,500)&&['all','beginner','advanced'].includes(e.level),'Проверьте упражнение');
}
export function validateWorkRecord(r){
 require(txt(r?.id),'Некорректная рабочая запись');
 if(r.kind==='normRetake'){validateNormRetake(r);return;}
 if(r.kind==='publicNewsDraft'){validateNewsDraft(r);return;}
 if(r.kind==='schoolCompetition'){validateSchoolCompetition(r);return;}
 if(r.kind==='teacherPortfolio'){validateTeacherPortfolio(r);return;}
 if(r.kind==='studentGoal'){validateStudentGoal(r);return;}
 if(materialKinds.includes(r.kind)){validateMaterial(r);return;}
 if(r.kind==='opponentNote'){validateOpponentNote(r);return;}
 if(r.kind==='videoReview'){validateVideoReview(r);return;}
 if(r.kind==='briefing'){validateBriefing(r);return;}
 if(r.kind==='gymBoard'){validateGymBoard(r);return;}
 if(r.kind==='gradeHistory'){validateGradeHistory(r);return;}
 if(r.kind==='inventory'){validateInventory(r);return;}
 if(r.kind==='achievement'){validateAchievement(r);return;}
 if(r.kind==='tacticBoard'){validateBoard(r);return;}
 if(r.kind==='coachGoal'){validateGoal(r);return;}
 if(r.kind==='seasonPlan'){validateSeasonPlan(r);return;}
 if(r.kind==='rubric'){validateRubric(r);return;}
 if(r.kind==='normAssignment'){validateNormAssignment(r);return;}
 if(r.kind==='tournament'){validateTournament(r);return;}
 if(r.kind==='event'){validateEvent(r);return;}
 if(r.kind==='exercise'){validateExercise(r);require(!r.id.startsWith('builtin-'),'Системное упражнение нельзя перезаписать');return;}
 if(r.kind==='plan'){
  require(only(r,['id','kind','name','context','minutes','goal','equipment','audience','items','tactics','resources','gymBoards'])&&txt(r.name)&&Object.hasOwn(contexts,r.context)&&minutes(r.minutes)&&opt(r.goal,4000)&&opt(r.equipment,1000)&&opt(r.audience,200)&&Array.isArray(r.items)&&r.items.length>0&&r.items.length<=100,'Проверьте конспект');
  if(r.gymBoards!==undefined){require(Array.isArray(r.gymBoards)&&r.gymBoards.length<=10,'Проверьте схемы зала');for(const b of r.gymBoards)validateGymBoard(b);}
  if(r.tactics!==undefined){require(r.context==='coach'&&Array.isArray(r.tactics)&&r.tactics.length<=10,'Проверьте схемы тренировки');for(const b of r.tactics)validateBoard(b);}
  if(r.resources!==undefined)require(Array.isArray(r.resources)&&r.resources.length<=50&&r.resources.every(x=>only(x,['itemId','name','unit','qty'])&&txt(x.itemId)&&txt(x.name)&&txt(x.unit,30)&&Number.isInteger(x.qty)&&x.qty>0&&x.qty<=1000000)&&new Set(r.resources.map(x=>x.itemId)).size===r.resources.length,'Проверьте потребность в инвентаре');
  let last=-1,total=0;
  for(const i of r.items){require(only(i,['phase','exercise','minutes','notes'])&&Object.hasOwn(phases,i.phase)&&minutes(i.minutes)&&opt(i.notes,2000),'Проверьте этап конспекта');validateExercise(i.exercise);const n=Object.keys(phases).indexOf(i.phase);require(n>=last,'Этапы должны идти по порядку');last=n;total+=i.minutes;}
  require(total<=r.minutes,'Сумма времени упражнений больше длительности занятия');return;
 }
 throw Error('Неизвестный вид рабочей записи');
}
export async function listWork(kind){return db.transaction(['workRecords'],'readonly',s=>s.workRecords.index('kind').getAll(kind));}
export async function saveWork(input){
 require(['exercise','plan','event','rubric','normAssignment','videoReview','opponentNote','publicNewsDraft'].includes(input.kind),'Для этого вида записи используйте специальную операцию');
 const r=structuredClone({...input,id:input.id||uid(input.kind)});validateWorkRecord(r);
 return db.transaction(['workRecords'],'readwrite',async s=>{
  const old=await s.workRecords.get(r.id);require(!old||old.kind===r.kind,'Нельзя изменить тип записи');if(input.id)require(old,'Запись уже удалена');
  if(r.kind==='normAssignment'){const others=await s.workRecords.index('kind').getAll('normAssignment');require(!others.some(a=>a.id!==r.id&&a.classId===r.classId&&a.normId===r.normId&&a.yearFrom===r.yearFrom&&a.yearTo===r.yearTo&&a.from<=r.to&&r.from<=a.to),'Для этого класса и норматива уже есть пересекающееся назначение');}
  await s.workRecords.put(r);return r;
 });
}
export async function deleteWork(id,kind){return db.transaction(kind==='archive'?['workRecords','students','lessons']:['workRecords'],'readwrite',async s=>{const old=await s.workRecords.get(id);require(old?.kind===kind,'Запись не найдена');if(kind==='archive'){const pupils=new Set(old.snapshot.students.map(p=>p.id)),lessons=new Set(old.snapshot.lessons.map(l=>l.id));for(const p of await s.students.getAll())pupils.delete(p.id);for(const l of await s.lessons.getAll())lessons.delete(l.id);for(const r of await s.workRecords.index('kind').getAll('gradeHistory'))if(pupils.has(r.studentId)||lessons.has(r.lessonId))await s.workRecords.delete(r.id);}await s.workRecords.delete(id);});}
export function planExercises(plan){return plan.items.map(i=>({name:i.exercise.name,activityId:i.exercise.activityId,minutes:i.minutes}));}
export function librarySearch(exercises,query='',category=''){const q=query.trim().toLowerCase();return exercises.filter(e=>(!category||e.category===category)&&(!q||[e.name,e.description,e.equipment].some(x=>x.toLowerCase().includes(q))));}

/** Read-only preview. Each exercise is checked independently against records on the lesson date. */
export function lessonPlanReview(plan,lesson,{students,activities,restrictions,exemptions}){
 require(plan?.context==='school'&&lesson?.classId&&lesson?.date,'Выберите школьный конспект и урок');
 const pupils=students.filter(s=>s.classId===lesson.classId),ids=new Set(pupils.map(s=>s.id));
 const full=new Set(exemptions.filter(e=>ids.has(e.studentId)&&exemptionCovers(e,lesson.date)).map(e=>e.studentId));
 const items=plan.items.map(item=>{
  const check=checkLessonRestrictions({lesson:{...lesson,activityIds:[item.exercise.activityId],activitiesConfirmed:true},activities,students:pupils,restrictions});
  return {item,matches:check.matches,needsReview:check.needsReview};
 });
 return {items,full:[...full],minutes:items.reduce((n,x)=>n+x.item.minutes,0),total:pupils.length};
}

/** Candidate list, never clearance. Full exemptions have no physical exercise candidates. */
export function alternativeExerciseCandidates(lesson,studentId,exercises,{students,activities,restrictions,exemptions}){
 const student=students.find(s=>s.id===studentId&&s.classId===lesson.classId);
 if(!student)throw Error('Ученик не найден в классе');
 const full=exemptions.some(e=>e.studentId===studentId&&exemptionCovers(e,lesson.date));
 const current=new Set(lesson.activityIds||[]);
 const rows=full?[]:exercises.filter(e=>e?.kind==='exercise'&&!current.has(e.activityId)).map(exercise=>{
  const check=checkLessonRestrictions({lesson:{...lesson,activityIds:[exercise.activityId],activitiesConfirmed:true},activities,students:[student],restrictions});
  return {exercise,matches:check.matches,needsReview:check.needsReview};
 }).filter(r=>!r.needsReview&&!r.matches.length);
 return {full,rows,theoretical:['Разбор правил и техники упражнения','Наблюдение и запись последовательности действий','Анализ схемы или учебного материала без физической нагрузки']};
}
