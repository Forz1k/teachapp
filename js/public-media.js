/* Separate bounded public media projection. No local IDs, notes, participants, or live credentials. */
import {gamesOf,standings,validateTournament} from './tournaments.js';
import {uid,todayIso} from './model.js';
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
export function validateNewsDraft(r){
 if(r.kind!=='publicNewsDraft'||!id(r.id)||!id(r.teamId)||!Object.keys(r).every(k=>['kind','id','teamId','publicId','type','title','body','date'].includes(k)))throw Error('Некорректный черновик');
 newsProjection(r);return r;
}
export function newNewsDraft(teamId,input,old=null){return validateNewsDraft({kind:'publicNewsDraft',id:old?.id||uid('news'),teamId,publicId:old?.publicId||crypto.randomUUID(),type:input.type,title:input.title.trim(),body:input.body.trim(),date:input.date||todayIso()});}
export function tournamentProjection(t){
 validateTournament(t);const label=id=>t.teams.find(x=>x.id===id)?.name||'Участник определится';
 const games=gamesOf(t).filter(g=>!g.bye);if(games.length>500)throw Error('Турнир слишком большой для публикации');
 return readPublicTournament({name:t.name,system:t.system,format:t.format,rows:standings(t).map(r=>({name:r.name,place:r.place,group:r.group||0,played:r.played,won:r.won,draw:r.draw,lost:r.lost,points:r.points})),games:games.map(g=>({round:g.round,group:g.group||0,a:label(g.a),b:label(g.b),date:g.date||'',time:g.time||'',venue:g.venue||'',status:g.result?'finished':g.ready?'scheduled':'waiting',...(g.result?{score:g.result.a+':'+g.result.b}:{})}))});
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
export function mediaTarget(address){const u=new URL(address);if(u.protocol!=='https:'||!/^([a-z0-9-]+\.)+(firebaseio\.com|firebasedatabase\.app)$/.test(u.hostname)||!/^\/publicTeams\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}\.json$/.test(u.pathname)||u.search||u.hash)throw Error('Некорректный адрес медиацентра');u.pathname=u.pathname.replace('/publicTeams/','/publicMedia/');return u.href;}
async function request(url,options,fetcher){const r=await fetcher(url,{cache:'no-store',referrerPolicy:'no-referrer',...options});if(!r.ok)throw Object.assign(Error(r.status===412?'Публикация изменилась на другом устройстве':r.status===401||r.status===403?'Медиацентр не настроен или недоступен':'Ошибка медиацентра '+r.status),{status:r.status});return {value:await r.json(),etag:r.headers.get('ETag')};}
export async function readMediaVersion(target,fetcher=fetch){const r=await request(target,{headers:{'X-Firebase-ETag':'true'}},fetcher);if(!r.etag)throw Error('Нет версии медиацентра');if(r.value&&r.value.schema!==1)throw Error('Неизвестная версия медиацентра');return {etag:r.etag,value:mediaProjection(r.value)};}
export async function fetchPublicMedia(target,fetcher=fetch){const r=await request(target,{},fetcher);if(r.value&&r.value.schema!==1)throw Error('Неизвестная версия медиацентра');return mediaProjection(r.value);}
export async function writePublicMedia(target,value,token,etag,fetcher=fetch){if(!token||!etag)throw Error('Нужна авторизация и версия');const u=new URL(target);u.searchParams.set('auth',token);return request(u.href,{method:'PUT',headers:{'If-Match':etag,'Content-Type':'application/json'},body:JSON.stringify(mediaProjection(value))},fetcher);}
