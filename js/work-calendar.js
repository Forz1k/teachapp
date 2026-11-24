import {tournamentCalendar} from './tournaments.js';
import {fixtureCalendar} from './competition-center.js';
import * as M from './model.js';
import {validPeriod} from './health.js';
import {only,txt,opt,require} from './workbench.js';
export const eventTypes={task:'Задача',meeting:'Встреча',competition:'Соревнование',training:'Тренировка',other:'Другое'};
const timeOK=t=>typeof t==='string'&&(t===''||/^([01]\d|2[0-3]):[0-5]\d$/.test(t));
export function validateEvent(r){
 require(only(r,['id','kind','name','date','time','minutes','eventType','note','remind','done'])&&txt(r.id)&&r.kind==='event'&&txt(r.name)&&validPeriod(r.date,null)&&timeOK(r.time)&&Number.isInteger(r.minutes)&&r.minutes>=0&&r.minutes<=600&&(!r.minutes||r.time!=='')&&Object.hasOwn(eventTypes,r.eventType)&&opt(r.note,2000)&&[null,0,15,30,60,120,1440].includes(r.remind)&&typeof r.done==='boolean','Проверьте событие, дату, время и напоминание');
}
export function calendarEntries(school,coach,events,from,to,tournaments=[],portalByTeam={}){
 require(validPeriod(from,to)&&!!to&&M.addDays(from,62)>=to,'Выберите период до 63 дней');
 const out=[],classes=new Map(school.classes.map(c=>[c.id,c.name])),teams=new Map(coach.coachTeams.map(t=>[t.id,t.name]));
 for(let date=from;date<=to;date=M.addDays(date,1)){
  if(M.inRange(date,school.settings.year.from,school.settings.year.to)&&!(school.settings.holidays||[]).some(h=>M.inRange(date,h.from,h.to))){
   for(const l of M.scheduleForDate(school.schedule,school.scheduleOverrides,date)){
    if(!classes.has(l.classId))continue;
    out.push({id:'lesson-'+l.id+'-'+date,source:'school',date,time:timeOK(l.time)?l.time:'',minutes:0,title:'Урок '+l.slot+' · '+classes.get(l.classId),exportTitle:'Урок физкультуры',done:!!M.matchScheduledLessons(M.scheduleForDate(school.schedule,school.scheduleOverrides,date),school.lessons?.filter(x=>x.date===date)||[]).get(l.id)?.held,remind:15});
   }
  }
  const checks=[['exemptions','Заканчиваются освобождения'],['activityRestrictions','Заканчиваются ограничения'],['studentHealthProfiles','Проверка группы здоровья']];
  for(const [key,title] of checks){const n=(school[key]||[]).filter(x=>x.dateTo===date&&x.enabled!==false).length;if(n)out.push({id:key+'-'+date,source:'review',date,time:'',minutes:0,title:title+': '+n,exportTitle:'Проверить рабочие записи',done:false,remind:1440});}
 }
 for(const t of coach.coachTrainings){if(!M.inRange(t.date,from,to))continue;out.push({id:'training-'+t.id,source:'coach',date:t.date,time:t.time,minutes:t.minutes,title:t.title+' · '+(teams.get(t.teamId)||'Команда'),exportTitle:'Тренировка',done:t.held,remind:30});}
 for(const m of coach.coachMatches){if(!M.inRange(m.date,from,to))continue;out.push({id:'match-'+m.id,source:'coach',date:m.date,time:'',minutes:0,title:'Матч · '+m.opponent,exportTitle:'Волейбольный матч',done:true,remind:null});}
 for(const e of events){if(!M.inRange(e.date,from,to))continue;out.push({id:e.id,source:'custom',date:e.date,time:e.time,minutes:e.minutes,title:e.name,exportTitle:eventTypes[e.eventType],done:e.done,remind:e.remind,record:e});}
 out.push(...tournamentCalendar(tournaments,from,to),...fixtureCalendar(coach.coachTeams,portalByTeam,from,to));
 const last=school.settings.lastBackupAt;
 let backupDue=last&&Number.isFinite(Date.parse(last))?M.addDays(M.iso(new Date(last)),7):M.todayIso();
 const postponed=school.settings.backupReminderAfter;
 if(postponed&&Number.isFinite(Date.parse(postponed))){const date=M.iso(new Date(postponed));if(date>backupDue)backupDue=date;}
 if(backupDue<M.todayIso())backupDue=M.todayIso();
 if(M.inRange(backupDue,from,to))out.push({id:'backup-'+backupDue,source:'backup',date:backupDue,time:'',minutes:0,title:'Создать резервную копию',exportTitle:'Резервная копия',done:false,remind:0});
 return out.sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'00:00').localeCompare(b.time||'00:00')||a.title.localeCompare(b.title,'ru'));
}
export function dueReminders(entries,now=new Date()){
 const today=M.iso(now),t=now.getTime();
 return entries.filter(e=>{if(e.done||e.remind===null)return false;
  if(e.time){const at=new Date(e.date+'T'+e.time+':00').getTime();return t>=at-e.remind*60000&&(e.source==='custom'||today<=e.date);}
  const lead=e.remind>=1440?1:0;return today>=M.addDays(e.date,-lead)&&(e.source==='custom'||today<=e.date);
 });
}
export function timeConflicts(entries){
 const times=entries.filter(e=>e.time&&!e.done&&['school','coach','custom','tournament'].includes(e.source)),out=[];
 for(let i=0;i<times.length;i++)for(let j=i+1;j<times.length;j++){const a=times[i],b=times[j];if(a.date!==b.date)continue;const x=M.parseTime(a.time),y=M.parseTime(b.time);if(x===null||y===null)continue;if(x===y||x<y+Math.max(1,b.minutes)&&y<x+Math.max(1,a.minutes))out.push([a,b]);}
 return out;
}
const esc=v=>String(v).replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');
const compact=d=>d.replaceAll('-','');
const stamp=d=>d.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
function fold(line){const enc=new TextEncoder();let out='',length=0;for(const ch of line){const n=enc.encode(ch).length;if(length+n>75){out+='\r\n ';length=1;}out+=ch;length+=n;}return out;}
export function calendarIcs(entries,{includeTitles=false,now=new Date()}={}){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//TeachApp//Work calendar//RU','CALSCALE:GREGORIAN'];
 for(const e of entries){if(e.done)continue;
  lines.push('BEGIN:VEVENT','UID:'+esc(e.id)+'@teachapp.local','DTSTAMP:'+stamp(now),'SUMMARY:'+esc(includeTitles?e.title:e.exportTitle));
  if(e.time){lines.push('DTSTART:'+compact(e.date)+'T'+e.time.replace(':','')+'00');if(e.minutes)lines.push('DURATION:PT'+e.minutes+'M');}
  else lines.push('DTSTART;VALUE=DATE:'+compact(e.date),'DTEND;VALUE=DATE:'+compact(M.addDays(e.date,1)));
  if(e.remind!==null){lines.push('BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:'+esc(includeTitles?e.title:e.exportTitle),'TRIGGER:'+(e.remind===0?'PT0M':'-PT'+e.remind+'M'),'END:VALARM');}
  lines.push('END:VEVENT');
 }
 return lines.concat('END:VCALENDAR').map(fold).join('\r\n')+'\r\n';
}
