import {BACKUP_VERSION} from '../js/backup.js';
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/coach.js';
import * as S from '../js/store.js';
import * as db from '../js/db.js';
async function seed(){
 await db.clearAll();await S.load();
 const team=await C.saveTeam({name:'Гимназия'}),p=await C.savePlayer({teamId:team.id,name:'Игрок',number:5,position:'setter',restrictions:[{activityId:'jump',dateFrom:'2025-01-01',type:'avoid'}]});
 return {team,p};
}
test('Тренерские данные независимы от школьного журнала и номера уникальны',async()=>{
 const {team,p}=await seed();
 const c=await S.addClass('9А'),s=await S.addStudent(c.id,p.name,1);
 await assert.rejects(C.savePlayer({teamId:team.id,name:'Другая',number:5,position:'libero'}),/уникальны/);
 await S.deleteStudent(s.id);await S.deleteClass(c.id);
 assert.equal((await C.loadCoach()).coachPlayers.length,1);
 await C.savePlayer({...p,archived:true});
 await C.savePlayer({teamId:team.id,name:'Другая',number:5,position:'libero'});
});
test('Тренировки: ограничения, проведённые занятия и неизвестная посещаемость',async()=>{
 const {team,p}=await seed();
 const base={teamId:team.id,date:'2025-09-01',time:'16:00',title:'Тренировка',minutes:60,exercises:[{name:'Прыжки',activityId:'broad',minutes:20}],roster:[p.id]};
 const held=await C.saveTraining({...base,held:true,attendance:{[p.id]:'limited'}});
 const empty=await C.saveTraining({...base,held:true,attendance:{}});
 const future=await C.saveTraining({...base,date:'2099-01-01',held:false,attendance:{}});
 assert.equal(C.trainingWarnings(held,[p]).length,1);
 assert.deepEqual(C.playerAttendance(p.id,[held,empty,future],'2026-01-01'),{present:0,limited:1,absent:0,unknown:1,planned:1,pct:100});
 await assert.rejects(C.saveTraining({...future,held:true}),/Будущая/);
 await assert.rejects(C.saveTraining({...base,minutes:10}),/Проверьте/);
});
test('Матчи: партии, частичная статистика, экспорт и защита связей',async()=>{
 const {team,p}=await seed();
 const m=await C.saveMatch({teamId:team.id,date:'2025-09-01',opponent:'=Соперник',competition:'Кубок',sets:[{ours:25,theirs:21},{ours:23,theirs:25},{ours:15,theirs:10}],roster:[p.id],stats:{[p.id]:{serves:10,aces:2,serveErrors:1,points:5}}});
 assert.deepEqual(C.matchScore(m),{ours:2,theirs:1});
 const s=C.summarizeStats([m]);assert.equal(s.sums.aces,2);assert.equal(s.sums.attacks,null);
 assert.match(C.coachCsv(C.teamView(await C.loadCoach(),team.id)),/'=Соперник/);
 await assert.rejects(C.saveMatch({...m,stats:{[p.id]:{serves:1,aces:2}}}),/превышать/);
 await assert.rejects(C.saveMatch({...m,roster:['missing'],stats:{}}),/состав/);
});
test('Резервная копия 4 хранит тренерские данные; формат 3 совместим',async()=>{
 const {team,p}=await seed();
 const backup=await S.makeBackup();assert.equal(backup.version,BACKUP_VERSION);
 await S.restoreBackup(backup);assert.equal((await C.loadCoach()).coachPlayers[0].id,p.id);
 const broken=structuredClone(backup);broken.data.coachPlayers[0].teamId='missing';
 await assert.rejects(S.restoreBackup(broken));assert.equal((await C.loadCoach()).coachTeams[0].id,team.id);
 const old=structuredClone(backup);old.version=3;for(const n of C.coachStores)delete old.data[n];
 await S.restoreBackup(old);assert.deepEqual((await C.loadCoach()).coachTeams,[]);
});

test('Карточка игрока: период и парные знаменатели, неизвестное не становится нулём',()=>{
 const matches=[
  {date:'2026-09-10',roster:['p'],stats:{p:{serves:10,serveErrors:2,receptions:4}}},
  {date:'2026-09-11',roster:['p'],stats:{p:{serves:20,serveErrors:1,receptionGood:3}}},
  {date:'2026-09-12',roster:['p'],stats:{p:{receptions:8,receptionGood:6,attackKills:2}}},
  {date:'2025-09-10',roster:['p'],stats:{p:{serves:50,serveErrors:0}}},
 ];
 const s=C.playerSeasonStats(matches,'p',{from:'2026-09-01',to:'2027-08-31'});
 assert.equal(s.rosterMatches,3);
 assert.deepEqual(s.rates.serve,{total:30,success:27});
 assert.deepEqual(s.rates.receive,{total:8,success:6});
 assert.deepEqual(s.rates.attack,{total:0,success:0});
 assert.equal(s.summary.sums.aces,null);
});

test('Training load validates actual attendance and preserves missing values across backup',async()=>{
 const {team,p}=await seed();const base={teamId:team.id,date:'2025-09-01',time:'16:00',title:'Тренировка',minutes:90,exercises:[],roster:[p.id],held:true,attendance:{[p.id]:'present'}};
 const t=await C.saveTraining({...base,effort:{[p.id]:{minutes:45,rpe:6}}});
 const unknown=await C.saveTraining(base);
 await assert.rejects(C.saveTraining({...base,attendance:{[p.id]:'absent'},effort:t.effort}),/Нагрузка/);
 await assert.rejects(C.saveTraining({...base,effort:{[p.id]:{minutes:45,rpe:11}}}),/Нагрузка/);
 const result=C.playerTrainingLoad(p.id,[t,unknown],{today:'2026-11-24'});
 assert.equal(result.total,270);assert.equal(result.known,1);assert.equal(result.unknown,1);assert.equal(C.playerTrainingLoad(p.id,[unknown],{today:'2026-11-24'}).total,null);
 const copy=await S.makeBackup();await S.restoreBackup(copy);assert.deepEqual((await C.loadCoach()).coachTrainings.find(x=>x.id===t.id).effort,t.effort);
});

test('Coach training flags descendant restrictions on broad exercise separately and respects no-test scope',()=>{
 const p={id:'p',restrictions:[{activityId:'pass',dateFrom:'2026-01-01',type:'avoid'},{activityId:'jump',dateFrom:'2026-01-01',type:'no_test'}]};
 const exercises=[{name:'Волейбол',activityId:'volley',minutes:10},{name:'Прыжки',activityId:'broad',minutes:5},{name:'Контроль',activityId:'standing',minutes:5}];
 const r=C.trainingWarnings({date:'2026-02-01',roster:['p'],exercises},[p]);
 assert.equal(r.length,2);assert.equal(r[0].potential,true);assert.deepEqual(r[0].exercises,[exercises[0]]);assert.deepEqual(r[1].exercises,[exercises[2]]);
});
