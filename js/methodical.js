import * as db from './db.js';
import {uid,todayIso} from './model.js';
import {validPeriod} from './health.js';
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const plain=o=>o&&typeof o==='object'&&!Array.isArray(o);
const only=(o,keys)=>plain(o)&&Object.keys(o).every(k=>keys.includes(k));
const text=(s,n=200)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const opt=(s,n)=>typeof s==='string'&&s.length<=n;
export const briefingCategories={intro:'Вводный',lesson:'Перед занятием',event:'Перед мероприятием',repeat:'Повторный',other:'Другой'};
export const briefingTemplates=['Правила поведения и безопасности в спортивном зале','Безопасное использование спортивного инвентаря','Организация безопасного выполнения упражнений','Порядок действий при плохом самочувствии и происшествии'];
export function validateBriefing(r){
 check(only(r,['id','kind','classId','className','date','category','topic','participantIds','note'])&&r.kind==='briefing'&&text(r.id)&&text(r.classId)&&text(r.className)&&validPeriod(r.date,null)&&Object.hasOwn(briefingCategories,r.category)&&text(r.topic,500)&&opt(r.note,2000)&&Array.isArray(r.participantIds)&&r.participantIds.length<=500&&r.participantIds.every(id=>text(id))&&new Set(r.participantIds).size===r.participantIds.length,'Проверьте данные инструктажа');return r;
}
export async function saveBriefing(input,confirmed=false){return writeBriefing(db,input,confirmed);}
export async function writeBriefing(access,input,confirmed=false){
 check(confirmed,'Подтвердите фактическое проведение инструктажа');
 return access.transaction(['workRecords','classes','students'],'readwrite',async s=>{
  const cls=await s.classes.get(input.classId);check(cls&&input.date<=todayIso(),'Выберите существующий класс и прошедшую или текущую дату');
  const ids=new Set((await s.students.index('classId').getAll(cls.id)).map(x=>x.id));check(Array.isArray(input.participantIds)&&input.participantIds.length&&input.participantIds.every(id=>ids.has(id)),'Выберите фактических участников класса');
  const r={id:uid('briefing'),kind:'briefing',classId:cls.id,className:cls.name,date:input.date,category:input.category,topic:input.topic,participantIds:[...input.participantIds],note:input.note||''};validateBriefing(r);await s.workRecords.add(r);return r;
 });
}
export function briefingReport(rows,students,archives=[]){
 const names=new Map([...archives.flatMap(a=>a.snapshot?.students||[]),...students].map(s=>[s.id,s.fullName]));
 return {title:'Журнал инструктажей по безопасности',personal:true,sections:[{heading:'Фактические записи',paragraphs:['Рабочая форма. Содержание, порядок проведения и требования к подписям проверяет образовательная организация. Подписи не создаются автоматически.'],matrix:[['Дата','Класс','Категория','Тема','Участник','Подпись'],...rows.flatMap(r=>r.participantIds.map(id=>[r.date,r.className,briefingCategories[r.category],r.topic,names.get(id)||'Запись ученика недоступна','']))]}]};
}
export const gymCourts={gym:'Спортивный зал',volleyball:'Волейбольная площадка',basketball:'Баскетбольная площадка',free:'Свободная схема'};
export const gymObjects={cone:'Конус',ball:'Мяч',bench:'Скамейка',mat:'Мат',group:'Группа',station:'Станция'};
const point=o=>only(o,['x','y'])&&Number.isInteger(o.x)&&o.x>=15&&o.x<=285&&Number.isInteger(o.y)&&o.y>=15&&o.y<=585;
export function validateGymBoard(r){
 check(only(r,['id','kind','name','court','note','markers','arrows'])&&r.kind==='gymBoard'&&text(r.id)&&text(r.name)&&Object.hasOwn(gymCourts,r.court)&&opt(r.note,2000),'Проверьте схему занятия');
 check(Array.isArray(r.markers)&&r.markers.length<=60&&r.markers.every(m=>only(m,['id','type','label','x','y'])&&text(m.id)&&Object.hasOwn(gymObjects,m.type)&&text(m.label,30)&&point({x:m.x,y:m.y}))&&new Set(r.markers.map(m=>m.id)).size===r.markers.length,'Проверьте объекты схемы');
 check(Array.isArray(r.arrows)&&r.arrows.length<=100&&r.arrows.every(a=>only(a,['id','from','to'])&&text(a.id)&&point(a.from)&&point(a.to)&&(a.from.x!==a.to.x||a.from.y!==a.to.y))&&new Set(r.arrows.map(a=>a.id)).size===r.arrows.length,'Проверьте направления');return r;
}
export async function saveGymBoard(input){return writeGymBoard(db,input);}
export async function writeGymBoard(access,input){
 const r=structuredClone({...input,kind:'gymBoard',id:input.id||uid('gym')});validateGymBoard(r);
 return access.transaction(['workRecords'],'readwrite',async s=>{const old=await s.workRecords.get(r.id);check(!old||old.kind==='gymBoard','Недопустимая замена записи');if(input.id)check(old,'Схема уже удалена');await s.workRecords.put(r);return r;});
}
