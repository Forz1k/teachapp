import {validateMatchRegulation} from './match-rules.js';
import {validateLessonAlternative} from './lesson-alternatives.js';
import {validateKtpVersion} from './ktp-history.js';
import {validateNormRetake} from './norm-retakes.js';
import {validateNewsDraft} from './public-media-drafts.js';
import {validateSchoolCompetition,validateTeacherPortfolio} from './teacher-portfolio.js';
import {validateStudentGoal} from './student-goals.js';
import {validateMaterial,materialKinds} from './library-materials.js';
import {validateOpponentNote} from './coach-opponents.js';
import {validateVideoReview,videoMarkers,importedVideoMarkers} from './video-review.js';
import {validateBriefing,validateGymBoard} from './methodical.js';
import * as nativeDb from './db.js';
import {workRecordScope} from './work-scope.js';
import {writeBoard} from './tactics.js';
import {writeGoal} from './coach-goals.js';
import {writeInventory,writeInventoryMovement} from './resources.js';
import {writeMaterial} from './library-materials.js';
import {uid,exemptionCovers} from './model.js';
import {validateGradeHistory} from './grade-history.js';
import {validateInventory,validateAchievement,equipmentStatus} from './resources.js';
import {validateBoard} from './tactics.js';
import {validateGoal} from './coach-goals.js';
import {validateSeasonPlan} from './season-plan.js';
import {validateRubric,validateNormAssignment,assignmentsOverlap} from './school-tools.js';
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
 if(r.kind==='lessonAlternative'){validateLessonAlternative(r);return;}
 if(r.kind==='stationTemplate'){validateStationTemplate(r);return;}
 if(r.kind==='ktpVersion'){validateKtpVersion(r);return;}
 if(r.kind==='matchRegulation'){validateMatchRegulation(r);return;}
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
export const fallbackReasons={weather:'Погода / перенос в зал',space:'Зал занят / мало места',equipment:'Недостаточно инвентаря',load:'Изменение нагрузки',other:'Другая причина'};
/** Independent draft in the existing plan format. No new record type or schema.
 * The teacher must revise equipment and exercises before explicitly saving. */
export function fallbackPlanDraft(source,reason){
 validateWorkRecord(source);
 require(source.kind==='plan'&&source.context==='school'&&Object.hasOwn(fallbackReasons,reason),'Выберите школьный конспект и причину');
 const copy=structuredClone(source);delete copy.id;
 copy.name=('Резерв · '+source.name).slice(0,200);
 copy.goal=('Резервный сценарий: '+fallbackReasons[reason]+'. Исходный конспект: '+source.name+'.\n'+source.goal).slice(0,4000);
 // The original hall/stock assumptions may no longer hold.
 copy.resources=[];copy.gymBoards=[];copy.equipment='';
 return copy;
}
/** Plan stations in parallel, with equal slot duration including changeover.
 * Every group visits every station once per round. No pupil is assigned or
 * cleared for exercise here. Requirements count simultaneous station stock. */
export function validateStationTemplate(r){
 require(only(r,['id','kind','name','exercise','capacity','notes','resources','revision'])&&r.kind==='stationTemplate'&&txt(r.id)&&txt(r.name)&&Number.isInteger(r.capacity)&&r.capacity>=1&&r.capacity<=1000&&opt(r.notes,500)&&Array.isArray(r.resources)&&r.resources.length<=10&&Number.isInteger(r.revision)&&r.revision>=0&&r.revision<=1000000,'Проверьте шаблон станции');
 validateExercise(r.exercise);
 require(new Set(r.resources.map(x=>x.itemId)).size===r.resources.length&&r.resources.every(x=>only(x,['itemId','name','unit','qty'])&&txt(x.itemId)&&txt(x.name)&&txt(x.unit,30)&&Number.isInteger(x.qty)&&x.qty>0&&x.qty<=1000000),'Проверьте инвентарь станции');
 return r;
}
export function stationFromTemplate(r){validateStationTemplate(r);return structuredClone({exercise:r.exercise,capacity:r.capacity,notes:r.notes,resources:r.resources});}
export function circuitDraft({name,minutes:duration,rounds,work,transition,warmup,cooldown,stations,pupilCount,inventory=[]}){
 require(txt(name)&&minutes(duration)&&Number.isInteger(rounds)&&rounds>=1&&rounds<=8&&minutes(work)&&Number.isInteger(transition)&&transition>=0&&transition<=15&&Array.isArray(stations)&&stations.length>=2&&stations.length<=10&&Number.isInteger(pupilCount)&&pupilCount>=0&&pupilCount<=1000,'Проверьте параметры круговой тренировки');
 validateExercise(warmup.exercise);validateExercise(cooldown.exercise);
 require(minutes(warmup.minutes)&&minutes(cooldown.minutes),'Укажите время разминки и завершения');
 const groups=stations.length,groupSize=Math.ceil(pupilCount/groups),requirements=new Map(),items=[];
 const total=warmup.minutes+cooldown.minutes+rounds*groups*(work+transition);
 require(total<=duration&&rounds*groups+2<=100,'Круговая тренировка не помещается во время занятия');
 for(const station of stations){
  validateExercise(station.exercise);
  require(Number.isInteger(station.capacity)&&station.capacity>=1&&station.capacity<=1000&&opt(station.notes,500)&&Array.isArray(station.resources)&&station.resources.length<=10,'Проверьте вместимость и описание станции');
  require(new Set(station.resources.map(r=>r.itemId)).size===station.resources.length,'Повторяющийся инвентарь станции');
  for(const r of station.resources){
   require(only(r,['itemId','name','unit','qty'])&&txt(r.itemId)&&txt(r.name)&&txt(r.unit,30)&&Number.isInteger(r.qty)&&r.qty>0&&r.qty<=1000000,'Проверьте инвентарь станции');
   const prev=requirements.get(r.itemId);
   require(!prev||prev.unit===r.unit,'Разные единицы инвентаря');
   const qty=(prev?.qty||0)+r.qty;require(qty<=1000000,'Слишком большая потребность');
   requirements.set(r.itemId,{...r,qty});
  }
 }
 require(requirements.size<=50,'Не более 50 разных видов инвентаря');
 const item=(phase,exercise,minutes,notes)=>({phase,exercise:structuredClone(exercise),minutes,notes});
 items.push(item('intro',warmup.exercise,warmup.minutes,'Общая разминка; проверить индивидуальные ограничения.'));
 for(let round=1;round<=rounds;round++)for(let i=0;i<groups;i++){
  const s=stations[i];
  items.push(item('main',s.exercise,work+transition,'Круг '+round+'/'+rounds+' · станция '+(i+1)+'/'+groups+' · работа '+work+' мин, переход/организация '+transition+' мин. Группы работают параллельно и циклически меняют станции; эта строка — один временной слот, не общая последовательная работа класса. Вместимость '+s.capacity+'. '+s.notes));
 }
 items.push(item('end',cooldown.exercise,cooldown.minutes,'Завершение; фактическую нагрузку подтвердить отдельно.'));
 const resources=[...requirements.values()];
 const plan={kind:'plan',name,context:'school',minutes:duration,goal:'Круговая организация: '+groups+' станций, '+rounds+' кругов. Группы одновременно работают на разных станциях, после каждого слота циклически переходят на следующую. Учитель проверяет допуск, состав групп и реальную нагрузку.',equipment:'Потребность рассчитана для одновременной работы всех станций. Проверить наличие и безопасность.',audience:'',items,resources,gymBoards:[]};
 validateWorkRecord({...plan,id:'circuit-preview'});
 const rotation=Array.from({length:groups},(_,slot)=>Array.from({length:groups},(_,group)=>(group+slot)%groups+1));
 return {plan,total,groups,groupSize,rotation,capacityIssues:stations.map((s,i)=>({station:i+1,capacity:s.capacity,required:groupSize})).filter(s=>s.capacity<groupSize),stock:equipmentStatus(resources,inventory)};
}
/** Use the same stored plan format. No athlete names, goals, private notes,
 * match identifiers or medical data are copied into portable plan snapshots. */
export function matchTrainingDraft({exercises,selectedIds,minutes:duration}){
 require(Array.isArray(exercises)&&Array.isArray(selectedIds)&&selectedIds.length>0&&selectedIds.length<=50&&new Set(selectedIds).size===selectedIds.length&&minutes(duration),'Выберите упражнения и длительность тренировки');
 const byId=new Map(exercises.map(e=>[e.id,e])),items=[{phase:'intro',exercise:structuredClone(builtinExercises[0]),minutes:5,notes:'Разминка; проверить ограничения и адаптировать нагрузку.'}];
 for(const id of selectedIds){
  const e=byId.get(id);validateExercise(e);
  require(e.category!=='warmup'&&e.category!=='cooldown','Выберите упражнения основной части');
  items.push({phase:'main',exercise:structuredClone(e),minutes:e.minutes,notes:'Уточнить методику, число повторений и индивидуальную нагрузку перед занятием.'});
 }
 items.push({phase:'end',exercise:structuredClone(builtinExercises[3]),minutes:5,notes:'Спокойное завершение.'});
 const total=items.reduce((n,i)=>n+i.minutes,0);
 require(total<=duration,'Выбранные упражнения не помещаются в тренировку');
 const plan={kind:'plan',name:'Тренировка по итогам матча',context:'coach',minutes:duration,goal:'Отработать выбранные тренером элементы по результатам наблюдений и действующим задачам. Состав и нагрузку подтвердить отдельно.',equipment:'Проверить инвентарь по выбранным упражнениям.',audience:'',items,resources:[]};
 validateWorkRecord({...plan,id:'training-preview'});return {plan,total};
}
export function planExercises(plan){return plan.items.map(i=>({name:i.exercise.name,activityId:i.exercise.activityId,minutes:i.minutes}));}
export function librarySearch(exercises,query='',category=''){const q=query.trim().toLowerCase();return exercises.filter(e=>(!category||e.category===category)&&(!q||[e.name,e.description,e.equipment].some(x=>x.toLowerCase().includes(q))));}

/** Read-only preview. Each exercise is checked independently against records on the lesson date. */
export function lessonPlanReview(plan,lesson,{students,activities,restrictions,exemptions}){
 require(plan?.context==='school'&&lesson?.classId&&lesson?.date,'Выберите школьный конспект и урок');
 const pupils=students.filter(s=>s.classId===lesson.classId),ids=new Set(pupils.map(s=>s.id));
 const full=new Set(exemptions.filter(e=>ids.has(e.studentId)&&exemptionCovers(e,lesson.date)).map(e=>e.studentId));
 const items=plan.items.map(item=>{
  const check=checkLessonRestrictions({lesson:{...lesson,activityIds:[item.exercise.activityId],activitiesConfirmed:true},activities,students:pupils,restrictions});
  return {item,matches:check.matches,potentialMatches:check.potentialMatches,needsReview:check.needsReview};
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

function buildWorkCommands(db,scope=null){
 const allow=r=>require(!scope||workRecordScope(r)===scope,'Рабочая запись недоступна в этой области');
async function listWork(kind){
 if(scope&&kind==='archive')throw Error('Архив недоступен в ограниченном сеансе');
 return db.transaction(['workRecords'],'readonly',async s=>{const rows=await s.workRecords.index('kind').getAll(kind);return scope?rows.filter(r=>workRecordScope(r)===scope):rows;});
}
async function saveWork(input){
 require(['exercise','plan','event','rubric','normAssignment','videoReview','opponentNote','publicNewsDraft'].includes(input.kind),'Для этого вида записи используйте специальную операцию');
 const r=structuredClone({...input,id:input.id||uid(input.kind)});validateWorkRecord(r);allow(r);
 return db.transaction(r.kind==='normAssignment'?['workRecords','classes','students','norms','meta']:['workRecords'],'readwrite',async s=>{
  const old=await s.workRecords.get(r.id);if(old)allow(old);require(!old||old.kind===r.kind,'Нельзя изменить тип записи');if(input.id)require(old,'Запись уже удалена');
  if(r.kind==='normAssignment'){
   require(!old||(old.revision??0)===(input.revision??0),'Назначение изменилось. Откройте заново');
   const year=(await s.meta.get('settings'))?.year;
   require(await s.classes.get(r.classId)&&await s.norms.get(r.normId)&&(!year||year.from===r.yearFrom&&year.to===r.yearTo),'Класс, норматив или учебный год недоступны');
   if(r.studentIds){const pupils=new Set((await s.students.index('classId').getAll(r.classId)).map(p=>p.id));require(r.studentIds.every(id=>pupils.has(id)),'Выберите учеников этого класса');}
   const others=await s.workRecords.index('kind').getAll('normAssignment');require(!others.some(a=>a.id!==r.id&&assignmentsOverlap(a,r)),'Для этого класса и норматива уже есть пересекающееся назначение');
   if(old){const linked=(await s.workRecords.index('kind').getAll('normRetake')).filter(x=>x.assignmentId===r.id&&x.status!=='cancelled');require(!linked.length||old.classId===r.classId&&old.normId===r.normId&&old.yearFrom===r.yearFrom&&old.yearTo===r.yearTo&&linked.every(x=>!r.studentIds||r.studentIds.includes(x.studentId)),'Есть планы пересдач: нельзя изменить класс, норматив или исключить их участников');}
   r.revision=old?(old.revision??0)+1:0;validateNormAssignment(r);
  }
  await s.workRecords.put(r);return r;
 });
}
/** Compare-and-save for the video editor. No schema or revision migration:
 * expected is the exact previously read record, or null for a new review. */
async function saveVideoReview(input,expected){
 require(expected===null||expected?.kind==='videoReview'&&expected.id===input?.id&&expected.matchId===input?.matchId,'Требуется исходный снимок видеоразбора');
 require(input?.kind==='videoReview'&&(expected!==null||!input.id),'Проверьте новую запись видеоразбора');
 const next=structuredClone({...input,id:input.id||uid('videoReview')}),baseline=structuredClone(expected);
 validateVideoReview(next);allow(next);
 return db.transaction(['workRecords','coachMatches'],'readwrite',async s=>{
  const reviews=(await s.workRecords.index('kind').getAll('videoReview')).filter(r=>r.matchId===next.matchId);
  require(reviews.length<=1,'Найдены дубликаты видеоразбора. Требуется проверка данных');
  const actual=reviews[0]??null;
  require(JSON.stringify(actual)===JSON.stringify(baseline),'Видеоразбор изменился в другой вкладке. Откройте его заново');
  const match=await s.coachMatches.get(next.matchId);
  require(match&&(match.detail||match.imported),'Протокол матча недоступен');
  const markers=match.detail?videoMarkers(match.detail,0):importedVideoMarkers(match,[]);
  const count=markers.length;
  require([...next.anchors,...next.notes].every(x=>x.index<=count),'Розыгрыш отсутствует в протоколе');
  if(match.detail&&next.anchors.length) {
   // Validate increasing recorded times as well as manual video times.
   const byIndex=new Map(markers.map(m=>[m.index,m.seconds]));
   require(next.anchors.every((a,i)=>i===0||byIndex.get(a.index)>byIndex.get(next.anchors[i-1].index)),'Контрольные точки должны иметь различное время записи');
  }
  if(actual)await s.workRecords.put(next);else await s.workRecords.add(next);
  return next;
 });
}
async function deleteWork(id,kind){if(scope&&kind==='archive')throw Error('Архив недоступен в ограниченном сеансе');return db.transaction(kind==='archive'?['workRecords','students','lessons']:['workRecords'],'readwrite',async s=>{const old=await s.workRecords.get(id);require(old?.kind===kind,'Запись не найдена');allow(old);if(kind==='schoolCompetition')require(!(await s.workRecords.index('kind').getAll('schoolCompetition')).some(x=>x.previousStageId===id),'Сначала удалите связанный следующий этап');if(kind==='archive'){const pupils=new Set(old.snapshot.students.map(p=>p.id)),lessons=new Set(old.snapshot.lessons.map(l=>l.id));for(const p of await s.students.getAll())pupils.delete(p.id);for(const l of await s.lessons.getAll())lessons.delete(l.id);for(const r of await s.workRecords.index('kind').getAll('gradeHistory'))if(pupils.has(r.studentId)||lessons.has(r.lessonId))await s.workRecords.delete(r.id);}await s.workRecords.delete(id);});}
async function saveStationTemplate(input){
 const r=structuredClone({...input,kind:'stationTemplate',id:input.id||uid('stationTemplate'),revision:input.id?input.revision+1:0});validateStationTemplate(r);allow(r);
 return db.transaction(['workRecords'],'readwrite',async s=>{const old=await s.workRecords.get(r.id);require(input.id?old?.kind==='stationTemplate'&&old.revision===input.revision:!old,'Шаблон изменился. Откройте заново');await s.workRecords.put(r);return r;});
}
 return Object.freeze({listWork,saveWork,saveVideoReview,deleteWork,saveStationTemplate});
}
export const {listWork,saveWork,saveVideoReview,deleteWork,saveStationTemplate}=buildWorkCommands(nativeDb);

/** Explicit row-scoped access to mixed workRecords. No generic table handle.
 * Workspace records are owner-only, not a wildcard. Cross-scope archives and
 * localStorage document presets are deliberately outside this API. */
export function createWorkSession(access,scope){
 require(['school','coach','workspace'].includes(scope)&&typeof access?.transaction==='function'&&typeof access.close==='function','Требуется явный интерфейс рабочей области');
 let closed=false,tail=Promise.resolve();
 const guard=()=>require(!closed,'Рабочий сеанс заблокирован');
 const close=()=>{if(closed)return;closed=true;access.close();};
 const tables=new Set(['workRecords',...(scope==='school'?['classes','students','norms','meta']:scope==='coach'?['coachTeams','coachPlayers','coachMatches']:[])]);
 const db=Object.freeze({async transaction(names,mode,fn){
  guard();require(Array.isArray(names)&&names.length&&names.every(n=>tables.has(n)),'Хранилище недоступно в этой области');
  const result=await access.transaction(names,mode,fn);guard();return result;
 }});
 const core={...buildWorkCommands(db,scope),saveMaterial:r=>{require(workRecordScope(r)===scope,'Рабочая запись недоступна в этой области');return writeMaterial(db,r);}};
 if(scope==='coach')Object.assign(core,{saveBoard:input=>writeBoard(db,input),saveGoal:input=>writeGoal(db,input)});
 if(scope==='workspace')Object.assign(core,{saveInventory:input=>writeInventory(db,input),inventoryMovement:(...a)=>writeInventoryMovement(db,...a)});
 const api={scope,close,isClosed:()=>closed};
 for(const [name,fn] of Object.entries(core)){
  api[name]=async(...args)=>{
   guard();const input=structuredClone(args);
   const job=tail.then(async()=>{
    guard();
    try{const result=await fn(...input);guard();return result;}catch(e){close();throw e;}
   });
   tail=job.then(()=>undefined,()=>undefined);return job;
  };
 }
 return Object.freeze(api);
}
