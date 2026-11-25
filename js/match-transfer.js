/* Explicit, password-encrypted transfer of a single detailed live draft.
 * Does not transfer portal credentials, other teams, health data or settings. */
import * as db from './db.js';
import {coachStores,validateCoachData,loadCoach} from './coach.js';
import {replayDetailed} from './match-protocol.js';
import {encryptBackup,decryptBackup,isEncryptedBackup} from './privacy.js';
const LIMIT=8*1024*1024;
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const equal=(a,b)=>canonical(a)===canonical(b);
const allowed=['id','mode','teamId','date','opponent','competition','venue','teamName','roster','ourPlayers','awayPlayers','lineup','awayLineup','libero','libero2','substitutionMode','limits','regulation','boardColors','boardLogos','scheme','bestOf','target','decider','firstServe','startedAt','events','revision'];
const eventKeys={rally:['side','kind','player','placement','secondary','observations','touches','captureComplete','captureMode'],next:['lineup','awayLineup','serve'],timeout:['side'],sub:['side','out','in'],libero:['for','player','exception'],changeEnds:[],sanction:['side','category','player','note']};
function validateDraft(d){
 check(only(d,allowed)&&d.mode==='dual'&&typeof d.id==='string'&&d.id.length>0&&d.id.length<=200&&typeof d.teamId==='string'&&d.teamId.length>0&&d.teamId.length<=200&&/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&Number.isFinite(Date.parse(d.date))&&new Date(d.date).toISOString().slice(0,10)===d.date&&Number.isSafeInteger(d.revision)&&d.revision>=0,'Повреждённый черновик');
 check([d.ourPlayers,d.awayPlayers].every(a=>Array.isArray(a)&&a.every(p=>only(p,['id','name','number']))),'Недопустимые поля состава');
 check(Array.isArray(d.events)&&d.events.every(e=>e&&Object.hasOwn(eventKeys,e.type)&&only(e,['type','at',...eventKeys[e.type]])),'Недопустимое событие черновика');
 const state=replayDetailed(d);check(!state.finished,'Завершённый матч переносите через историю результатов');return state;
}
export function draftSummary(d){const s=validateDraft(d);return {teamId:d.teamId,team:d.teamName,opponent:d.opponent,date:d.date,revision:d.revision,events:d.events.length,set:s.setEnded?s.sets.length:s.sets.length+1,score:{...s.score}};}
export async function makeDraftTransfer(id,revision,password){
 const data=await loadCoach(),d=data.coachLive.find(x=>x.id===id);
 check(d?.revision===revision,'Черновик изменился. Откройте список заново');validateDraft(d);validateCoachData(data);
 const envelope=await encryptBackup({app:'teachapp-live-draft',version:1,draft:d},password),value=JSON.stringify(envelope);
 check(new TextEncoder().encode(value).length<=LIMIT,'Файл черновика превышает 8 МБ');return value;
}
export async function openDraftTransfer(value,password){
 check(typeof value==='string'&&value.length<=LIMIT&&new TextEncoder().encode(value).length<=LIMIT,'Файл черновика превышает 8 МБ');
 let envelope;try{envelope=JSON.parse(value);}catch{throw Error('Некорректный файл черновика');}
 check(isEncryptedBackup(envelope),'Выберите защищённый файл черновика');
 const payload=await decryptBackup(envelope,password);
 check(only(payload,['app','version','draft'])&&payload.app==='teachapp-live-draft'&&payload.version===1,'Это не защищённый черновик матча');
 validateDraft(payload.draft);return payload.draft;
}
export async function importDraftTransfer(draft,teamId,{confirmed=false}={}){
 check(confirmed,'Подтвердите импорт черновика');validateDraft(draft);check(draft.teamId===teamId,'Выберите ту же команду, синхронизированную с исходным устройством');
 return db.transaction(coachStores,'readwrite',async s=>{
  const data=Object.fromEntries(await Promise.all(coachStores.map(async n=>[n,await s[n].getAll()])));
  check(data.coachTeams.some(t=>t.id===teamId&&!t.archived),'Команда недоступна');
  check(draft.roster.every(id=>data.coachPlayers.some(p=>p.id===id&&p.teamId===teamId)),'Сначала синхронизируйте состав команды. Идентификаторы игроков должны совпадать.');
  check(!data.coachMatches.some(m=>m.teamId===teamId&&m.detail&&(m.detail.id===draft.id||m.detail.startedAt===draft.startedAt)),'Этот матч уже сохранён в истории');
  const old=data.coachLive.find(d=>d.id===draft.id);
  if(old){check(equal(old,draft),'На устройстве уже есть отличающийся черновик. Автоматическая замена запрещена.');return {draft:old,existing:true};}
  check(!data.coachLive.some(d=>d.teamId===teamId&&d.startedAt===draft.startedAt),'Есть другой черновик этой встречи');
  data.coachLive.push(draft);validateCoachData(data);await s.coachLive.add(draft);return {draft,existing:false};
 });
}
