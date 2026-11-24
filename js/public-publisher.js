/* Team portal state is separate from school/coach records. Opt-in publishing only. */
import {buildPortal,readPortal,projectMatch,archiveMatch,matchingSchedule,sortedSchedule,scheduleItem,firebaseOrigin,portalAddress,shareUrl} from './public-portal.js';
import {firebaseSignIn,firebasePublisher} from './firebase-portal.js';
const PREFIX='teachapp:public-portal:',states=new Map();
const initial=()=>({origin:'',apiKey:'',owner:'',slug:'',team:'',schedule:[],archive:[],match:null,activeId:null,enabled:false,pendingDelete:false,settings:{events:true,numbers:false,stats:true,auto:true}});
const clone=x=>structuredClone(x);
const key=id=>PREFIX+id;
function save(e){try{localStorage.setItem(key(e.id),JSON.stringify(e.data));return true;}catch{e.status='Не удалось сохранить настройки на устройстве';return false;}}
function entry(id){
 if(states.has(id))return states.get(id);
 let data=initial();try{const raw=JSON.parse(localStorage.getItem(key(id))||'null');if(raw&&typeof raw==='object')data={...data,...raw,settings:{...data.settings,...raw.settings}};}catch{}
 // Migrate previously cached public snapshots before the next upload.
 if(data.match)data.match.id='match_'+data.match.startedAt;
 data.archive=data.archive.map(row=>({...row,id:'match_'+row.startedAt}));
 const e={id,data,session:null,publisher:null,status:data.enabled?'Войдите для синхронизации':'Не опубликовано',dirty:false,running:false,timer:null,epoch:0,listeners:new Set()};
 states.set(id,e);return e;
}
function notify(e){for(const f of e.listeners){try{f();}catch{}}}
function status(e,t){e.status=t;notify(e);}
export function portalInfo(id){const e=entry(id);return {data:clone(e.data),connected:!!e.session,status:e.status,dirty:e.dirty};}
export function watchPortal(id,fn){const e=entry(id);e.listeners.add(fn);return ()=>e.listeners.delete(fn);}
export function portalLink(id,base=location.href){const d=entry(id).data;return d.owner&&d.slug&&d.origin?shareUrl(base,d.origin,d.owner,d.slug):'';}
function snapshot(e){const d=e.data;return buildPortal(d.team,d.schedule,d.match,d.archive);}
function enqueue(e){
 e.dirty=true;if(!e.publisher){status(e,'Сохранено на устройстве · войдите для публикации');return;}
 if(e.timer){clearTimeout(e.timer);e.timer=null;}
 void flush(e);
}
async function flush(e){
 if(e.running||!e.dirty||!e.publisher)return;e.running=true;const epoch=e.epoch,client=e.publisher;
 try{
  while(e.dirty&&e.publisher===client&&e.epoch===epoch){
   e.dirty=false;status(e,'Синхронизация…');
   try{
    if(e.data.pendingDelete){await client.remove();if(e.epoch!==epoch)return;e.data.pendingDelete=false;save(e);status(e,'Страница снята с публикации');}
    else if(e.data.enabled){await client.write(snapshot(e));if(e.epoch!==epoch)return;status(e,'Опубликовано · '+new Date().toLocaleTimeString('ru-RU'));}
    else status(e,'Не опубликовано');
   }catch{if(e.epoch!==epoch)return;e.dirty=true;status(e,'Нет связи или доступа · изменения ожидают отправки');e.timer=setTimeout(()=>{e.timer=null;void flush(e);},15000);break;}
  }
 }finally{e.running=false;if(e.dirty&&e.publisher&&e.epoch!==epoch)void flush(e);}
}
export async function connectPortal(id,{origin,apiKey,email,password,slug='',team},fetcher=globalThis.fetch){
 const e=entry(id),d=e.data;origin=firebaseOrigin(origin);
 if(d.origin&&d.origin!==origin)throw Error('Адрес существующей страницы нельзя менять. Используйте исходную базу.');
 const session=await firebaseSignIn(apiKey,email,password,fetcher);
 try{
  if(d.owner&&d.owner!==session.uid)throw Error('Войдите в исходную учётную запись владельца страницы');
  const chosen=d.slug||slug||Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');portalAddress(origin,session.uid,chosen);
  const publisher=firebasePublisher(origin,chosen,session,fetcher);
  const remote=readPortal(await publisher.read());
  if(!d.slug&&remote){d.team=remote.team;d.schedule=remote.schedule;d.archive=remote.archive;d.match=remote.match;d.enabled=true;d.activeId=remote.match&&['live','break'].includes(remote.match.status)?remote.match.id:null;}
  e.session?.close();e.epoch++;e.session=session;e.publisher=publisher;Object.assign(d,{origin,apiKey,owner:session.uid,slug:chosen,team:d.team||String(team).trim()});
  save(e);status(e,'Подключено · '+(d.enabled?'публикация включена':'публикация выключена'));
  if(d.pendingDelete||d.enabled)enqueue(e);
  return portalInfo(id);
 }catch(err){session.close();throw err;}
}
export function disconnectPortal(id){const e=entry(id);e.epoch++;e.session?.close();e.session=null;e.publisher=null;if(e.timer)clearTimeout(e.timer);e.timer=null;status(e,'Отключено · публичная страница сохраняет последний результат');}
export function setPortalEnabled(id,enabled,team){
 const e=entry(id),d=e.data;if(enabled&&!e.publisher)throw Error('Сначала подключите Firebase');
 d.enabled=!!enabled;d.team=String(team||d.team).trim().slice(0,100);d.pendingDelete=!enabled; if(!enabled){d.activeId=null;d.match=null;}
 save(e);enqueue(e);return portalInfo(id);
}
export function setPortalSettings(id,patch){
 const e=entry(id),d=e.data;for(const k of ['events','numbers','stats','auto'])if(Object.hasOwn(patch,k))d.settings[k]=!!patch[k];
 if(d.match){if(!d.settings.events)d.match.events=[];if(!d.settings.numbers){d.match.events=d.match.events.map(({number,...x})=>x);d.match.stats=[];}if(!d.settings.stats)d.match.stats=[];}
 save(e);if(d.enabled)enqueue(e);else notify(e);
}
export function saveFixture(id,item){
 const e=entry(id),d=e.data,x=scheduleItem(item),next=d.schedule.filter(t=>t.id!==x.id);if(d.activeId&&d.match?.scheduledId===x.id)throw Error('Матч уже идёт');if(next.length>=20)throw Error('Не более 20 предстоящих матчей');d.schedule=sortedSchedule([...next,x]);save(e);if(d.enabled)enqueue(e);else notify(e);
}
export function removeFixture(id,fixtureId){const e=entry(id);if(e.data.match?.scheduledId===fixtureId&&['live','break'].includes(e.data.match.status))throw Error('Матч уже идёт');e.data.schedule=e.data.schedule.filter(x=>x.id!==fixtureId);save(e);if(e.data.enabled)enqueue(e);else notify(e);}
export function syncPortalMatch(match,{start=false,finish=false,discard=false}={}){
 if(match?.mode!=='dual')return false;const e=entry(match.teamId),d=e.data;if(!d.enabled)return false;
 const scheduled=matchingSchedule(d.schedule,match);
 const continuing=d.activeId===match.id;
 if(!continuing){
  if(discard||finish)return false;
  if(d.activeId&&d.match){if(start)throw Error('Сначала завершите или отключите текущую трансляцию');return false;}
  if(!start&&(!d.settings.auto||!scheduled))return false;
  d.activeId=match.id;
 }
 if(discard){d.match=null;d.activeId=null;}
 else {
  const scheduledId=continuing&&d.match?d.match.scheduledId:scheduled?.id;
  d.match=projectMatch(match,{...d.settings,scheduledId});
  if(finish){if(d.match.status!=='finished')throw Error('Матч ещё не завершён');d.archive=[archiveMatch(d.match),...d.archive.filter(x=>x.id!==d.match.id)].slice(0,20);d.schedule=d.schedule.filter(x=>x.id!==scheduledId);d.activeId=null;}
 }
 save(e);enqueue(e);return true;
}
export function heartbeatPortal(id,matchId){const e=entry(id);if(e.data.enabled&&e.data.activeId===matchId&&e.data.match&&['live','break'].includes(e.data.match.status))enqueue(e);}
export function setPublicTeamName(id,team){const e=entry(id),name=String(team).trim().slice(0,100);if(!name)throw Error('Укажите публичное название');e.data.team=name;save(e);if(e.data.enabled)enqueue(e);else notify(e);}
export function stopPortalMatch(id){const e=entry(id);e.data.activeId=null;e.data.match=null;e.data.settings.auto=false;save(e);if(e.data.enabled)enqueue(e);else notify(e);}
