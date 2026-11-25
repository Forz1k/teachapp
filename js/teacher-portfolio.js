import * as db from './db.js';
import {uid,todayIso,inRange,addDays} from './model.js';
import {validPeriod} from './health.js';
import {lineageOf} from './school-tools.js';
const check=(x,m)=>{if(!x)throw Error(m);};
const only=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k));
const text=(x,n=200)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
const opt=(x,n=2000)=>typeof x==='string'&&x.length<=n;
const revision=x=>Number.isInteger(x)&&x>=0&&x<=1000000;
export const competitionStages={school:'Школьный',city:'Муниципальный',region:'Региональный',national:'Всероссийский',other:'Другой'};
export const competitionTypes={olympiad:'Олимпиада',sport:'Спортивное соревнование',festival:'Спортивный праздник',other:'Другое мероприятие'};
export const participantStates={registered:'Заявлен',participated:'Участвовал',absent:'Не участвовал',withdrawn:'Снят с заявки'};
export const portfolioKinds={achievement:'Профессиональное достижение',event:'Мероприятие',openLesson:'Открытый урок',methodical:'Методический материал',course:'Повышение квалификации',other:'Другое'};
export function validateSchoolCompetition(r){
 check(only(r,['id','kind','name','eventType','stage','date','time','venue','status','note','participants','revision'])&&r.kind==='schoolCompetition'&&text(r.id)&&text(r.name)&&Object.hasOwn(competitionTypes,r.eventType)&&Object.hasOwn(competitionStages,r.stage)&&validPeriod(r.date,null)&&typeof r.time==='string'&&(r.time===''||/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time))&&opt(r.venue,300)&&['planned','completed','cancelled'].includes(r.status)&&opt(r.note)&&revision(r.revision)&&Array.isArray(r.participants)&&r.participants.length<=500,'Проверьте мероприятие');
 const ids=new Set();for(const p of r.participants){
  check(only(p,['studentId','className','status','result','place'])&&text(p.studentId)&&!ids.has(p.studentId)&&opt(p.className,100)&&Object.hasOwn(participantStates,p.status)&&opt(p.result,300)&&(p.place===null||Number.isInteger(p.place)&&p.place>=1&&p.place<=100000),'Проверьте участника и результат');
  check(p.status==='participated'||(!p.result&&p.place===null),'Результат допустим только для участника');ids.add(p.studentId);
 }
 check(r.status==='completed'||r.participants.every(p=>p.status==='registered'||p.status==='withdrawn'),'Фактические результаты вносятся после проведения');check(r.status!=='completed'||r.date<=todayIso(),'Нельзя отметить будущее мероприятие проведённым');
 return r;
}
export async function saveSchoolCompetition(input){
 return db.transaction(['workRecords','students','classes'],'readwrite',async s=>{
  const old=input.id?await s.workRecords.get(input.id):null;check(!input.id||old?.kind==='schoolCompetition'&&old.revision===input.revision,'Запись изменилась. Откройте заново');
  const students=await s.students.getAll(),classes=await s.classes.getAll(),ids=new Map(students.map(p=>[lineageOf(p),p])),previous=new Map((old?.participants||[]).map(p=>[p.studentId,p]));
  const participants=input.participants.map(p=>{const current=ids.get(p.studentId),existing=previous.get(p.studentId);check(current||existing,'Ученик недоступен');return {...p,className:existing?.className??classes.find(c=>c.id===current?.classId)?.name??''};});
  const r={...input,id:input.id||uid('schoolCompetition'),kind:'schoolCompetition',participants,revision:old?old.revision+1:0};validateSchoolCompetition(r);await s.workRecords.put(r);return r;
 });
}
export function validateTeacherPortfolio(r){
 check(only(r,['id','kind','category','name','date','result','evidence','note','revision'])&&r.kind==='teacherPortfolio'&&text(r.id)&&Object.hasOwn(portfolioKinds,r.category)&&text(r.name)&&validPeriod(r.date,null)&&r.date<=todayIso()&&opt(r.result,1000)&&opt(r.evidence,1000)&&opt(r.note)&&revision(r.revision),'Проверьте запись портфолио');return r;
}
export async function saveTeacherPortfolio(input){
 return db.transaction(['workRecords'],'readwrite',async s=>{const old=input.id?await s.workRecords.get(input.id):null;check(!input.id||old?.kind==='teacherPortfolio'&&old.revision===input.revision,'Запись изменилась. Откройте заново');const r={...input,kind:'teacherPortfolio',id:input.id||uid('teacherPortfolio'),revision:old?old.revision+1:0};validateTeacherPortfolio(r);await s.workRecords.put(r);return r;});
}
export function schoolCompetitionCalendar(rows,from,to){
 return rows.filter(r=>r.status!=='cancelled'&&inRange(r.date,from,to)).map(r=>({id:'school-event-'+r.id,source:'schoolCompetition',date:r.date,time:r.time,minutes:0,title:r.name+' · '+competitionStages[r.stage],exportTitle:competitionTypes[r.eventType],done:r.status==='completed',remind:r.status==='planned'?1440:null,competitionId:r.id}));
}
export function competitionDocument(r,names,{protocol=false,organization='',author=''}={}){
 validateSchoolCompetition(r);
 const chosen=r.participants.filter(p=>protocol?p.status==='participated':p.status==='registered'||p.status==='participated');
 const matrix=protocol?[['№','Участник','Класс','Результат','Место'],...chosen.map((p,i)=>[i+1,names.get(p.studentId)||'Запись недоступна',p.className,p.result,p.place??''])]:[['№','Участник','Класс','Подпись'],...chosen.map((p,i)=>[i+1,names.get(p.studentId)||'Запись недоступна',p.className,''])];
 return {title:(protocol?'Итоговый протокол · ':'Заявка · ')+r.name,personal:true,sections:[{heading:'Общие сведения',paragraphs:[organization&&'Организация: '+organization,author&&'Ответственный: '+author,'Дата: '+r.date,competitionStages[r.stage],r.venue,'Рабочая форма. Требования организатора и основания передачи данных проверьте отдельно.'].filter(Boolean),matrix:null},{heading:protocol?'Фактические результаты':'Заявленные участники',paragraphs:[],matrix}]};
}
export function teacherPortfolioReview({portfolio=[],competitions=[],events=[],achievements=[],plans=[]},{from,to}){
 check(validPeriod(from,to)&&to&&to<=addDays(from,370),'Выберите период до 371 дня');
 const inDates=r=>inRange(r.date,from,to),records=portfolio.filter(inDates).sort((a,b)=>b.date.localeCompare(a.date)),held=competitions.filter(r=>r.status==='completed'&&inDates(r)),done=events.filter(r=>r.done&&inDates(r)),awards=achievements.filter(r=>['student','class'].includes(r.subjectType)&&inDates(r));
 return {records,held,done,awards,plans:plans.filter(p=>p.context==='school'),counts:{records:records.length,competitions:held.length,participations:held.reduce((n,r)=>n+r.participants.filter(p=>p.status==='participated').length,0),events:done.length,achievements:awards.length}};
}
export function teacherPortfolioDocument(review,{from,to,organization='',author=''}){
 return {title:'Портфолио учителя · '+from+' — '+to,personal:true,sections:[
 {heading:'Общие сведения',paragraphs:[organization&&'Организация: '+organization,author&&'Учитель: '+author,'Рабочая подборка подтверждённых записей. Не является официальной формой аттестации.'].filter(Boolean),matrix:[['Показатель','Количество'],['Профессиональные записи',review.counts.records],['Проведённые соревнования и олимпиады',review.counts.competitions],['Участия (не уникальные ученики)',review.counts.participations],['Завершённые события календаря',review.counts.events],['Школьные достижения',review.counts.achievements]]},
 {heading:'Профессиональные записи',paragraphs:[],matrix:[['Дата','Категория','Название','Результат','Подтверждение','Заметка'],...review.records.map(r=>[r.date,portfolioKinds[r.category],r.name,r.result,r.evidence,r.note])]},
 {heading:'Проведённые соревнования',paragraphs:[],matrix:[['Дата','Мероприятие','Этап','Участия'],...review.held.map(r=>[r.date,r.name,competitionStages[r.stage],r.participants.filter(p=>p.status==='participated').length])]},
 {heading:'Завершённые события календаря',paragraphs:[],matrix:[['Дата','Событие','Минуты'],...review.done.map(r=>[r.date,r.name,r.minutes||'—'])]},
 {heading:'Школьные достижения (без имён)',paragraphs:[],matrix:[['Дата','Мероприятие','Результат'],...review.awards.map(r=>[r.date,r.title,r.result])]},
 {heading:'Методические материалы',paragraphs:['Конспекты библиотеки перечислены без даты создания, поэтому не включены в количественные итоги периода.'],matrix:[['Конспект','Минуты'],...review.plans.map(r=>[r.name,r.minutes])]}
 ]};
}
