/* Separate bounded public media projection. No local IDs, notes, participants, or live credentials. */
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const text=(v,max,min=0)=>{if(typeof v!=='string'||v.length>max||v.trim().length<min)throw Error('Некорректный текст публикации');return v.trim();};
const integer=(v,max=999999)=>{if(!Number.isInteger(v)||v<0||v>max)throw Error('Некорректное число');return v;};
const date=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw Error('Некорректная дата');return v;};
const arr=(v,max)=>{const a=Array.isArray(v)?v:v&&typeof v==='object'?Object.keys(v).filter(k=>/^(0|[1-9]\d{0,2})$/.test(k)).sort((a,b)=>+a-+b).map(k=>v[k]):[];if(a.length>max)throw Error('Превышен предел публикации');return a;};
export const newsTypes={news:'Новости',announcement:'Анонс',achievement:'Достижение',result:'Итоги'};
export function newsProjection(r){
 if(!r||!id(r.publicId)||!Object.hasOwn(newsTypes,r.type))throw Error('Некорректная новость');
 return {publicId:r.publicId,type:r.type,title:text(r.title,120,1),body:text(r.body,2000,1),date:date(r.date)};
}
export function readPublicTournament(t){
 if(!t||!['league','knockout','groups'].includes(t.system)||!['volleyball','score'].includes(t.format))throw Error('Некорректный турнир');
 return {name:text(t.name,200,1),system:t.system,format:t.format,rows:arr(t.rows,32).map(r=>({name:text(r.name,200,1),place:integer(r.place,32),group:integer(r.group,2),played:integer(r.played,32),won:integer(r.won,32),draw:integer(r.draw,32),lost:integer(r.lost,32),points:integer(r.points,1000)})),games:arr(t.games,500).map(g=>{
  if(!['finished','scheduled','waiting'].includes(g.status))throw Error('Некорректный статус игры');
  const time=text(g.time,5);if(time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Некорректное время');
  const score=g.status==='finished'?text(g.score,9,1):null;if(score&&!/^\d{1,3}:\d{1,3}$/.test(score))throw Error('Некорректный счёт');
  return {round:integer(g.round,32),group:integer(g.group,2),a:text(g.a,200,1),b:text(g.b,200,1),date:g.date?date(g.date):'',time,venue:text(g.venue,200),status:g.status,...(score?{score}:{})};
 })};
}
export function mediaProjection(raw){
 const news=arr(raw?.news,20).map(newsProjection);if(new Set(news.map(n=>n.publicId)).size!==news.length)throw Error('Повтор новости');
 return {schema:1,news:news.sort((a,b)=>b.date.localeCompare(a.date)||a.publicId.localeCompare(b.publicId)),...(raw?.tournament?{tournament:readPublicTournament(raw.tournament)}:{})};
}
export function mediaTarget(address){const u=new URL(address);if(u.protocol!=='https:'||u.username||u.password||u.port||!/^([a-z0-9-]+\.)+(firebaseio\.com|firebasedatabase\.app)$/.test(u.hostname)||!/^\/publicTeams\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}\.json$/.test(u.pathname)||u.search||u.hash)throw Error('Некорректный адрес медиацентра');u.pathname=u.pathname.replace('/publicTeams/','/publicMedia/');return u.href;}
async function request(url,options,fetcher){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetcher(url,{cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,...options});if(!r.ok)throw Object.assign(Error(r.status===412?'Публикация изменилась на другом устройстве':r.status===401||r.status===403?'Медиацентр не настроен или недоступен':'Ошибка медиацентра '+r.status),{status:r.status});return {value:await r.json(),etag:r.headers.get('ETag')};}finally{clearTimeout(timer);}}

/** A server response is not a local draft: never silently drop unknown fields
 * or sparse collection entries before a confirmed replacement. Firebase may
 * omit an empty news collection or return contiguous numeric-key objects. */
function wireFields(value,required,optional=[]){
 if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))throw Error('Некорректная структура медиацентра');
}
function wireArray(value,max){
 if(!value||typeof value!=='object')throw Error('Некорректная коллекция медиацентра');
 const keys=Object.keys(value);
 if(keys.length>max||keys.some((k,i)=>k!==String(i))||Array.isArray(value)&&value.length!==keys.length)throw Error('Некорректная коллекция медиацентра');
 return keys.map(k=>value[k]);
}
export function readMediaWire(raw){
 if(raw===null)return mediaProjection(null);
 wireFields(raw,['schema'],['news','tournament']);
 if(raw.schema!==1)throw Error('Неизвестная версия медиацентра');
 if(Object.hasOwn(raw,'news'))for(const row of wireArray(raw.news,20))wireFields(row,['publicId','type','title','body','date']);
 if(Object.hasOwn(raw,'tournament')){
  const t=raw.tournament;wireFields(t,['name','system','format','rows','games']);
  for(const row of wireArray(t.rows,32))wireFields(row,['name','place','group','played','won','draw','lost','points']);
  for(const game of wireArray(t.games,500))wireFields(game,['round','group','a','b','date','time','venue','status',...(game?.status==='finished'?['score']:[])]);
 }
 return mediaProjection(raw);
}
function checkedMediaTarget(target){
 const u=new URL(target);
 if(!u.pathname.startsWith('/publicMedia/')||mediaTarget(u.href.replace('/publicMedia/','/publicTeams/'))!==u.href)throw Error('Некорректный адрес медиацентра');
 return u;
}
function ownerMediaTarget(target,token){
 const u=checkedMediaTarget(target);
 if(typeof token!=='string'||!token)throw Error('Нужна авторизация владельца');
 u.searchParams.set('auth',token);return u.href;
}
export async function readMediaVersion(target,fetcher=fetch,token=null){
 const url=token===null?checkedMediaTarget(target).href:ownerMediaTarget(target,token);
 const r=await request(url,{headers:{'X-Firebase-ETag':'true'}},fetcher);
 if(!r.etag)throw Error('Нет версии медиацентра');
 return {etag:r.etag,exists:r.value!==null,value:readMediaWire(r.value)};
}
export async function fetchPublicMedia(target,fetcher=fetch){
 const r=await request(checkedMediaTarget(target).href,{},fetcher);return readMediaWire(r.value);
}
/** Do not acknowledge a write just because its HTTP response succeeded. */
export async function writePublicMedia(target,value,token,etag,fetcher=fetch){
 if(typeof etag!=='string'||!etag)throw Error('Нужна авторизация и версия');
 const next=mediaProjection(value),url=ownerMediaTarget(target,token);
 await request(url,{method:'PUT',headers:{'If-Match':etag,'Content-Type':'application/json'},body:JSON.stringify(next)},fetcher);
 const after=await readMediaVersion(target,fetcher,token);
 if(!after.exists||JSON.stringify(after.value)!==JSON.stringify(next))throw Object.assign(Error('Не удалось подтвердить опубликованную версию медиацентра'),{status:412});
 return after;
}
/** Explicit CAS purge, including a retained hidden media node. No recreation. */
export async function removePublicMedia(target,token,etag,fetcher=fetch){
 if(typeof etag!=='string'||!etag)throw Error('Нужна авторизация и версия');
 const url=ownerMediaTarget(target,token);
 await request(url,{method:'DELETE',headers:{'If-Match':etag}},fetcher);
 const after=await readMediaVersion(target,fetcher,token);
 if(after.exists)throw Object.assign(Error('Не удалось подтвердить удаление медиацентра'),{status:412});
 return after;
}

/** Build the exact public replacement before operator confirmation. */
export function planMediaNews(value,draft){
 const current=readMediaWire(value),item=newsProjection(draft),previous=current.news.find(n=>n.publicId===item.publicId)||null;
 const next=mediaProjection({...current,news:[item,...current.news.filter(n=>n.publicId!==item.publicId)]});
 return {previous,item,next,changed:!previous||JSON.stringify(previous)!==JSON.stringify(item)};
}
export function planMediaTournament(value,tournament){
 const current=readMediaWire(value),item=readPublicTournament(tournament);
 return {previous:current.tournament||null,item,next:mediaProjection({...current,tournament:item}),changed:JSON.stringify(current.tournament||null)!==JSON.stringify(item)};
}

/** The local draft is never sent automatically; unread is not unpublished. */
export function newsDraftStatus(draft,version){
 const item=newsProjection(draft);
 if(!version)return 'unknown';
 const old=readMediaWire(version.value).news.find(n=>n.publicId===item.publicId);
 return !old?'local':JSON.stringify(old)===JSON.stringify(item)?'published':'changed';
}

/** Portable public-only recovery snapshot, bound to the exact portal.
 * Checksum detects accidental corruption, not a malicious file author. */
async function mediaBackupDigest(value){
 const bytes=new TextEncoder().encode(JSON.stringify(value));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function createMediaBackup(address,version){
 const target=mediaTarget(address);
 if(!version||typeof version.exists!=='boolean'||typeof version.etag!=='string'||!version.etag)throw Error('Сначала получите серверную версию');
 const value=readMediaWire(version.value);
 if(!version.exists&&(value.news.length||value.tournament))throw Error('Некорректная версия медиацентра');
 const payload={format:'teachapp-public-media-backup',schema:1,target,exists:version.exists,value};
 return {...payload,sha256:await mediaBackupDigest(payload)};
}
export async function verifyMediaBackup(address,backup){
 wireFields(backup,['format','schema','target','exists','value','sha256']);
 if(backup.format!=='teachapp-public-media-backup'||backup.schema!==1||backup.target!==mediaTarget(address)||typeof backup.exists!=='boolean'||typeof backup.sha256!=='string'||!/^[a-f0-9]{64}$/.test(backup.sha256))throw Error('Некорректная копия или другой портал');
 const value=readMediaWire(backup.value);
 if(!backup.exists&&(value.news.length||value.tournament))throw Error('Некорректная пустая копия');
 const payload={format:backup.format,schema:1,target:backup.target,exists:backup.exists,value};
 if(await mediaBackupDigest(payload)!==backup.sha256)throw Error('Контрольная сумма копии не совпадает');
 return payload;
}
/** Restore is additive only. Never overwrite a changed public ID or tournament,
 * silently truncate at the 20-news limit, or purge from an empty backup. */
export async function planMediaRecovery(address,version,backup){
 if(!version||typeof version.etag!=='string'||!version.etag)throw Error('Сначала получите серверную версию');
 const saved=await verifyMediaBackup(address,backup),current=readMediaWire(version.value);
 const news=current.news.slice(),added=[],conflicts=[];
 for(const item of saved.value.news){
  const old=news.find(n=>n.publicId===item.publicId);
  if(!old){news.push(item);added.push(item);}
  else if(JSON.stringify(old)!==JSON.stringify(item))conflicts.push(item.publicId);
 }
 const tournamentConflict=!!(current.tournament&&saved.value.tournament&&JSON.stringify(current.tournament)!==JSON.stringify(saved.value.tournament));
 const addTournament=!current.tournament&&!!saved.value.tournament;
 const blocked=conflicts.length>0||tournamentConflict||news.length>20;
 return {added,conflicts,tournamentConflict,addTournament,overLimit:news.length>20,changed:!blocked&&(added.length>0||addTournament),next:blocked?null:mediaProjection({news,tournament:current.tournament||saved.value.tournament})};
}
