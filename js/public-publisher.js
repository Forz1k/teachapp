import {mediaTarget,readMediaVersion,writePublicMedia,mediaProjection} from './public-media.js';
import {archiveTarget,archiveKey,equalArchiveResult,queueArchiveResult,archiveProjection,resolveArchiveRoute,routedArchivePage,routedArchiveVersion,routedArchiveFind,routedArchiveWrite,requireWritableArchive} from './public-archive.js';
/* Team portal state is separate from school/coach records. Opt-in publishing only. */
import {primaryPortal,buildPortal,readPortal,projectMatch,archiveMatch,matchingSchedule,sortedSchedule,scheduleItem,firebaseOrigin,portalAddress,shareUrl,savedResult,sortedArchive,resultFixtures,checkHandoffMatch} from './public-portal.js';
import {firebaseSignIn,firebasePublisher,samePortalContent} from './firebase-portal.js';
const PREFIX='teachapp:public-portal:',states=new Map();
const initial=()=>({origin:'',apiKey:'',owner:'',slug:'',team:'',schedule:[],archive:[],match:null,activeId:null,enabled:false,publisherPaused:false,pendingDelete:false,confirmedEtag:null,pendingWrite:null,archivePending:[],settings:{events:true,numbers:false,stats:true,auto:true,permanent:false}});
const clone=x=>structuredClone(x);
const key=id=>PREFIX+id,pauseKey=id=>'teachapp:portal-paused:'+id;
// Separate local flag prevents a stale tab's saved public draft from clearing a pause.
function isPaused(e){try{if(localStorage.getItem(pauseKey(e.id))==='1')e.data.publisherPaused=true;}catch{}return !!e.data.publisherPaused;}
function persistPause(e,value){localStorage.setItem(pauseKey(e.id),value?'1':'0');if(localStorage.getItem(pauseKey(e.id))!==(value?'1':'0'))throw Error('Не удалось сохранить режим отправки');}
function save(e){try{localStorage.setItem(key(e.id),JSON.stringify(e.data));return true;}catch{e.status='Не удалось сохранить настройки на устройстве';return false;}}
function entry(id){
 if(states.has(id))return states.get(id);
 let data=initial();try{const raw=JSON.parse(localStorage.getItem(key(id))||'null');if(raw&&typeof raw==='object')data={...data,...raw,settings:{...data.settings,...raw.settings}};}catch{}
 // Migrate previously cached public snapshots before the next upload.
 if(data.match)data.match.id='match_'+data.match.startedAt;
 data.archive=data.archive.map(row=>({...row,id:row.id?.startsWith('result_')?row.id:'match_'+row.startedAt}));
 data.archivePending=(Array.isArray(data.archivePending)?data.archivePending:[]).flatMap(row=>{try{return [archiveProjection(row)];}catch{return [];}});
 try{if(localStorage.getItem(pauseKey(id))==='1')data.publisherPaused=true;}catch{}
 const e={id,data,session:null,publisher:null,status:data.publisherPaused?'Отправка приостановлена на этом устройстве':data.enabled?'Войдите для синхронизации':'Не опубликовано',dirty:false,running:false,conflict:false,archiveSending:false,timer:null,epoch:0,listeners:new Set()};
 states.set(id,e);return e;
}
function notify(e){for(const f of e.listeners){try{f();}catch{}}}
function status(e,t){e.status=t;notify(e);}
export function portalInfo(id){const e=entry(id);isPaused(e);return {data:clone(e.data),connected:!!e.session,status:e.status,dirty:e.dirty,conflict:e.conflict,archiveSending:e.archiveSending};}
export function watchPortal(id,fn){const e=entry(id);e.listeners.add(fn);return ()=>e.listeners.delete(fn);}
export function defaultPageCode(id){
 for(let i=0;i<localStorage.length;i++){
  const k=localStorage.key(i);
  if(k?.startsWith(PREFIX)&&k!==key(id)){
   try{const d=JSON.parse(localStorage.getItem(k));if(d.owner===primaryPortal.owner&&d.slug===primaryPortal.slug)return '';}catch{}
  }
 }
 return primaryPortal.slug;
}
export function portalLink(id,base=location.href){const d=entry(id).data;return d.owner&&d.slug&&d.origin?shareUrl(base,d.origin,d.owner,d.slug):'';}
function snapshot(e){const d=e.data;return buildPortal(d.team,d.schedule,d.match,d.archive);}
function ensurePublishingAllowed(e){if(isPaused(e))throw Error('Отправка с этого устройства приостановлена. Сначала явно продолжите управление или примите завершённую серверную версию.');}
function enqueue(e){
 if(isPaused(e))return;
 e.dirty=true;if(!e.publisher){status(e,'Сохранено на устройстве · войдите для публикации');return;}
 if(e.conflict)return;
 if(e.timer){clearTimeout(e.timer);e.timer=null;}
 void flush(e);
}
async function flush(e){
 if(e.running||!e.dirty||!e.publisher||e.conflict||isPaused(e))return;e.running=true;const epoch=e.epoch,client=e.publisher;
 try{
  while(e.dirty&&e.publisher===client&&e.epoch===epoch&&!isPaused(e)){
   e.dirty=false;status(e,'Синхронизация…');
   try{
    if(e.data.pendingDelete||e.data.enabled){
     const desired=e.data.pendingDelete?null:snapshot(e),expected=e.data.confirmedEtag;
     // Keep the exact outgoing projection before network I/O. If the tab
     // closes before acknowledgement, reconnect can recognize this write.
     const prior=e.data.pendingWrite;
     if(prior&&prior.expected===expected){
      const version=await client.readVersion();
      if(e.epoch!==epoch||isPaused(e))return;
      if(samePortalContent(version.data,prior.data)){e.data.confirmedEtag=version.etag;e.data.pendingWrite=null;}
      else if(version.etag!==expected)throw Object.assign(Error('Конфликт публикации'),{status:412});
     }
     e.data.pendingWrite={expected:e.data.confirmedEtag,data:desired};
     if(!save(e))throw Error('Не удалось сохранить контрольную точку публикации');
     if(isPaused(e))return;
     const result=desired===null?await client.remove(e.data.confirmedEtag):await client.write(desired,e.data.confirmedEtag);
     if(e.epoch!==epoch)return;isPaused(e);e.data.confirmedEtag=result.etag;e.data.pendingWrite=null;
     if(desired===null)e.data.pendingDelete=false;
     save(e);status(e,desired===null?'Страница снята с публикации':'Опубликовано · '+new Date().toLocaleTimeString('ru-RU'));
    }
    else status(e,'Не опубликовано');
   }catch(error){if(e.epoch!==epoch)return;e.dirty=true;if(isPaused(e)){status(e,'Отправка остановлена на этом устройстве');break;}if(error.status===412){e.conflict=true;status(e,'Конфликт публикации · изменения на другом устройстве. Проверьте серверную версию.');break;}status(e,'Нет связи или доступа · изменения ожидают отправки');e.timer=setTimeout(()=>{e.timer=null;void flush(e);},15000);break;}
  }
 }finally{e.running=false;if(e.dirty&&e.publisher&&e.epoch!==epoch)void flush(e);}
}
export async function connectPortal(id,{origin,apiKey,email,password,slug='',team},fetcher=globalThis.fetch){
 const e=entry(id),d=e.data;isPaused(e);origin=firebaseOrigin(origin);
 if(d.origin&&d.origin!==origin)throw Error('Адрес существующей страницы нельзя менять. Используйте исходную базу.');
 const session=await firebaseSignIn(apiKey,email,password,fetcher);
 try{
  if(d.owner&&d.owner!==session.uid)throw Error('Войдите в исходную учётную запись владельца страницы');
  const chosen=d.slug||slug||Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');portalAddress(origin,session.uid,chosen);
  const publisher=firebasePublisher(origin,chosen,session,fetcher);
  const version=await publisher.readVersion(),remote=readPortal(version.data);
  const first=!d.slug;
  if(first&&remote){
   // Existing published content wins over an unbound local draft.
   d.team=remote.team;d.schedule=remote.schedule;d.archive=remote.archive;d.match=remote.match;d.publisherPaused=!!remote.match&&['live','break'].includes(remote.match.status);if(d.publisherPaused)persistPause(e,true);d.enabled=d.publisherPaused;d.activeId=d.publisherPaused?remote.match.id:null;
  }
  const expected=d.confirmedEtag;
  const safe=first||expected===version.etag||samePortalContent(version.data,d.pendingDelete||!d.enabled?null:snapshot(e))||!!d.pendingWrite&&samePortalContent(version.data,d.pendingWrite.data);
  e.session?.close();e.epoch++;e.session=session;e.publisher=publisher;e.conflict=!safe;
  Object.assign(d,{origin,apiKey,owner:session.uid,slug:chosen,team:d.team||String(team).trim()});
  if(safe){d.confirmedEtag=version.etag;d.pendingWrite=null;}
  save(e);status(e,d.publisherPaused?'Отправка приостановлена · продолжите из локального матча':e.conflict?'Конфликт публикации · проверьте серверную версию.':'Подключено · '+(d.enabled?'публикация включена':'публикация выключена'));
  if(!d.publisherPaused&&(d.pendingDelete||d.enabled))enqueue(e);
  return portalInfo(id);
 }catch(err){session.close();throw err;}
}
export function disconnectPortal(id){const e=entry(id);e.epoch++;e.session?.close();e.session=null;e.publisher=null;if(e.timer)clearTimeout(e.timer);e.timer=null;status(e,'Отключено · публичная страница сохраняет последний результат');}
// Explicit resolution: import the public projection only. Local coach records
// and unfinished match logs remain untouched. Never silently overwrite remote.
export async function acceptRemotePortal(id){
 const e=entry(id),client=e.publisher,epoch=e.epoch;
 if(!client||e.running)throw Error('Подключите Firebase и завершите текущий обмен.');
 const version=await client.readVersion();if(e.publisher!==client||e.epoch!==epoch||e.running)throw Error('Подключение изменилось. Повторите действие.');
 const remote=readPortal(version.data),d=e.data;
 if(e.timer)clearTimeout(e.timer);e.timer=null;
 if(e.archiveSending)throw Error('Завершите отправку архива');
 Object.assign(d,{archivePending:[],confirmedEtag:version.etag,pendingWrite:null,enabled:!!remote,pendingDelete:false,schedule:remote?.schedule||[],archive:remote?.archive||[],match:remote?.match||null,activeId:remote?.match&&['live','break'].includes(remote.match.status)?remote.match.id:null,publisherPaused:!!remote?.match&&['live','break'].includes(remote.match.status)});
 if(remote)d.team=remote.team;
 d.settings.auto=false;e.conflict=false;e.dirty=false;if(!save(e))throw Error('Не удалось сохранить серверную версию');persistPause(e,d.publisherPaused);
 status(e,d.publisherPaused?'Принята серверная версия · отправка счёта приостановлена':'Принята серверная версия · автоматический запуск выключен');return portalInfo(id);
}
/** Cooperative handoff: no write after acknowledged pause. No server lease. */
export function pausePortalPublisher(id){
 const e=entry(id),d=e.data;if(!d.enabled||!d.match||!['live','break'].includes(d.match.status))throw Error('Нет активной трансляции');
 if(e.running||e.dirty||d.pendingWrite||d.pendingDelete||e.conflict)throw Error('Сначала завершите текущий обмен и разрешите конфликт');
 persistPause(e,true);d.publisherPaused=true;d.settings.auto=false;
 if(!save(e))throw Error('Отправка остановлена, но не удалось сохранить настройки. Проверьте хранилище.');
 if(e.timer)clearTimeout(e.timer);e.timer=null;status(e,'Отправка остановлена · последний счёт остаётся на сайте');return portalInfo(id);
}
/** Before importing an active draft, explicitly hold publication on this client.
 * Nothing is written remotely; accepting a finished/null remote releases it. */
export function holdPortalForImportedDraft(id){
 const e=entry(id),d=e.data;if(e.running||e.dirty||d.pendingWrite||d.pendingDelete)throw Error('Сначала завершите обмен публичной страницы');
 persistPause(e,true);d.publisherPaused=true;d.settings.auto=false;
 if(!save(e))throw Error('Отправка приостановлена, но настройки не сохранились');
 if(e.timer)clearTimeout(e.timer);e.timer=null;status(e,'Отправка остановлена до подтверждения передачи');return portalInfo(id);
}
export async function previewPortalHandoff(id,local){
 const e=entry(id),client=e.publisher,epoch=e.epoch;if(local?.teamId!==id||!client||e.running||!isPaused(e)&&!e.conflict)throw Error('Подключите Firebase и приостановите отправку либо примите серверную версию');
 const version=await client.readVersion();if(e.publisher!==client||e.epoch!==epoch||e.running)throw Error('Подключение изменилось');
 const remote=readPortal(version.data);return {...checkHandoffMatch(local,remote?.match),etag:version.etag};
}
export async function continuePortalHandoff(id,local,expected,{confirmed=false}={}){
 if(!confirmed)throw Error('Подтвердите передачу управления');const e=entry(id),client=e.publisher,epoch=e.epoch,d=e.data;
 if(local?.teamId!==id||!client||e.running||!isPaused(e)&&!e.conflict)throw Error('Передача недоступна');
 const version=await client.readVersion();if(e.publisher!==client||e.epoch!==epoch||e.running||version.etag!==expected)throw Error('Опубликованная версия изменилась. Повторите предпросмотр.');
 const remote=readPortal(version.data);checkHandoffMatch(local,remote?.match);
 const before=clone(d),numbered=remote.match.events.some(x=>x.number!=null)||remote.match.stats.length>0;
 Object.assign(d,{team:remote.team,schedule:remote.schedule,archive:remote.archive,match:remote.match,activeId:local.id,enabled:true,pendingDelete:false,pendingWrite:null,confirmedEtag:version.etag,publisherPaused:false});
 // Never broaden public data permissions on takeover. Explicit opt-in can be
 // restored in settings; no newly disclosed numbers or statistics on resume.
 d.settings={...d.settings,auto:false,events:d.settings.events&&remote.match.events.length>0,numbers:d.settings.numbers&&numbered,stats:d.settings.stats&&d.settings.numbers&&numbered&&remote.match.stats.length>0};
 if(!save(e)){Object.assign(d,before);throw Error('Не удалось сохранить передачу управления');}
 try{persistPause(e,false);}catch(error){d.publisherPaused=true;save(e);throw error;}
 if(e.timer)clearTimeout(e.timer);e.timer=null;e.dirty=false;e.conflict=false;status(e,'Управление продолжено · счёт подтверждён, запись при следующем событии');return portalInfo(id);
}
export function setPortalEnabled(id,enabled,team){
 const e=entry(id),d=e.data;ensurePublishingAllowed(e);if(e.conflict)throw Error('Сначала разрешите конфликт публикации.');if(e.archiveSending&&!enabled)throw Error('Завершите отправку архива');if(enabled&&!e.publisher)throw Error('Сначала подключите Firebase');
 d.enabled=!!enabled;d.team=String(team||d.team).trim().slice(0,100);d.pendingDelete=!enabled; if(!enabled){d.activeId=null;d.match=null;d.archivePending=[];}
 save(e);enqueue(e);return portalInfo(id);
}
export function setPortalSettings(id,patch){
 const e=entry(id),d=e.data;ensurePublishingAllowed(e);if(e.archiveSending&&Object.hasOwn(patch,'permanent'))throw Error('Завершите отправку архива');for(const k of ['events','numbers','stats','auto','permanent'])if(Object.hasOwn(patch,k))d.settings[k]=!!patch[k];
 if(!d.settings.permanent&&Object.hasOwn(patch,'permanent'))d.archivePending=[];
 if(d.match){if(!d.settings.events)d.match.events=[];if(!d.settings.numbers){d.match.events=d.match.events.map(({number,...x})=>x);d.match.stats=[];}if(!d.settings.stats)d.match.stats=[];}
 save(e);if(d.enabled)enqueue(e);else notify(e);
}
export function saveFixture(id,item){
 const e=entry(id),d=e.data;ensurePublishingAllowed(e);const x=scheduleItem(item),next=d.schedule.filter(t=>t.id!==x.id);if(d.activeId&&d.match?.scheduledId===x.id)throw Error('Матч уже идёт');if(next.length>=20)throw Error('Не более 20 предстоящих матчей');d.schedule=sortedSchedule([...next,x]);save(e);if(d.enabled)enqueue(e);else notify(e);
}
export function removeFixture(id,fixtureId){const e=entry(id);ensurePublishingAllowed(e);if(e.data.match?.scheduledId===fixtureId&&['live','break'].includes(e.data.match.status))throw Error('Матч уже идёт');e.data.schedule=e.data.schedule.filter(x=>x.id!==fixtureId);save(e);if(e.data.enabled)enqueue(e);else notify(e);}
export function syncPortalMatch(match,{start=false,finish=false,discard=false}={}){
 if(match?.mode!=='dual')return false;const e=entry(match.teamId),d=e.data;if(isPaused(e)){if(start)ensurePublishingAllowed(e);return false;}if(!d.enabled)return false;
 const scheduled=matchingSchedule(d.schedule,match);
 const publicId='match_'+Date.parse(match.startedAt);
 const continuing=d.activeId===match.id||d.activeId===publicId&&d.match?.id===publicId;
 if(continuing)d.activeId=match.id;
 if(!continuing&&!start&&d.match?.id===publicId&&d.match.status==='finished')return false;
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
  if(scheduled?.logos)d.match.logos={ours:d.match.logos?.ours||scheduled.logos.ours,theirs:d.match.logos?.theirs||scheduled.logos.theirs};
  if(finish){if(d.match.status!=='finished')throw Error('Матч ещё не завершён');const completed=archiveMatch(d.match);if(d.settings.permanent)d.archivePending=queueArchiveResult(d.archivePending,completed);d.archive=sortedArchive([completed,...d.archive.filter(x=>x.id!==d.match.id)]);d.schedule=d.schedule.filter(x=>x.id!==scheduledId);d.activeId=null;}
 }
 save(e);enqueue(e);return true;
}
export function heartbeatPortal(id,matchId){const e=entry(id);if(!isPaused(e)&&!e.conflict&&e.data.enabled&&e.data.activeId===matchId&&e.data.match&&['live','break'].includes(e.data.match.status)){enqueue(e);return true;}return false;}
export function setPublicTeamName(id,team){const e=entry(id);ensurePublishingAllowed(e);const name=String(team).trim().slice(0,100);if(!name)throw Error('Укажите публичное название');e.data.team=name;save(e);if(e.data.enabled)enqueue(e);else notify(e);}
export function stopPortalMatch(id){const e=entry(id);ensurePublishingAllowed(e);e.data.activeId=null;e.data.match=null;e.data.settings.auto=false;save(e);if(e.data.enabled)enqueue(e);else notify(e);}

export async function publishSavedResult(id,match,{fixtureId=null}={}){
 const e=entry(id),d=e.data;ensurePublishingAllowed(e);if(!d.enabled)throw Error('Сначала опубликуйте страницу команды');
 if(match.teamId!==id)throw Error('Матч относится к другой команде');
 const result=await savedResult(match);
 ensurePublishingAllowed(e);if(!d.enabled||d.pendingDelete)throw Error('Публикация выключена');
 if(d.match?.id===result.id&&['live','break'].includes(d.match.status))throw Error('Сначала завершите текущую трансляцию');
 if(fixtureId&&!resultFixtures(d.schedule,match,['live','break'].includes(d.match?.status)?d.match?.scheduledId:null).some(x=>x.id===fixtureId))throw Error('Выбранная встреча недоступна или уже идёт');
 const next=sortedArchive([result,...d.archive.filter(x=>x.id!==result.id)]);
 if(!next.some(x=>x.id===result.id))throw Error('В публичном архиве доступны только 20 последних матчей');
 if(d.settings.permanent)d.archivePending=queueArchiveResult(d.archivePending,result);d.archive=next;if(fixtureId)d.schedule=d.schedule.filter(x=>x.id!==fixtureId);
 save(e);enqueue(e);return result;
}
export function unpublishResult(id,resultId){
 const e=entry(id),d=e.data;ensurePublishingAllowed(e);
 if(e.archiveSending)throw Error('Завершите отправку архива');if(!d.enabled)throw Error('Сначала включите публикацию страницы');
 if(d.match?.id===resultId&&['live','break'].includes(d.match.status))throw Error('Нельзя убрать текущую трансляцию');
 if(!d.archive.some(x=>x.id===resultId)&&d.match?.id!==resultId)throw Error('Результат уже отсутствует');
 d.archivePending=d.archivePending.filter(x=>x.id!==resultId);d.archive=d.archive.filter(x=>x.id!==resultId);
 if(d.match?.id===resultId&&d.match.status==='finished')d.match=null;
 save(e);enqueue(e);
}

function archiveSession(id){
 const e=entry(id),d=e.data;ensurePublishingAllowed(e);if(!e.session||!d.enabled||d.pendingDelete||e.conflict||e.dirty||e.running)throw Error('Сначала завершите синхронизацию публичной страницы');
 const session=e.session,epoch=e.epoch,target=archiveTarget(portalAddress(d.origin,d.owner,d.slug));
 const stillAllowed=()=>{if(e.session!==session||e.epoch!==epoch||isPaused(e)||!d.enabled||d.pendingDelete||e.conflict||e.dirty||e.running)throw Error('Состояние публикации изменилось. Обновите список.');};
 return {session,target,portal:portalAddress(d.origin,d.owner,d.slug),stillAllowed};
}
async function resolvePublisherArchive(access,fetcher,write=false){
 const route=await resolveArchiveRoute(access.portal,{fetcher});access.stillAllowed();
 return write?requireWritableArchive(route):route;
}
export async function listExtendedArchive(id,{cursor=null,expectedRoute=null,fetcher=fetch}={}){
 const access=archiveSession(id),route=await resolvePublisherArchive(access,fetcher),reset=expectedRoute!==null&&expectedRoute!==route.key,page=await routedArchivePage(route,{cursor:reset?null:cursor,fetcher});access.stillAllowed();return {...page,routeKey:route.key,reset};
}
// Serialize every archive mutation in this tab, including the confirmation
// dialog and all awaits. ETag CAS remains the cross-device record guard.
async function withArchiveMutation(id,task){
 const e=entry(id);if(e.archiveSending)throw Error('Завершите текущую операцию архива');
 e.archiveSending=true;notify(e);
 try{return await task();}finally{e.archiveSending=false;notify(e);}
}
export async function publishExtendedResult(id,result,options={}){
 return withArchiveMutation(id,()=>publishExtendedResultCore(id,result,options));
}
async function publishExtendedResultCore(id,result,{confirm,fetcher=fetch}={}){
 const access=archiveSession(id),route=await resolvePublisherArchive(access,fetcher,true),k=archiveKey(result),version=await routedArchiveVersion(route,result,fetcher);
 access.stillAllowed();const existing=await routedArchiveFind(route,result,fetcher);access.stillAllowed();if(existing&&existing.archiveKey!==k)throw Error('Этот результат уже сохранён под другой датой. Проверьте архив.');if(!await confirm?.(version.value))return false;access.stillAllowed();
 const token=await access.session.getToken();access.stillAllowed();await routedArchiveWrite(route,result,result,token,version.etag,fetcher);return true;
}
export async function removeExtendedResult(id,result,options={}){
 return withArchiveMutation(id,()=>removeExtendedResultCore(id,result,options));
}
async function removeExtendedResultCore(id,result,{confirm,fetcher=fetch}={}){
 const access=archiveSession(id),route=await resolvePublisherArchive(access,fetcher,true),version=await routedArchiveVersion(route,result,fetcher);
 access.stillAllowed();if(!version.value)return false;
 if(!equalArchiveResult(version.value,result))throw Error('Запись изменилась. Обновите список перед удалением.');
 if(!await confirm?.(version.value))return false;access.stillAllowed();
 const token=await access.session.getToken();access.stillAllowed();await routedArchiveWrite(route,result,null,token,version.etag,fetcher);access.stillAllowed();const e=entry(id);e.data.archivePending=e.data.archivePending.filter(x=>x.id!==result.id);save(e);notify(e);return true;
}
/** Copy only already-confirmed public score projections; never replace existing records. */
export async function migrateExtendedArchive(id,options={}){
 return withArchiveMutation(id,()=>migrateExtendedArchiveCore(id,options));
}
async function migrateExtendedArchiveCore(id,{confirm,fetcher=fetch}={}){
 const access=archiveSession(id),rows=clone(entry(id).data.archive);
 if(!await confirm?.(rows.length))return {cancelled:true,copied:0,existing:0,conflicts:0,failed:0};
 const route=await resolvePublisherArchive(access,fetcher,true);
 const report={cancelled:false,copied:0,existing:0,conflicts:0,failed:0};
 for(const row of rows){access.stillAllowed();try{
  const version=await routedArchiveVersion(route,row,fetcher);access.stillAllowed();
  if(version.value){if(equalArchiveResult(version.value,row))report.existing++;else report.conflicts++;continue;}
   const existing=await routedArchiveFind(route,row,fetcher);access.stillAllowed();if(existing){report.conflicts++;continue;}
  const token=await access.session.getToken();access.stillAllowed();
  await routedArchiveWrite(route,row,row,token,version.etag,fetcher);report.copied++;
 }catch(e){access.stillAllowed();if(e.status===412)report.conflicts++;else report.failed++;}}
 return report;
}

export async function loadMediaVersion(id,fetcher=fetch){const a=archiveSession(id),v=await readMediaVersion(mediaTarget(a.portal),fetcher);a.stillAllowed();return v;}
export async function publishMediaVersion(id,value,etag,fetcher=fetch){const a=archiveSession(id),token=await a.session.getToken();a.stillAllowed();await writePublicMedia(mediaTarget(a.portal),mediaProjection(value),token,etag,fetcher);return true;}

/** Pending records are created only by explicit opt-in on already public results.
 * Retry is manual; conflicts never overwrite and remain queued. */
export function discardPendingArchive(id,resultId){
 const e=entry(id);ensurePublishingAllowed(e);if(e.archiveSending)throw Error('Завершите отправку архива');
 const before=e.data.archivePending;e.data.archivePending=before.filter(x=>x.id!==resultId);
 if(!save(e)){e.data.archivePending=before;throw Error('Не удалось сохранить очередь');}notify(e);
}
export async function sendPendingArchive(id,options={}){
 return withArchiveMutation(id,()=>sendPendingArchiveCore(id,options));
}
async function sendPendingArchiveCore(id,{confirm,fetcher=fetch}={}){
 const e=entry(id),access=archiveSession(id),rows=clone(e.data.archivePending);
 if(!rows.length)return {copied:0,existing:0,conflicts:0,failed:0};
 const report={copied:0,existing:0,conflicts:0,failed:0};
 {
  if(!await confirm?.(rows.length))return {...report,cancelled:true};
  access.stillAllowed();const route=await resolvePublisherArchive(access,fetcher,true);
  for(const row of rows){
   try{
    access.stillAllowed();
    if(!e.data.archivePending.some(x=>equalArchiveResult(x,row)))continue;
    const version=await routedArchiveVersion(route,row,fetcher);access.stillAllowed();
    if(version.value&&!equalArchiveResult(version.value,row)){report.conflicts++;continue;}
    if(!version.value){
     const existing=await routedArchiveFind(route,row,fetcher);access.stillAllowed();if(existing){report.conflicts++;continue;}
     const token=await access.session.getToken();access.stillAllowed();
     if(!e.data.archivePending.some(x=>equalArchiveResult(x,row)))continue;
     await routedArchiveWrite(route,row,row,token,version.etag,fetcher);report.copied++;
    }else report.existing++;
    access.stillAllowed();
    const before=e.data.archivePending;e.data.archivePending=before.filter(x=>!equalArchiveResult(x,row));
    if(!save(e)){e.data.archivePending=before;throw Error('Не удалось сохранить подтверждение очереди');}
   }catch(error){if(error.status===412)report.conflicts++;else report.failed++;}
  }
  return report;
 }
}
