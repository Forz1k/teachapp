/* Временное распределение, не меняет журнал и тренерский состав. */
import * as H from './health.js';
import {hasOsv} from './model.js';
export function schoolCandidates({lesson,students,marks,parts,exemptions,activities,restrictions,activityId}){
  if(!activities.some(a=>a.id===activityId))throw Error('Выберите вид нагрузки');
  const matches=H.checkLessonRestrictions({lesson:{...lesson,activityIds:[activityId],activitiesConfirmed:true},students,activities,restrictions}).matches;
  const restricted=new Set(matches.map(m=>m.studentId));
  const byMark=new Map(marks.filter(m=>m.lessonId===lesson.id).map(m=>[m.studentId,m]));
  const byPart=new Map(parts.filter(p=>p.lessonId===lesson.id).map(p=>[p.studentId,p]));
  return students.filter(s=>s.classId===lesson.classId).map(s=>{
    const m=byMark.get(s.id),p=byPart.get(s.id);
    const reason=m?.flag==='Н'?'Отсутствует':hasOsv(m)||exemptions.some(e=>e.studentId===s.id&&H.active(e,lesson.date))?'ОСВ':
      p&&p.mode!=='normal'?'Нагрузка ограничена по записи участия':restricted.has(s.id)?'Есть ограничение на выбранную нагрузку':'';
    const present=!!(p||m?.value||m?.source==='manual'||m?.baseMark?.source==='manual');
    return {id:s.id,name:s.fullName,reason,confirmed:!reason&&present};
  });
}
export function coachCandidates(players,activityId,date,activities=H.catalog){
  if(!H.validPeriod(date,null))throw Error('Проверьте дату');
  const byId=new Map(activities.map(a=>[a.id,a]));
  if(!byId.has(activityId))throw Error('Выберите вид нагрузки');
  const {ancestors,unknown}=H.ancestorIds(activityId,byId);
  if(unknown)throw Error('Проверьте каталог нагрузки');
  return players.filter(p=>!p.archived).map(p=>({id:p.id,name:p.name,confirmed:false,
    reason:p.restrictions.some(r=>H.active(r,date)&&ancestors.has(r.activityId))?'Есть ограничение на выбранную нагрузку':''}));
}
function shuffle(a,rng){
  const out=[...a];
  for(let i=out.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
export function generateTeams(players,count,mode='random',rng=Math.random){
  if(!Array.isArray(players)||!Number.isInteger(count)||count<2||count>12||players.length<count||players.length>500)throw Error('Выберите от 2 до 12 команд и не меньше игроков, чем команд');
  if(!['random','balanced'].includes(mode)||new Set(players.map(p=>p.id)).size!==players.length||players.some(p=>!p.id||p.reason))throw Error('Проверьте список доступных игроков');
  if(mode==='balanced'&&players.some(p=>!Number.isInteger(p.rating)||p.rating<1||p.rating>5))throw Error('Укажите уровень 1–5 каждого выбранного игрока');
  if(players.some(p=>p.lock!=null&&(!Number.isInteger(p.lock)||p.lock<0||p.lock>=count)))throw Error('Проверьте закреплённые команды');
  const teams=Array.from({length:count},()=>[]),sums=Array(count).fill(0),base=Math.floor(players.length/count),extra=players.length%count;
  const weight=p=>mode==='balanced'?p.rating:0;
  for(const p of players.filter(p=>p.lock!=null)){teams[p.lock].push(p);sums[p.lock]+=weight(p);}
  const priority=shuffle([...teams.keys()],rng).sort((a,b)=>teams[b].length-teams[a].length);
  const caps=Array(count).fill(base);for(const i of priority.slice(0,extra))caps[i]++;
  if(teams.some((t,i)=>t.length>caps[i]))throw Error('Закреплённые игроки не помещаются в равные по численности команды');
  const free=shuffle(players.filter(p=>p.lock==null),rng);
  if(mode==='balanced')free.sort((a,b)=>b.rating-a.rating);
  for(const p of free){
    const possible=shuffle([...teams.keys()].filter(i=>teams[i].length<caps[i]),rng);
    if(mode==='balanced')possible.sort((a,b)=>sums[a]-sums[b]||teams[a].length-teams[b].length);
    const i=possible[0];teams[i].push(p);sums[i]+=weight(p);
  }
  return teams;
}
export function swapPlayers(teams,a,b){
  if(a===b)throw Error('Выберите двух разных игроков');
  const find=id=>{for(let i=0;i<teams.length;i++){const j=teams[i].findIndex(p=>p.id===id);if(j>=0)return [i,j];}return null;};
  const x=find(a),y=find(b);
  if(!x||!y||x[0]===y[0])throw Error('Выберите игроков из разных команд');
  if(teams[x[0]][x[1]].lock!=null||teams[y[0]][y[1]].lock!=null)throw Error('Сначала снимите закрепление');
  const out=teams.map(t=>[...t]);
  [out[x[0]][x[1]],out[y[0]][y[1]]]=[out[y[0]][y[1]],out[x[0]][x[1]]];return out;
}
