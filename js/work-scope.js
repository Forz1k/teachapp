/* Shared classification for workspace record API and three-key migration. */
const schoolKinds=new Set(['gradeHistory','rubric','normAssignment','briefing','gymBoard','ktpMaterial','documentMaterial','studentGoal','schoolCompetition','teacherPortfolio','normRetake','ktpVersion','lessonAlternative','stationTemplate']);
const coachKinds=new Set(['coachGoal','tacticBoard','seasonPlan','videoReview','opponentNote','tacticMaterial','publicNewsDraft','matchRegulation']);
// Archived school snapshots may carry mixed local settings. Shared resources
// and archives are owner-only, not copied into school or coach projections.
const sharedKinds=new Set(['archive','exercise','event','inventory','tournament']);
export function workRecordScope(r){
 if(schoolKinds.has(r.kind))return 'school';
 if(coachKinds.has(r.kind))return 'coach';
 if(sharedKinds.has(r.kind))return 'workspace';
 if(r.kind==='plan'&&['school','coach'].includes(r.context))return r.context;
 if(r.kind==='achievement'){
  if(['student','class'].includes(r.subjectType))return 'school';
  if(['player','team'].includes(r.subjectType))return 'coach';
 }
 throw Error('Не классифицирована рабочая запись LAB');
}
