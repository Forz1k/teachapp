/* Shared journal commands; explicit backend, no mutable application cache or fallback. */
import * as M from './model.js';
import * as H from './health.js';
import {appendGradeHistory,gradeState,lessonHistoryKey} from './grade-history.js';

export function baseMark(mark) {
  if (!mark) return null;
  if ('baseMark' in mark) return mark.baseMark;
  if (mark.source !== 'auto-osv' && mark.source !== 'participation') return mark;
  const { previousFlag, previousSource, participationId, ...rest } = mark;
  const flag = previousFlag === 'ОСВ' && previousSource === 'auto-osv' ? null : previousFlag;
  if (!mark.value && !flag && mark.flag !== 'Н') return null;
  return { ...rest, flag: flag || (mark.flag === 'Н' ? 'Н' : null), source: previousSource === 'auto-osv' ? 'manual' : previousSource || 'manual' };
}

export function withCoverage(base, mark, lesson, studentId, exemptions, participation) {
  const covered = exemptions.some(e => e.studentId === studentId && M.exemptionCovers(e,lesson.date));
  if (!covered && !participation?.full) return base;
  const absent = base?.flag === 'Н';
  const next = { ...base, id: base?.id || mark?.id || M.uid('mk'), studentId, lessonId: lesson.id,
    value: base?.value ?? null, flag: absent ? 'Н' : 'ОСВ',
    source: participation?.full ? 'participation' : 'auto-osv', baseMark: base };
  if (absent) next.osv = true;
  if (participation?.full) next.participationId = participation.id;
  return next;
}

export function effectiveLessonLoad(lesson,topic){
  return {...lesson,activityIds:lesson.activityIds??topic?.activityIds,activitiesConfirmed:lesson.activityIds==null&&topic?.activitiesConfirmed===false?false:lesson.activitiesConfirmed};
}
export function lessonBatchReason(action,mark,part,covered,matched){
  if(mark)return 'В журнале уже есть отметка';
  if(action==='absent')return part?'Уже зафиксировано участие':'';
  if(covered)return 'Действует освобождение';
  if(matched)return 'Есть ограничение нагрузки';
  if(part&&(action==='normal'||part.mode!=='normal'))return 'Уже зафиксировано участие';
  return '';
}
/** Atomic import into empty journal cells. Identity and load constraints are rechecked in the write transaction. */
export const journalMarkSnapshot=mark=>JSON.stringify(mark??null);
/** Freeze the lesson context shown during preview, including inherited topic load. */
export function journalLessonSnapshot(lesson,topic=null){
 const effective=effectiveLessonLoad(lesson,topic);
 return JSON.stringify({id:lesson.id,classId:lesson.classId,date:lesson.date,slot:lesson.slot??null,time:lesson.time||'',topicId:lesson.topicId??null,topicName:topic?.name??null,held:lesson.held??null,activityIds:effective.activityIds??null,activitiesConfirmed:effective.activitiesConfirmed??null,note:lesson.note??''});
}
export function journalReplacementReason(mark){
 if(!mark)return '';
 if(mark.source!=='manual'||!['1','2','3','4','5'].includes(mark.value)||mark.flag||mark.osv||mark.baseMark||mark.participationId)return 'Отметка связана с особым участием или нормативом';
 return '';
}
export async function writeJournalPaste(access,classId,entries,confirmed=false,{replace=false,requireLessonSnapshot=false}={}){
 if(replace&&(!Array.isArray(entries)||entries.some(e=>!e||typeof e.expectedMark!=='string'||e.expectedMark.length>4000||!['1','2','3','4','5'].includes(e.value))))throw Error('Для замены необходим предпросмотр обычных оценок');
 if(!confirmed||typeof classId!=='string'||!Array.isArray(entries)||!entries.length||entries.length>500||entries.some(e=>!e||typeof e.studentId!=='string'||typeof e.studentName!=='string'||typeof e.lessonId!=='string'||typeof e.date!=='string'||!['1','2','3','4','5','Н'].includes(e.value))||new Set(entries.map(e=>JSON.stringify([e.studentId,e.lessonId]))).size!==entries.length)throw Error('Проверьте блок и подтвердите вставку');
 if(requireLessonSnapshot&&entries.some(e=>typeof e.expectedLesson!=='string'||e.expectedLesson.length>20000))throw Error('Требуется актуальный предпросмотр уроков');
 if(entries.some(e=>Object.hasOwn(e,'expectedHistoryId')&&(!replace||(e.expectedHistoryId!==null&&(typeof e.expectedHistoryId!=='string'||e.expectedHistoryId.length>200)))))throw Error('Некорректная ревизия истории оценки');
 // The caller cannot alter the confirmed plan while IndexedDB is reading.
 entries=structuredClone(entries);
 return access.transaction(['students','lessons','topics','marks','participation','exemptions','activityRestrictions','activityCategories','workRecords'],'readwrite',async s=>{
  const [students,lessons,exemptions,restrictions,custom]=await Promise.all([s.students.index('classId').getAll(classId),s.lessons.index('classId').getAll(classId),s.exemptions.getAll(),s.activityRestrictions.getAll(),s.activityCategories.getAll()]);
  const pupilMap=new Map(students.map(p=>[p.id,p])),lessonMap=new Map(lessons.map(l=>[l.id,l])),byLesson=new Map(),records=[];
  for(const entry of entries){const l=lessonMap.get(entry.lessonId),p=pupilMap.get(entry.studentId);if(!l||!p||p.fullName!==entry.studentName||l.date!==entry.date||(l.slot??null)!==entry.slot||(l.time||'')!==entry.time||l.date>M.todayIso())throw Error('Ученик, урок или дата изменились. Обновите предпросмотр');if(!byLesson.has(l.id))byLesson.set(l.id,[]);byLesson.get(l.id).push(entry);}
  for(const [lessonId,rows] of byLesson){const l=lessonMap.get(lessonId),[marks,parts,topic]=await Promise.all([s.marks.index('lessonId').getAll(lessonId),s.participation.index('lessonId').getAll(lessonId),l.topicId?s.topics.get(l.topicId):Promise.resolve(null)]);const byMark=new Map(marks.map(m=>[m.studentId,m])),byPart=new Map(parts.map(p=>[p.studentId,p]));
   const lessonSnapshot=journalLessonSnapshot(l,topic??null);
   if(rows.some(e=>(requireLessonSnapshot||e.expectedLesson!==undefined)&&e.expectedLesson!==lessonSnapshot))throw Error('Тема, нагрузка или состояние урока изменились. Обновите предпросмотр');
   const review=H.checkLessonRestrictions({lesson:effectiveLessonLoad(l,topic),students,activities:[...H.catalog,...custom],restrictions}),restricted=new Set([...review.matches,...review.potentialMatches].map(m=>m.studentId));
   for(const e of rows){const id=e.studentId,action=e.value==='Н'?'absent':'grade',old=byMark.get(id)||null,covered=exemptions.some(x=>x.studentId===id&&M.exemptionCovers(x,l.date));
    if(replace&&journalMarkSnapshot(old)!==e.expectedMark)throw Error('Отметка изменилась. Обновите предпросмотр');
    if(Object.hasOwn(e,'expectedHistoryId')){const hist=await s.workRecords.get(lessonHistoryKey(id,lessonId));if((hist?.events.at(-1)?.id??null)!==e.expectedHistoryId)throw Error('История оценки изменилась. Обновите предпросмотр');}
    const reason=(replace?journalReplacementReason(old):'')||lessonBatchReason(action,replace?null:old,byPart.get(id),covered,restricted.has(id));
    if(reason)throw Error('Вставка отменена: '+e.studentName+' · '+M.lessonLabel(l)+' · '+reason);
    const m={...(replace&&old?old:{}),id:replace&&old?old.id:M.uid('mk'),studentId:id,lessonId,value:action==='grade'?e.value:null,flag:action==='absent'?'Н':null,source:'manual'};
    records.push({old:replace?old:null,next:withCoverage(m,null,l,id,exemptions,null)});}
  }
  for(const {old,next:m} of records){if(old)await s.marks.put(m);else await s.marks.add(m);await appendGradeHistory(s.workRecords,{scope:'lesson',studentId:m.studentId,lessonId:m.lessonId},gradeState(baseMark(old)),gradeState(baseMark(m)),'batch');}
  return records.map(r=>r.next);
 });

}
