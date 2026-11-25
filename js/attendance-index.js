/* One snapshot per render. Rebuild after any record mutation, never hold a stale
 * cache across writes or dates. Only index lessons in the requested period. */
import {attendanceDetails} from './assessment.js';
import {todayIso} from './model.js';
export function buildAttendanceIndex(lessons,classLessons,allMarks,allParts,today=todayIso()){
 const periodIds=new Set(lessons.map(l=>l.id)),classIds=new Set(classLessons.map(l=>l.id)),marks=new Map(),parts=new Map(),evidence=new Set();
 for(const m of allMarks){
  if(!periodIds.has(m.lessonId))continue;
  if(m.source==='manual'||m.baseMark?.source==='manual')evidence.add(m.lessonId);
  if(classIds.has(m.lessonId))marks.set(m.lessonId+'|'+m.studentId,m);
 }
 for(const p of allParts)if(periodIds.has(p.lessonId)){evidence.add(p.lessonId);parts.set(p.lessonId+'|'+p.studentId,p);}
 const held=l=>l.date<=today&&(Boolean(l.held)||evidence.has(l.id));
 const prepared=lessons.map(l=>({...l,held:held(l)}));
 return {marks,parts,held,forStudents:students=>attendanceDetails(prepared,students,marks,parts,today)};
}
