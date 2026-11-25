// Public archive v2: score-only projection. Never stores a private match record.
import {viewerPageLink,resultOutcome} from './public-portal.js';
const id=/^[A-Za-z0-9_-]{1,100}$/,key=/^\d{16}_[A-Za-z0-9_-]{1,100}$/;
const validScore=x=>Number.isInteger(x)&&x>=0&&x<=9999;
export function archiveProjection(r){
 if(!r||typeof r.id!=='string'||!id.test(r.id)||typeof r.opponent!=='string'||!r.opponent.trim()||r.opponent.length>100||!Number.isSafeInteger(r.startedAt)||r.startedAt<0||r.startedAt>8640000000000000)throw Error('Некорректный результат');
 const rawSets=r.sets;if(!rawSets||typeof rawSets!=='object')throw Error('Некорректные партии');const keys=Object.keys(rawSets);if(keys.some((k,i)=>k!==String(i)))throw Error('Нарушена последовательность партий');const sets=Object.values(rawSets);if(!sets.length||sets.length>5||sets.some(s=>!validScore(s?.ours)||!validScore(s?.theirs)||s.ours===s.theirs))throw Error('Некорректные партии');
 const ours=sets.filter(s=>s.ours>s.theirs).length,theirs=sets.length-ours;if(r.setsWon?.ours!==ours||r.setsWon?.theirs!==theirs)throw Error('Итог не совпадает с партиями');
 return {id:r.id,opponent:r.opponent,startedAt:r.startedAt,setsWon:{ours,theirs},sets:sets.map(s=>({ours:s.ours,theirs:s.theirs}))};
}
export function archiveKey(r){const x=archiveProjection(r);return String(x.startedAt).padStart(16,'0')+'_'+x.id;}
export function archiveTarget(address){const u=new URL(address);if(u.protocol!=='https:'||!/^([a-z0-9-]+\.)+(firebaseio\.com|firebasedatabase\.app)$/.test(u.hostname)||!/^\/publicTeams\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}\.json$/.test(u.pathname)||u.search||u.hash)throw Error('Некорректный адрес архива');u.pathname=u.pathname.replace('/publicTeams/','/publicMatchArchive/');return u.href;}
// UTC September–August bounds use the same sortable keys as archiveKey.
export function archiveSeasonBounds(season='all'){
 if(season==='all')return null;
 if(typeof season!=='string'||!/^\d{4}$/.test(season)||Number(season)<1970||Number(season)>9998)throw Error('Некорректный год сезона');
 const year=Number(season),start=Date.UTC(year,8,1),end=Date.UTC(year+1,8,1)-1;
 return {start:String(start).padStart(16,'0')+'_',end:String(end).padStart(16,'0')+'_\uf8ff'};
}
export function archivePage(raw,{cursor=null,limit=20,season='all'}={}){const bounds=archiveSeasonBounds(season);if(!Number.isInteger(limit)||limit<1||limit>40||cursor!==null&&(typeof cursor!=='string'||!key.test(cursor)||bounds&&(cursor<bounds.start||cursor>bounds.end)))throw Error('Некорректный курсор');const keys=Object.keys(raw||{}).filter(k=>key.test(k)&&(!bounds||k>=bounds.start&&k<=bounds.end)&&(!cursor||k<cursor)).sort().reverse();const rows=[];for(const k of keys.slice(0,limit)){try{const r=archiveProjection(raw[k]);if(archiveKey(r)===k)rows.push({...r,archiveKey:k});}catch{}}return {rows,cursor:keys.length>limit?keys[limit-1]:null};}
async function request(url,options={},fetcher=fetch){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetcher(url,{cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,...options});if(!r.ok)throw Object.assign(Error(r.status===412?'Результат изменён на другом устройстве':r.status===401||r.status===403?'Расширенный архив недоступен или не настроен':'Ошибка архива: '+r.status),{status:r.status});return {value:await r.json(),etag:r.headers.get('ETag')};}finally{clearTimeout(timer);}}
export async function fetchArchivePage(target,{cursor=null,limit=20,season='all',fetcher=fetch}={}){archivePage(null,{cursor,limit,season});const bounds=archiveSeasonBounds(season);const u=new URL(target);u.searchParams.set('orderBy','"$key"');u.searchParams.set('limitToLast',String(limit+(cursor?2:1)));if(bounds)u.searchParams.set('startAt',JSON.stringify(bounds.start));if(cursor||bounds)u.searchParams.set('endAt',JSON.stringify(cursor||bounds.end));return archivePage((await request(u.href,{},fetcher)).value,{cursor,limit,season});}
function recordURL(target,k){if(typeof k!=='string'||!key.test(k))throw Error('Некорректная ссылка на матч');return target.replace(/\.json$/,'/'+k+'.json');}
export async function fetchArchiveRecord(target,k,fetcher=fetch){const r=await request(recordURL(target,k),{},fetcher);if(!r.value)return null;const v=archiveProjection(r.value);if(archiveKey(v)!==k)throw Error('Некорректный ключ результата');return {...v,archiveKey:k};}
export async function readArchiveVersion(target,k,fetcher=fetch){const r=await request(recordURL(target,k),{headers:{'X-Firebase-ETag':'true'}},fetcher);if(!r.etag)throw Error('Сервер не вернул версию записи');const value=r.value?archiveProjection(r.value):null;if(value&&archiveKey(value)!==k)throw Error('Некорректный ключ результата');return {etag:r.etag,value};}
export async function writeArchiveRecord(target,k,value,token,etag,fetcher=fetch){if(!token||!etag)throw Error('Требуется подтверждённая версия и авторизация');if(value!==null&&archiveKey(value)!==k)throw Error('Некорректный ключ');const u=new URL(recordURL(target,k));u.searchParams.set('auth',token);return request(u.href,{method:value===null?'DELETE':'PUT',headers:{'If-Match':etag,'Content-Type':'application/json'},...(value===null?{}:{body:JSON.stringify(archiveProjection(value))})},fetcher);}
/** Resolve a legacy opaque result ID only when it uniquely identifies an archive row. */
export async function fetchArchiveById(target,value,fetcher=fetch){
 if(typeof value!=='string'||!id.test(value))throw Error('Некорректная ссылка на результат');
 const u=new URL(target);u.searchParams.set('orderBy','"id"');u.searchParams.set('equalTo',JSON.stringify(value));u.searchParams.set('limitToFirst','2');
 const raw=(await request(u.href,{},fetcher)).value||{},keys=Object.keys(raw);
 if(keys.length>1)throw Error('Несколько записей с одним идентификатором');
 if(!keys.length)return null;
 const k=keys[0],r=archiveProjection(raw[k]);if(r.id!==value||archiveKey(r)!==k)throw Error('Некорректная запись архива');
 return {...r,archiveKey:k};
}
/** Durable, score-only local outbox. Same ID correction replaces the pending copy. */
export function queueArchiveResult(rows,result){
 const safe=archiveProjection(result);
 return [...rows.filter(r=>r.id!==safe.id),safe];
}
export function resultLink(href,r){const u=new URL(viewerPageLink(href));const value=r.archiveKey||r.id;if(!(r.archiveKey?key:id).test(value||''))throw Error('Некорректная ссылка на результат');u.searchParams.set(r.archiveKey?'archive':'match',value);return u.href;}
// RFC 5545 text escaping and stable event identity across rescheduling.
// Fold by UTF-8 octets, not UTF-16 code units, without splitting a code point.
function foldCalendarLine(line){
 const encoder=new TextEncoder();let result='',bytes=0;
 for(const ch of line){const n=encoder.encode(ch).length;if(bytes+n>75){result+='\r\n ';bytes=1;}result+=ch;bytes+=n;}
 return result;
}
export function fixtureCalendar(team,fixture){
 if(!fixture||typeof fixture.id!=='string'||!id.test(fixture.id)||!Number.isSafeInteger(fixture.startAt)||fixture.startAt<0||fixture.startAt>253402300799999)throw Error('Некорректная встреча');
 const safe=v=>String(v??'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const dt=v=>new Date(v).toISOString().replace(/[-:]|\.\d{3}/g,'');
 return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//TeachApp//Schedule//RU','BEGIN:VEVENT','UID:'+fixture.id+'@teachapp','DTSTAMP:'+dt(Date.now()),'DTSTART:'+dt(fixture.startAt),'SUMMARY:'+safe(team+' — '+fixture.opponent),'END:VEVENT','END:VCALENDAR',''].map(foldCalendarLine).join('\r\n');
}

/** School/sport season is September through August, using UTC for stable grouping. */
export function archiveSeason(startedAt){const d=new Date(startedAt);if(!Number.isFinite(d.getTime()))return null;return d.getUTCFullYear()-(d.getUTCMonth()<8?1:0);}
export function archiveSeasons(rows){return [...new Set(rows.map(r=>archiveSeason(r.startedAt)).filter(y=>y!==null))].sort((a,b)=>b-a);}
export function filterArchiveSeason(rows,season='all'){return season==='all'?rows:rows.filter(r=>String(archiveSeason(r.startedAt))===String(season));}
/** Compare complete public score projections, not private match IDs or notes. */
export function equalArchiveResult(a,b){try{return JSON.stringify(archiveProjection(a))===JSON.stringify(archiveProjection(b));}catch{return false;}}

/** Search only public, already loaded rows. Search never changes the season
 * summary or silently requests more pages from Firebase. */
const searchKey=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').trim().replace(/\s+/g,' ');
export function searchArchive(rows,{query='',season='all',outcome='all'}={}){
 if(!['all','win','loss','draw'].includes(outcome))throw Error('Некорректный фильтр');
 const words=searchKey(query).slice(0,200).split(' ').filter(Boolean);
 return filterArchiveSeason(rows,season).filter(r=>{
  if(outcome!=='all'&&resultOutcome(r)!==outcome)return false;
  const name=searchKey(r.opponent);
  if(words.length<=1)return !words.length||name.includes(words[0]);
  // For several terms use word prefixes. "победа б" must not match
  // "победа а" just because the letter б is inside the first word.
  const tokens=name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.every(w=>tokens.some(token=>token.startsWith(w)));
 });
}
/** Current public stream wins over an older fetched archive copy. Keep the
 * direct archive key only when the full public scores agree. */
export function mergeLoadedResults(current,extra){
 const rows=new Map(extra.map(r=>[r.id,r]));
 for(const row of current){
  const old=rows.get(row.id);
  rows.set(row.id,old?.archiveKey&&equalArchiveResult(old,row)?{...row,archiveKey:old.archiveKey}:row);
 }
 return [...rows.values()].sort((a,b)=>b.startedAt-a.startedAt||a.id.localeCompare(b.id));
}
/** Build a card from validated score-only data; ignore all other fields. */
export function publicResultCard(team,row){
 const r=archiveProjection(row);
 const date=new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',...(r.id.startsWith('result_')?{timeZone:'UTC'}:{})}).format(r.startedAt);
 return {template:'result',format:'square',team:String(team??'').trim().slice(0,100),opponent:r.opponent,score:r.setsWon.ours+' : '+r.setsWon.theirs,details:date+' · Партии: '+r.sets.map(s=>s.ours+':'+s.theirs).join(' / '),footer:'TeachApp · Опубликованный результат'};
}

/** Exact arithmetic from public set scores, never player or rally estimates. */
export function archiveMatchSummary(row){
 const r=archiveProjection(row),points=r.sets.reduce((s,x)=>({ours:s.ours+x.ours,theirs:s.theirs+x.theirs}),{ours:0,theirs:0});
 return {points,margin:points.ours-points.theirs,sets:r.sets.map((s,i)=>({number:i+1,...s,margin:s.ours-s.theirs}))};
}
/** Group by normalized exact opponent name. Different names are never guessed as aliases. */
export function opponentHistory(rows){
 const groups=new Map(),seen=new Set();
 for(const row of [...rows].sort((a,b)=>b.startedAt-a.startedAt||a.id.localeCompare(b.id))){
  let r;try{r=archiveProjection(row);}catch{continue;}
  if(seen.has(r.id))continue;seen.add(r.id);
  const name=searchKey(r.opponent),g=groups.get(name)||{key:name,opponent:r.opponent,played:0,win:0,loss:0,draw:0,sets:{ours:0,theirs:0},points:{ours:0,theirs:0},rows:[]};
  g.played++;g[resultOutcome(r)]++;g.sets.ours+=r.setsWon.ours;g.sets.theirs+=r.setsWon.theirs;
  const s=archiveMatchSummary(r);g.points.ours+=s.points.ours;g.points.theirs+=s.points.theirs;g.rows.push({...r,...(row.archiveKey&&archiveKey(r)===row.archiveKey?{archiveKey:row.archiveKey}:{})});groups.set(name,g);
 }
 return [...groups.values()].sort((a,b)=>b.played-a.played||a.opponent.localeCompare(b.opponent,'ru'));
}
