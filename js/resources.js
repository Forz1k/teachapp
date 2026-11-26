import * as db from './db.js';
import {uid,todayIso} from './model.js';
import {validPeriod} from './health.js';
import {lineageOf} from './school-tools.js';
const check=(ok,m)=>{if(!ok)throw Error(m);};
const text=(s,max=200)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
const opt=(s,max=2000)=>typeof s==='string'&&s.length<=max;
const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
const qty=n=>Number.isInteger(n)&&n>=0&&n<=1000000;
export const conditions={good:'Исправный',repair:'Требует ремонта',unusable:'Непригодный'};
export const movementTypes={add:'Поступление',move:'Изменение состояния',writeOff:'Списание'};
export const achievementTypes={student:'Ученик',class:'Класс',player:'Спортсменка',team:'Команда'};
export const levels={school:'Школьный / клубный',city:'Муниципальный',region:'Региональный',national:'Всероссийский',other:'Другой'};
export function inventoryBalance(r){
 check(only(r.initial,Object.keys(conditions))&&Object.keys(conditions).every(k=>qty(r.initial[k])),'Проверьте начальный остаток');
 const stock={...r.initial},ids=new Set();
 check(Array.isArray(r.movements)&&r.movements.length<=10000,'Некорректная история инвентаря');
 for(const m of r.movements){
  check(only(m,['id','date','type','from','to','qty','note'])&&text(m.id)&&!ids.has(m.id)&&validPeriod(m.date,null)&&m.date<=todayIso()&&Object.hasOwn(movementTypes,m.type)&&qty(m.qty)&&m.qty>0&&text(m.note,1000),'Проверьте операцию, количество и основание');
  ids.add(m.id);
  if(m.type==='add'){check(m.from===null&&Object.hasOwn(conditions,m.to),'Проверьте состояние поступления');stock[m.to]+=m.qty;}
  if(m.type==='move'){check(Object.hasOwn(conditions,m.from)&&Object.hasOwn(conditions,m.to)&&m.from!==m.to,'Выберите разные состояния');stock[m.from]-=m.qty;stock[m.to]+=m.qty;}
  if(m.type==='writeOff'){check(Object.hasOwn(conditions,m.from)&&m.to===null,'Выберите состояние списания');stock[m.from]-=m.qty;}
  check(Object.values(stock).every(qty),'Количество превышает остаток или допустимый объём');
 }
 return {...stock,total:Object.values(stock).reduce((a,b)=>a+b,0)};
}
export function validateInventory(r){
 check(only(r,['id','kind','name','category','unit','location','minimum','initial','movements','archived','revision'])&&r.kind==='inventory'&&text(r.id)&&text(r.name)&&text(r.category)&&text(r.unit,30)&&opt(r.location,200)&&qty(r.minimum)&&typeof r.archived==='boolean'&&Number.isInteger(r.revision)&&r.revision>=0&&r.revision<=1000000,'Проверьте карточку инвентаря');
 inventoryBalance(r);return r;
}
export async function saveInventory(input){return writeInventory(db,input);}
export async function writeInventory(access,input){
 return access.transaction(['workRecords'],'readwrite',async s=>{
  const old=input.id?await s.workRecords.get(input.id):null;
  check(!input.id||old?.kind==='inventory'&&old.revision===input.revision,'Карточка изменена. Откройте заново');
  if(old&&(old.movements.length||Object.values(old.initial).some(n=>n>0)))check(input.unit===old.unit,'Нельзя изменить единицу измерения существующего остатка');
  const record={id:input.id||uid('inventory'),kind:'inventory',name:input.name,category:input.category,unit:input.unit,location:input.location,minimum:input.minimum,initial:old?old.initial:input.initial,movements:old?old.movements:[],archived:input.archived===true,revision:old?old.revision+1:0};
  validateInventory(record);await s.workRecords.put(record);return record;
 });
}
export async function inventoryMovement(id,revision,input,confirmed=false){return writeInventoryMovement(db,id,revision,input,confirmed);}
export async function writeInventoryMovement(access,id,revision,input,confirmed=false){
 check(confirmed,'Подтвердите операцию');
 return access.transaction(['workRecords'],'readwrite',async s=>{
  const old=await s.workRecords.get(id);check(old?.kind==='inventory'&&!old.archived&&old.revision===revision,'Карточка изменена или в архиве');
  const record={...old,revision:old.revision+1,movements:[...old.movements,{...input,id:uid('movement')}]};validateInventory(record);await s.workRecords.put(record);return record;
 });
}
export function equipmentStatus(requirements,inventory){
 const items=new Map(inventory.map(i=>[i.id,i]));
 return (requirements||[]).map(r=>{
  const item=items.get(r.itemId),available=item&&!item.archived&&item.unit===r.unit?inventoryBalance(item).good:null;
  return {...r,available,shortage:available===null?null:Math.max(0,r.qty-available)};
 });
}
export function validateAchievement(r){
 check(only(r,['id','kind','subjectType','subjectId','title','date','level','result','note','revision'])&&r.kind==='achievement'&&text(r.id)&&Object.hasOwn(achievementTypes,r.subjectType)&&text(r.subjectId)&&text(r.title)&&validPeriod(r.date,null)&&r.date<=todayIso()&&Object.hasOwn(levels,r.level)&&text(r.result,200)&&opt(r.note,1000)&&Number.isInteger(r.revision)&&r.revision>=0&&r.revision<=1000000,'Проверьте достижение и дату');
 return r;
}
export function achievementSubjects(school,coach,archives=[]){
 const out=new Map();
 const add=(type,id,label,archived=false)=>{const k=type+'|'+id;if(!out.has(k))out.set(k,{type,id,label,archived});};
 for(const c of school.classes)add('class',c.id,c.name);
 for(const s of school.students)add('student',lineageOf(s),s.fullName+' · '+(school.classes.find(c=>c.id===s.classId)?.name||''));
 for(const t of coach.coachTeams)add('team',t.id,t.name,t.archived);
 for(const p of coach.coachPlayers)add('player',p.id,p.name+' · '+(coach.coachTeams.find(t=>t.id===p.teamId)?.name||''),p.archived);
 for(const a of [...archives].sort((a,b)=>b.year.from.localeCompare(a.year.from))){
  for(const c of a.snapshot.classes)add('class',c.id,c.name+' · архив '+a.year.from.slice(0,4),true);
  for(const s of a.snapshot.students)add('student',lineageOf(s),s.fullName+' · архив '+a.year.from.slice(0,4),true);
 }
 return [...out.values()];
}
export async function saveAchievement(input){
 return db.transaction(['workRecords','classes','students','coachTeams','coachPlayers'],'readwrite',async s=>{
  const old=input.id?await s.workRecords.get(input.id):null;
  check(!input.id||old?.kind==='achievement'&&old.revision===input.revision,'Достижение изменено. Откройте заново');
  const [classes,students,coachTeams,coachPlayers,archives]=await Promise.all([s.classes.getAll(),s.students.getAll(),s.coachTeams.getAll(),s.coachPlayers.getAll(),s.workRecords.index('kind').getAll('archive')]);
  const subjects=achievementSubjects({classes,students},{coachTeams,coachPlayers},archives);
  check(subjects.some(x=>x.type===input.subjectType&&x.id===input.subjectId)||old&&old.subjectId===input.subjectId&&old.subjectType===input.subjectType,'Участник недоступен');
  const record={...input,id:input.id||uid('achievement'),kind:'achievement',revision:old?old.revision+1:0};
  validateAchievement(record);await s.workRecords.put(record);return record;
 });
}
