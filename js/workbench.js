import * as db from './db.js';
import {uid} from './model.js';
import {validateRubric} from './school-tools.js';
import {validateTournament} from './tournaments.js';
import {validateEvent} from './work-calendar.js';
import {catalog} from './health.js';
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
 if(r.kind==='rubric'){validateRubric(r);return;}
 if(r.kind==='tournament'){validateTournament(r);return;}
 if(r.kind==='event'){validateEvent(r);return;}
 if(r.kind==='exercise'){validateExercise(r);require(!r.id.startsWith('builtin-'),'Системное упражнение нельзя перезаписать');return;}
 if(r.kind==='plan'){
  require(only(r,['id','kind','name','context','minutes','goal','equipment','audience','items'])&&txt(r.name)&&Object.hasOwn(contexts,r.context)&&minutes(r.minutes)&&opt(r.goal,4000)&&opt(r.equipment,1000)&&opt(r.audience,200)&&Array.isArray(r.items)&&r.items.length>0&&r.items.length<=100,'Проверьте конспект');
  let last=-1,total=0;
  for(const i of r.items){require(only(i,['phase','exercise','minutes','notes'])&&Object.hasOwn(phases,i.phase)&&minutes(i.minutes)&&opt(i.notes,2000),'Проверьте этап конспекта');validateExercise(i.exercise);const n=Object.keys(phases).indexOf(i.phase);require(n>=last,'Этапы должны идти по порядку');last=n;total+=i.minutes;}
  require(total<=r.minutes,'Сумма времени упражнений больше длительности занятия');return;
 }
 throw Error('Неизвестный вид рабочей записи');
}
export async function listWork(kind){return (await db.getAll('workRecords')).filter(r=>r.kind===kind);}
export async function saveWork(input){
 require(['exercise','plan','event','rubric'].includes(input.kind),'Для этого вида записи используйте специальную операцию');
 const r=structuredClone({...input,id:input.id||uid(input.kind)});validateWorkRecord(r);
 return db.transaction(['workRecords'],'readwrite',async s=>{
  const old=await s.workRecords.get(r.id);require(!old||old.kind===r.kind,'Нельзя изменить тип записи');if(input.id)require(old,'Запись уже удалена');await s.workRecords.put(r);return r;
 });
}
export async function deleteWork(id,kind){return db.transaction(['workRecords'],'readwrite',async s=>{const old=await s.workRecords.get(id);require(old?.kind===kind,'Запись не найдена');await s.workRecords.delete(id);});}
export function planExercises(plan){return plan.items.map(i=>({name:i.exercise.name,activityId:i.exercise.activityId,minutes:i.minutes}));}
export function librarySearch(exercises,query='',category=''){const q=query.trim().toLowerCase();return exercises.filter(e=>(!category||e.category===category)&&(!q||[e.name,e.description,e.equipment].some(x=>x.toLowerCase().includes(q))));}
