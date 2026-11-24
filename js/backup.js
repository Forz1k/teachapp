import { catalog, types, validPeriod } from './health.js';
import { validateNorm, validateNormSnapshot, validNormGroup, validGradeLevel, gradeNorm } from './assessment.js';
import { validateCoachData, coachStores } from './coach.js';
import {validateArchive} from './school-archive.js';
import {validateWorkRecord} from './workbench.js';
import { SCHEMA } from './db.js';

export const BACKUP_VERSION = 21;
const legacyCore = ['meta','classes','students','lessons','topics','marks','exemptions','monthly'];
const text = s => typeof s === 'string' && s.trim().length > 0;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const date = s => validPeriod(s, null);

export function validateBackup(payload) {
  if (payload?.app !== 'teachapp' || !object(payload.data)) throw new Error('Файл не похож на резервную копию TeachApp');
  if (![1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,BACKUP_VERSION].includes(payload.version)) throw new Error('Версия резервной копии не поддерживается');
  if(payload.scope!==undefined&&(!object(payload.scope)||!['class','team','archive'].includes(payload.scope.kind)||!text(payload.scope.id)||!Number.isInteger(payload.scope.omitted)||payload.scope.omitted<0))throw Error('Повреждена область выборочной копии');
  const data = payload.data;
  const names = Object.keys(SCHEMA);
  if (Object.keys(data).some(n => !names.includes(n))) throw new Error('В копии есть неизвестный раздел');
  const required = payload.version === 1 ? [...legacyCore] : payload.version === 2 ? names.filter(n=>!['norms','normResults','finalGrades',...coachStores].includes(n)) : payload.version === 3 ? names.filter(n=>!['finalGrades',...coachStores].includes(n)) : payload.version === 4 ? names.filter(n=>!['finalGrades','coachLive','coachLineups'].includes(n)) : payload.version < 7 ? names.filter(n=>!['coachLive','coachLineups'].includes(n)) : [...names];
  if(payload.version<11){const i=required.indexOf('workRecords');if(i>=0)required.splice(i,1);}
  if(payload.version<10){const i=required.indexOf('coachTests');if(i>=0)required.splice(i,1);}
  if (payload.version === 1) {
    for (const group of [['ktp','schedule','scheduleOverrides'],['studentHealthProfiles','activityRestrictions','activityCategories']]) {
      if (group.some(key => Object.hasOwn(data,key))) required.push(...group);
    }
  }
  const tables = {};
  const index = {};
  for (const name of names) {
    if ((required.includes(name) || Object.hasOwn(data,name)) && !Array.isArray(data[name])) {
      throw new Error('В копии отсутствует или повреждён раздел ' + name);
    }
    tables[name] = data[name] || [];
    index[name] = new Map();
    for (const row of tables[name]) {
      if (!object(row) || !text(row.id) || index[name].has(row.id)) throw new Error('Некорректный идентификатор в разделе ' + name);
      index[name].set(row.id,row);
    }
  }

  const activities = new Set(catalog.map(a => a.id));
  for (const a of tables.activityCategories) {
    if (activities.has(a.id)) throw new Error('Повтор идентификатора вида нагрузки');
    activities.add(a.id);
  }
  for (const [name,schema] of Object.entries(SCHEMA)) {
    for (const [,fields,options] of schema.indexes) {
      if (!options?.unique) continue;
      const seen = new Set();
      for (const row of tables[name]) {
        const key = JSON.stringify(fields.map(field => row[field]));
        if (seen.has(key)) throw new Error('Повторяющаяся запись в разделе ' + name);
        seen.add(key);
      }
    }
  }
  const check = (name, predicate) => {
    if (!tables[name].every(predicate)) throw new Error('Проверьте поля и связи в разделе ' + name);
  };
  const tags = ids => ids == null || (Array.isArray(ids) && ids.every(id => activities.has(id)));
  const pupil = r => index.students.has(r.studentId);
  const pair = r => pupil(r) && index.lessons.has(r.lessonId) && index.students.get(r.studentId).classId === index.lessons.get(r.lessonId).classId;
  const period = r => validPeriod(r.dateFrom,r.dateTo);
  const classRef = id => id === 'window' || index.classes.has(id);
  check('classes', r => text(r.name)&&validGradeLevel(r.gradeLevel));
  check('students', r => text(r.fullName) && index.classes.has(r.classId)&&validNormGroup(r.normGroup)&&(r.lineageId===undefined||text(r.lineageId)));
  if(new Set(tables.students.map(s=>s.lineageId||s.id)).size!==tables.students.length)throw Error('Повтор связи истории ученика');
  check('ktp', r => text(r.name) && Array.isArray(r.classIds) && r.classIds.every(id => index.classes.has(id)));
  check('topics', r => text(r.name) && (!r.ktpId || index.ktp.has(r.ktpId)) && tags(r.activityIds));
  check('lessons', r => index.classes.has(r.classId) && date(r.date) && (!r.topicId || index.topics.has(r.topicId)) && tags(r.activityIds));
  check('marks', r => pair(r) && (!r.participationId || index.participation.get(r.participationId)?.studentId === r.studentId
    && index.participation.get(r.participationId)?.lessonId === r.lessonId)
    && (!r.baseMark || (r.baseMark.id === r.id && r.baseMark.studentId === r.studentId && r.baseMark.lessonId === r.lessonId)));
  check('monthly', r => pupil(r) && Number.isInteger(r.year) && Number.isInteger(r.month) && r.month >= 1 && r.month <= 12);
  check('exemptions', r => pupil(r) && period(r));
  check('schedule', r => classRef(r.classId) && Number.isInteger(r.weekday) && r.weekday >= 1 && r.weekday <= 7 && r.slot > 0);
  check('scheduleOverrides', r => date(r.date) && ['add','cancel','move'].includes(r.action)
    && (r.action === 'add' ? classRef(r.classId) : index.schedule.has(r.ruleId)) && (!r.classId || classRef(r.classId)));
  check('activityCategories', r => text(r.name) && Array.isArray(r.parents) && tags(r.parents));
  check('studentHealthProfiles', r => index.students.has(r.id) && period(r) && typeof r.group === 'string' && text(r.updatedAt));
  check('activityRestrictions', r => pupil(r) && activities.has(r.activityId) && Object.hasOwn(types,r.type) && period(r));
  check('participation', r => pair(r) && r.date === index.lessons.get(r.lessonId).date && ['normal','paused','adapted'].includes(r.mode)
    && ['none','parent','document'].includes(r.basis) && (!r.activityId || activities.has(r.activityId))
    && (!r.full || (r.mode === 'paused' && r.basis === 'document' && index.marks.get(r.markId)?.studentId === r.studentId
      && index.marks.get(r.markId)?.lessonId === r.lessonId)));
  const validNorm = n => {try {validateNorm(n,activities);return true;} catch {return false;}};
  check('norms',validNorm);
  const validSnapshot=n=>{try{validateNormSnapshot(n,activities);return true;}catch{return false;}};
  check('normResults',r=>pair(r) && date(r.date) && index.norms.has(r.normId) && validSnapshot(r.definition) && r.definition.id===r.normId && (r.status==='restricted' ? r.value===null && r.grade===null : r.status==='done' && typeof r.value==='number' && Number.isFinite(r.value) && r.value>=0 && r.grade===gradeNorm(r.definition,r.value)));
  check('finalGrades',r=>pupil(r)&&text(r.periodName)&&date(r.from)&&date(r.to)&&validPeriod(r.from,r.to)&&['1','2','3','4','5'].includes(r.value)&&text(r.updatedAt));
  check('meta', r => r.id !== 'settings' || ((!r.year || (date(r.year.to) && validPeriod(r.year.from,r.year.to)))
    && (r.trimesters === undefined || (Array.isArray(r.trimesters) && r.trimesters.length && r.trimesters.every(t => t && text(t.id) && date(t.to) && validPeriod(t.from,t.to))))
    && (r.holidays === undefined || (Array.isArray(r.holidays) && r.holidays.every(h => h && date(h.to) && validPeriod(h.from,h.to))))
    && (!r.healthGroups || (Array.isArray(r.healthGroups) && r.healthGroups.every(text)))
    && (r.retentionDays===undefined || (Number.isInteger(r.retentionDays)&&r.retentionDays>=0&&r.retentionDays<=3650))
    && (!r.lastBackupAt || typeof r.lastBackupAt === 'string')));
  validateCoachData(tables);
  for(const r of tables.workRecords){if(r.kind==='archive')validateArchive(r);else validateWorkRecord(r);if(r.kind==='coachGoal'&&(!index.coachTeams.has(r.teamId)||index.coachPlayers.get(r.playerId)?.teamId!==r.teamId))throw Error('Некорректная связь индивидуальной цели');if(r.kind==='tacticBoard'&&!index.coachTeams.has(r.teamId))throw Error('Некорректная связь тактической схемы');if(r.kind==='seasonPlan'&&!index.coachTeams.has(r.teamId))throw Error('Некорректная связь плана сезона');}
  const historical=[tables,...tables.workRecords.filter(r=>r.kind==='archive').map(r=>r.snapshot)];
  for(const r of tables.workRecords.filter(r=>r.kind==='gradeHistory'))if(!historical.some(d=>{const st=d.students.find(p=>p.id===r.studentId);return st&&(r.scope==='final'||d.lessons.some(l=>l.id===r.lessonId&&l.classId===st.classId));}))throw Error('История оценки не связана с учеником и уроком');
  return tables;
}
