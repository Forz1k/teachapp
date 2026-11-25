import * as M from './model.js';
import * as H from './health.js';
import {selectNormScale} from './assessment.js';
const text=(s,max=200)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
export function lineageOf(student){return student.lineageId||student.id;}
export function normSeriesKey(r){const d=r.definition;return JSON.stringify([r.normId,d.activityId,d.unit,d.direction]);}
export function physicalPassport(current,archives,studentId){
 const pupil=current.students.find(s=>s.id===studentId);if(!pupil)return null;
 const identity=lineageOf(pupil),years=[],series=new Map();
 const add=(data,year,archived)=>{
  const candidates=data.students.filter(s=>lineageOf(s)===identity);
  if(candidates.length!==1)return;
  const s=candidates[0],cls=data.classes.find(c=>c.id===s.classId),results=data.normResults.filter(r=>r.studentId===s.id&&r.status==='done');
  years.push({year,archived,className:cls?.name||'',count:results.length});
  for(const r of results){
   const key=normSeriesKey(r);if(!series.has(key))series.set(key,{key,name:r.definition.name,unit:r.definition.unit,direction:r.definition.direction,history:[]});
   series.get(key).history.push({id:r.id,date:r.date,value:r.value,grade:r.grade,scope:r.definition.scaleScope?.label||'',className:cls?.name||'',year,archived,basisRecorded:!!r.basis});
  }
 };
 for(const a of archives||[])add(a.snapshot,a.year,true);
 add(current,current.settings.year,false);
 years.sort((a,b)=>a.year.from.localeCompare(b.year.from));
 const groups=[...series.values()].map(g=>{
  g.history.sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  // Adapted/basis-recorded results are visible but do not enter records/trends.
  const comparable=g.history.filter(r=>!r.basisRecorded),values=comparable.map(r=>r.value);
  return {...g,first:values[0]??null,last:values.at(-1)??null,best:values.length?(g.direction==='min'?Math.min(...values):Math.max(...values)):null,comparable};
 });
 return {pupil,years,groups};
}
export function normChecklist(s,{classId,normId,from,to,targetGrade=null,today=M.todayIso(),studentIds=null,minAttempts=1}){
 const cls=s.classes.find(c=>c.id===classId),norm=s.norms.find(n=>n.id===normId);
 if(!cls||!norm||!H.validPeriod(from,to)||!to||targetGrade!==null&&![1,2,3,4,5].includes(targetGrade))throw Error('Выберите класс, норматив и период');
 const pupils=s.students.filter(p=>p.classId===classId&&(!studentIds||studentIds.includes(p.id))),byId=new Map(pupils.map(p=>[p.id,[]]));
 for(const r of s.normResults)if(r.normId===normId&&byId.has(r.studentId)&&M.inRange(r.date,from,to)&&r.date<=today)byId.get(r.studentId).push(r);
 const activities=[...H.catalog,...s.activityCategories],check=H.checkLessonRestrictions({lesson:{classId,date:today,activityIds:[norm.activityId,'test'],activitiesConfirmed:true},activities,students:pupils,restrictions:s.activityRestrictions}),matches=[...check.matches,...check.potentialMatches];
 return pupils.map(student=>{
  const history=byId.get(student.id),results=history.filter(r=>r.status==='done'),scale=selectNormScale(norm,cls,student);
  const meets=results.filter(r=>targetGrade===null||r.grade!=null&&Number(r.grade)>=targetGrade).length>=minAttempts;
  const active=s.exemptions.some(e=>e.studentId===student.id&&M.exemptionCovers(e,today))||matches.some(m=>m.studentId===student.id);
  const restricted=history.some(r=>r.status==='restricted');
  const status=meets?'done':active?'review':restricted&&!results.length?'review':!scale&&targetGrade!==null?'noScale':results.length?'retake':'missing';
  return {student,status,attempts:results.length,last:results.slice().sort((a,b)=>b.date.localeCompare(a.date))[0]||null,review:active||restricted};
 });
}
export const checklistLabels={done:'Выполнен',review:'Проверить ограничения / основание',noScale:'Нет подходящей шкалы',retake:'Критерий пока не выполнен',missing:'Нет результата за период'};
export function validateRubric(r){
 if(!exact(r,['id','kind','name','criteria','thresholds'])||r.kind!=='rubric'||!text(r.id)||!text(r.name)||!Array.isArray(r.criteria)||!r.criteria.length||r.criteria.length>12||r.criteria.some(c=>!exact(c,['name','max','description'])||!text(c.name)||!Number.isInteger(c.max)||c.max<1||c.max>100||typeof c.description!=='string'||c.description.length>1000)||new Set(r.criteria.map(c=>c.name.trim().toLowerCase())).size!==r.criteria.length||!Array.isArray(r.thresholds)||r.thresholds.length!==5||r.thresholds.some((v,i)=>!Number.isFinite(v)||v<0||v>100||i>0&&v<=r.thresholds[i-1])||r.thresholds[0]!==0)throw Error('Проверьте критерии и пять возрастающих порогов (первый — 0%)');
 return r;
}
export function scoreRubric(r,scores){
 validateRubric(r);
 if(!Array.isArray(scores)||scores.length!==r.criteria.length||scores.some((n,i)=>!Number.isInteger(n)||n<0||n>r.criteria[i].max))throw Error('Заполните баллы по каждому критерию');
 const sum=scores.reduce((a,b)=>a+b,0),max=r.criteria.reduce((a,c)=>a+c.max,0),percent=sum/max*100;
 const grade=String(r.thresholds.findLastIndex(v=>percent>=v)+1);
 return {sum,max,percent,grade};
}

/** Explicit teacher-defined assignment, independent of grades and medical clearance. */
export function validateNormAssignment(r){
 if(!exact(r,['id','kind','name','classId','normId','yearFrom','yearTo','from','to','targetGrade','studentIds','minAttempts','retakeUntil','revision'])||r.kind!=='normAssignment'||![r.id,r.name,r.classId,r.normId].every(x=>text(x))||!H.validPeriod(r.yearFrom,r.yearTo)||!r.yearTo||!H.validPeriod(r.from,r.to)||!r.to||r.from<r.yearFrom||r.to>r.yearTo||r.targetGrade!==null&&![1,2,3,4,5].includes(r.targetGrade))throw Error('Проверьте назначение, учебный год, период и цель');
 if(r.studentIds!==undefined&&(!Array.isArray(r.studentIds)||!r.studentIds.length||r.studentIds.length>1000||r.studentIds.some(x=>!text(x))||new Set(r.studentIds).size!==r.studentIds.length))throw Error('Проверьте выбранных учеников');
 if(r.minAttempts!==undefined&&(!Number.isInteger(r.minAttempts)||r.minAttempts<1||r.minAttempts>20))throw Error('Укажите от 1 до 20 результатов по критерию');
 if(r.retakeUntil!==undefined&&r.retakeUntil!==null&&(!H.validPeriod(r.to,r.retakeUntil)||r.retakeUntil<=r.to||r.retakeUntil>r.yearTo))throw Error('Срок пересдачи должен быть после исходного срока в том же учебном году');
 if(r.revision!==undefined&&(!Number.isInteger(r.revision)||r.revision<0||r.revision>1000000))throw Error('Некорректная ревизия назначения');
 return r;
}
export const assignmentEnd=a=>a.retakeUntil||a.to;
export function assignmentsOverlap(a,b){
 return a.classId===b.classId&&a.normId===b.normId&&a.yearFrom===b.yearFrom&&a.yearTo===b.yearTo&&a.from<=assignmentEnd(b)&&b.from<=assignmentEnd(a)&&(!a.studentIds||!b.studentIds||a.studentIds.some(id=>b.studentIds.includes(id)));
}
export function assignmentOverview(s,assignment,today=M.todayIso()){
 const a=validateNormAssignment(assignment),year=s.settings.year;
 if(a.yearFrom!==year.from||a.yearTo!==year.to)return {state:'archive',rows:[],pending:0,review:0,done:0};
 if(!s.classes.some(c=>c.id===a.classId)||!s.norms.some(n=>n.id===a.normId))return {state:'unavailable',rows:[],pending:0,review:0,done:0};
  const args={classId:a.classId,normId:a.normId,from:a.from,targetGrade:a.targetGrade,today,studentIds:a.studentIds||null,minAttempts:a.minAttempts||1};
 const original=normChecklist(s,{...args,to:a.to}),onTime=new Set(original.filter(r=>r.status==='done').map(r=>r.student.id));
 const rows=(a.retakeUntil?normChecklist(s,{...args,to:a.retakeUntil}):original).map(r=>({...r,late:r.status==='done'&&!onTime.has(r.student.id)}));
 const state=today<a.from?'upcoming':today>assignmentEnd(a)?'closed':today>a.to?'retake':'active';
 const pending=rows.filter(r=>['missing','retake'].includes(r.status)).length,review=rows.filter(r=>['review','noScale'].includes(r.status)).length,done=rows.filter(r=>r.status==='done').length;
 return {state,rows,pending,review,done,lateDone:rows.filter(r=>r.late).length,overdue:state==='closed'?pending:0};
}

// Each row is a student × assignment, not a unique student or a medical diagnosis.
export function schoolDebtRows(s,assignments,today=M.todayIso()){
 const out=[];
 for(const a of assignments){
  const o=assignmentOverview(s,a,today);
  if(!['active','retake','closed'].includes(o.state))continue;
  const cls=s.classes.find(c=>c.id===a.classId),norm=s.norms.find(n=>n.id===a.normId);
  for(const r of o.rows)if(r.status!=='done')out.push({assignmentId:a.id,classId:a.classId,className:cls.name,normId:a.normId,normName:norm.name,studentId:r.student.id,studentName:r.student.fullName,from:a.from,to:a.to,retakeUntil:a.retakeUntil||null,status:r.status,review:r.review,attempts:r.attempts,overdue:o.state==='closed'&&['missing','retake'].includes(r.status)});
 }
 return out.sort((a,b)=>Number(b.overdue)-Number(a.overdue)||a.to.localeCompare(b.to)||a.className.localeCompare(b.className,'ru')||a.studentName.localeCompare(b.studentName,'ru'));
}
