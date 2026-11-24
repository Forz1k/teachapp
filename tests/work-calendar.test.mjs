import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../js/workbench.js';
import * as S from '../js/store.js';
import * as db from '../js/db.js';
import {calendarEntries,dueReminders,calendarIcs,timeConflicts} from '../js/work-calendar.js';
const school={classes:[{id:'c',name:'7А'}],settings:{year:{from:'2026-09-01',to:'2027-05-31'},holidays:[{from:'2026-11-23',to:'2026-11-23'}],lastBackupAt:'2026-11-22T10:00:00Z'},schedule:[{id:'l',weekday:1,slot:1,classId:'c',time:'09:00'},{id:'b',weekday:2,slot:2,classId:'c',time:'10:00'}],scheduleOverrides:[{id:'o',date:'2026-11-24',ruleId:'b',action:'move',time:'11:00'}],lessons:[],exemptions:[{dateTo:'2026-11-24',studentId:'private-name'}]};
const coach={coachTeams:[{id:'t',name:'Команда'}],coachTrainings:[{id:'tr',teamId:'t',date:'2026-11-24',time:'11:00',minutes:90,title:'Тренировка',held:false}],coachMatches:[]};
const event={kind:'event',name:'Задача, пример; текст',date:'2026-11-24',time:'12:00',minutes:20,eventType:'task',note:'Не экспортировать',remind:30,done:false};
test('Календарь: каникулы, замены, сроки, конфликты и безопасный ICS',()=>{
 const rows=calendarEntries(school,coach,[{...event,id:'e'}],'2026-11-23','2026-11-24');
 assert.equal(rows.filter(x=>x.source==='school').length,1);assert.equal(rows.find(x=>x.source==='school').time,'11:00');
 assert.equal(timeConflicts(rows).length,2);
 const due=dueReminders(rows,new Date(2026,10,24,11,45));assert.ok(due.some(x=>x.id==='e'));
 const safe=calendarIcs(rows,{now:new Date('2026-11-24T00:00:00Z')});assert.match(safe,/BEGIN:VCALENDAR/);assert.match(safe,/TRIGGER:-PT30M/);assert.doesNotMatch(safe,/7А|private-name|Не экспортировать|Задача, пример/);
 const detailed=calendarIcs(rows,{includeTitles:true});assert.ok(detailed.includes('Задача\\, пример\\; текст'));assert.doesNotMatch(detailed,/Не экспортировать/);
});
test('Календарь: сохранение, завершение и проверка резервной копии',async()=>{
 await db.clearAll();await S.load();const e=await W.saveWork(event);
 await W.saveWork({...e,done:true});assert.equal((await W.listWork('event'))[0].done,true);
 await assert.rejects(W.saveWork({...e,date:'2026-02-31'}));
 const b=await S.makeBackup();await S.restoreBackup(b);assert.equal((await W.listWork('event')).length,1);
 const bad=structuredClone(b);bad.data.workRecords[0].remind=-1;await assert.rejects(S.restoreBackup(bad));assert.equal((await W.listWork('event')).length,1);
});
