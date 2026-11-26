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
export function archiveTarget(address){const u=new URL(address);if(u.protocol!=='https:'||u.username||u.password||u.port||!/^([a-z0-9-]+\.)+(firebaseio\.com|firebasedatabase\.app)$/.test(u.hostname)||!/^\/publicTeams\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9_-]{1,100}\.json$/.test(u.pathname)||u.search||u.hash)throw Error('Некорректный адрес архива');u.pathname=u.pathname.replace('/publicTeams/','/publicMatchArchive/');return u.href;}
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
export function mergeLoadedArchive(current,extra){
 const rows=new Map(),conflicts=new Set();
 for(const row of extra){
  if(conflicts.has(row.id))continue;
  const old=rows.get(row.id);
  if(old&&(!equalArchiveResult(old,row)||old.archiveKey&&row.archiveKey&&old.archiveKey!==row.archiveKey)){
   rows.delete(row.id);conflicts.add(row.id);continue;
  }
  rows.set(row.id,old?.archiveKey&&!row.archiveKey?old:row);
 }
 for(const row of current){
  const old=rows.get(row.id);
  if(conflicts.has(row.id)){const {archiveKey:ignored,...safe}=row;rows.set(row.id,safe);}
  else rows.set(row.id,old?.archiveKey&&equalArchiveResult(old,row)?{...row,archiveKey:old.archiveKey}:row);
 }
 return {rows:[...rows.values()].sort((a,b)=>b.startedAt-a.startedAt||a.id.localeCompare(b.id)),conflicts:[...conflicts].sort()};
}
export function mergeLoadedResults(current,extra){return mergeLoadedArchive(current,extra).rows;}
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

// V3 candidate: immutable public ID primary key; composite sort key for bounded pagination.
export function archiveV3Target(address){return archiveTarget(address).replace('/publicMatchArchive/','/publicMatchArchiveV3/');}
function checkedV3Target(target){
 const u=new URL(target);if(!u.pathname.startsWith('/publicMatchArchiveV3/'))throw Error('Некорректный адрес архива V3');
 if(archiveV3Target(u.href.replace('/publicMatchArchiveV3/','/publicTeams/'))!==u.href)throw Error('Некорректный адрес архива V3');return u.href;
}
export function archiveV3Projection(row){const value=archiveProjection(row);return {...value,sortKey:archiveKey(value)};}
function checkedV3Row(raw,recordId){const row=archiveV3Projection(raw);if(row.id!==recordId||raw.sortKey!==row.sortKey)throw Error('Некорректная запись архива V3');return row;}
export function archiveV3Page(raw,options={}){
 const index=Object.create(null);
 for(const [recordId,value] of Object.entries(raw||{})){const row=checkedV3Row(value,recordId);if(Object.hasOwn(index,row.sortKey))throw Error('Дубликат результата V3');index[row.sortKey]=row;}
 const page=archivePage(index,options);return {rows:page.rows.map(({archiveKey:sortKey,...row})=>({...row,sortKey})),cursor:page.cursor};
}
export async function fetchArchiveV3Page(target,{cursor=null,limit=20,season='all',fetcher=fetch}={}){
 archivePage(null,{cursor,limit,season});const bounds=archiveSeasonBounds(season),u=new URL(checkedV3Target(target));u.searchParams.set('orderBy','"sortKey"');u.searchParams.set('limitToLast',String(limit+(cursor?2:1)));if(bounds)u.searchParams.set('startAt',JSON.stringify(bounds.start));if(cursor||bounds)u.searchParams.set('endAt',JSON.stringify(cursor||bounds.end));
 return archiveV3Page((await request(u.href,{},fetcher)).value,{cursor,limit,season});
}
function v3RecordUrl(target,recordId){if(typeof recordId!=='string'||!id.test(recordId))throw Error('Некорректный ID матча');return checkedV3Target(target).replace(/\.json$/,'/'+recordId+'.json');}
export async function readArchiveV3Version(target,recordId,fetcher=fetch){const result=await request(v3RecordUrl(target,recordId),{headers:{'X-Firebase-ETag':'true'}},fetcher);if(!result.etag)throw Error('Сервер не вернул версию записи');return {etag:result.etag,value:result.value?checkedV3Row(result.value,recordId):null};}
export async function writeArchiveV3Record(target,recordId,value,token,etag,fetcher=fetch){
 if(!token||!etag)throw Error('Требуется подтверждённая версия и авторизация');const row=value===null?null:archiveV3Projection(value);if(row&&row.id!==recordId)throw Error('ID результата нельзя менять');const u=new URL(v3RecordUrl(target,recordId));u.searchParams.set('auth',token);
 return request(u.href,{method:row?'PUT':'DELETE',headers:{'If-Match':etag,'Content-Type':'application/json'},...(row?{body:JSON.stringify(row)}:{})},fetcher);
}
export function planArchiveV3Migration(rows){const {rows:merged,conflicts}=mergeLoadedArchive([],rows);return {ready:merged.map(archiveV3Projection),conflicts};}

/** Migration preview is intentionally read-only. The source must be frozen
 * during a real migration; two scans detect many, not all, concurrent edits. */
// Remote migration records are a strict score-only contract; do not silently
// sanitize unknown nested fields when proving that a backup is complete.
function exactArchiveFields(value,fields){
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===fields.slice().sort().join('|');
}
function assertMigrationShape(value,version){
 const allowed=version===2?['id','opponent','sets','setsWon','startedAt']:['id','opponent','sets','setsWon','sortKey','startedAt'];
 if(!exactArchiveFields(value,allowed)||!exactArchiveFields(value.setsWon,['ours','theirs'])||
    !value.sets||typeof value.sets!=='object'||Object.values(value.sets).some(s=>!exactArchiveFields(s,['ours','theirs'])))
  throw Error('Некорректная запись при миграции');
}
function migrationRows(raw,version,limit){
 if(raw===null)return [];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length>limit)throw Error('Некорректная страница миграции');
 return Object.entries(raw).map(([k,value])=>{
  assertMigrationShape(value,version);
  const r=version===2?archiveProjection(value):checkedV3Row(value,k);
  if(version===2&&archiveKey(r)!==k)throw Error('Некорректная запись при миграции');
  return {...archiveV3Projection(r)};
 }).sort((a,b)=>a.sortKey<b.sortKey?1:a.sortKey>b.sortKey?-1:0);
}
async function scanMigration(target,version,fetcher,maxRecords){
 const rows=[];let previous=null;
 for(;;){
  const limit=previous?41:40,u=new URL(target);u.searchParams.set('orderBy',version===2?'"$key"':'"sortKey"');u.searchParams.set('limitToLast',String(limit));
  if(previous)u.searchParams.set('endAt',JSON.stringify(previous.sortKey));
  const page=migrationRows((await request(u.href,{},fetcher)).value,version,limit);
  if(previous){
   if(!page.length||page[0].sortKey!==previous.sortKey||!equalArchiveResult(page[0],previous))throw Error('Архив изменился во время сверки');
   page.shift();
  }
  if(!page.length)break;
  if(previous&&page.some(x=>x.sortKey>=previous.sortKey))throw Error('Некорректный курсор миграции');
  rows.push(...page);if(rows.length>maxRecords)throw Error('Превышен лимит сверки архива');
  previous=page.at(-1);
  if(page.length<40)break;
 }
 return rows;
}
function migrationPreview(source,destination){
 const p=planArchiveV3Migration(source),dest=new Map(destination.map(r=>[r.id,r])),seen=new Set(source.map(r=>r.id));
 const ready=[],identical=[],mismatches=[];
 for(const r of p.ready){
  const current=dest.get(r.id);
  if(!current)ready.push(r);
  else if(equalArchiveResult(r,current))identical.push(r.id);
  else mismatches.push(r.id);
 }
 const destinationOnly=destination.filter(r=>!seen.has(r.id)).map(r=>r.id).sort();
 return {sourceCount:source.length,destinationCount:destination.length,ready,identical:identical.sort(),sourceConflicts:p.conflicts,mismatches:mismatches.sort(),destinationOnly,requiresReview:!!(p.conflicts.length||mismatches.length||destinationOnly.length)};
}
export async function inspectArchiveV3Migration(address,{fetcher=fetch,maxRecords=5000}={}){
 if(!Number.isInteger(maxRecords)||maxRecords<1||maxRecords>5000)throw Error('Некорректный лимит сверки');
 const u=new URL(address);if(u.username||u.password)throw Error('Не передавайте секреты в адресе');
 const v2=archiveTarget(address),v3=archiveV3Target(address);
 const {source,destination}=await scanStableMigration(v2,v3,fetcher,maxRecords);
 return migrationPreview(source,destination);
}
async function scanStableMigration(v2,v3,fetcher,maxRecords){
 const source=await scanMigration(v2,2,fetcher,maxRecords),destination=await scanMigration(v3,3,fetcher,maxRecords);
 const sourceAgain=await scanMigration(v2,2,fetcher,maxRecords),destinationAgain=await scanMigration(v3,3,fetcher,maxRecords);
 if(JSON.stringify(source)!==JSON.stringify(sourceAgain)||JSON.stringify(destination)!==JSON.stringify(destinationAgain))throw Error('Архив изменился во время сверки. Повторите после остановки публикации.');
 return {source,destination};
}

// Portable score-only backup of both archive paths. Integrity, not signature:
// the checksum detects accidental corruption, not an attacker who can rewrite it.
const migrationBackupFormat='teachapp-public-archive-v3-backup-1';
async function migrationChecksum(value){
 const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
function backupRows(rows,{uniqueIds=false}={}){
 if(!Array.isArray(rows)||rows.length>5000)throw Error('Некорректный архив резервной копии');
 const ids=new Set();let previous=null;
 return rows.map(raw=>{
  assertMigrationShape(raw,3);
  const r=checkedV3Row(raw,raw.id);
  if(previous!==null&&r.sortKey>=previous||uniqueIds&&ids.has(r.id))throw Error('Нарушена уникальность или порядок резервной копии');
  previous=r.sortKey;ids.add(r.id);return r;
 });
}
/** Read-only checkpoint. A changed server generation invalidates the entire backup.
 * Does not perform a freeze, copy, deployment or cutover. */
export async function captureFrozenArchiveV3Backup(address,{fetcher=fetch,maxRecords=5000}={}){
 if(!Number.isInteger(maxRecords)||maxRecords<1||maxRecords>5000)throw Error('Некорректный лимит сверки');
 const v2=archiveTarget(address),v3=archiveV3Target(address),canonical=v2.replace('/publicMatchArchive/','/publicTeams/');
 const before=await resolveArchiveRoute(canonical,{fetcher});
 if(before.phase!=='frozen')throw Error('Для резервной копии требуется замороженный архив');
 const {source,destination}=await scanStableMigration(v2,v3,fetcher,maxRecords);
 const after=await resolveArchiveRoute(canonical,{fetcher,previous:before});
 if(after.phase!=='frozen'||after.generation!==before.generation)throw Error('Поколение миграции изменилось');
 const payload={format:migrationBackupFormat,address:canonical,generation:before.generation,source:backupRows(source),destination:backupRows(destination,{uniqueIds:true})};
 return {...payload,sha256:await migrationChecksum(payload)};
}
/** Offline integrity verification of the full two-path backup; no writes or network.
 * Reports conflicts and missing rows without claiming that cutover is safe. */
export async function verifyFrozenArchiveV3Backup(backup){
 if(!exactArchiveFields(backup,['format','address','generation','source','destination','sha256'])||
    backup.format!==migrationBackupFormat||typeof backup.address!=='string'||!Number.isInteger(backup.generation)||backup.generation<1||backup.generation>1000000||
    typeof backup.sha256!=='string'||!/^[a-f0-9]{64}$/.test(backup.sha256))throw Error('Некорректная резервная копия архива');
 const canonical=archiveTarget(backup.address).replace('/publicMatchArchive/','/publicTeams/');
 if(backup.address!==canonical)throw Error('Некорректный адрес резервной копии');
 const source=backupRows(backup.source),destination=backupRows(backup.destination,{uniqueIds:true});
 const payload={format:migrationBackupFormat,address:canonical,generation:backup.generation,source,destination};
 if(await migrationChecksum(payload)!==backup.sha256)throw Error('Контрольная сумма резервной копии не совпадает');
 return {address:canonical,generation:backup.generation,...migrationPreview(source,destination)};
}

/** Public phase is only routing metadata, readable while the parent is
 * published. Old production rules deny this path; that means legacy V2.
 * Once V3 is observed never silently downgrade on a transient denial. */
export function archiveRouteTarget(address){return archiveTarget(address).replace('/publicMatchArchive/','/archiveMigration/');}
export async function resolveArchiveRoute(address,{fetcher=fetch,previous=null}={}){
 let state;try{state=(await request(archiveRouteTarget(address),{},fetcher)).value;}
 catch(e){if(e.status!==401&&e.status!==403)throw e;if(previous?.version===3)throw Error('Не удалось подтвердить активную версию архива V3');state=null;}
 if(state!==null&&(!state||typeof state!=='object'||Array.isArray(state)||Object.keys(state).sort().join('|')!=='generation|phase'||!['legacy','frozen','v3'].includes(state.phase)||!Number.isInteger(state.generation)||state.generation<1||state.generation>1000000))throw Error('Некорректная версия архива');
 const phase=state?.phase||'legacy',generation=state?.generation||0,version=phase==='v3'?3:2;
 if(previous&&(generation<previous.generation||previous.version===3&&version!==3))throw Error('Сервер вернул устаревшую версию архива');
 return {phase,generation,version,target:version===3?archiveV3Target(address):archiveTarget(address),key:version+':'+generation};
}
const routedRow=r=>{if(!r)return null;const value=archiveProjection(r);return {...value,archiveKey:archiveKey(value)};};
export async function routedArchivePage(route,options={}){
 if(route.version!==3)return fetchArchivePage(route.target,options);
 const p=await fetchArchiveV3Page(route.target,options);return {rows:p.rows.map(routedRow),cursor:p.cursor};
}
export async function routedArchiveRecord(route,{archiveKey:legacyKey,matchId},fetcher=fetch){
 if(legacyKey!=null&&(typeof legacyKey!=='string'||!key.test(legacyKey)))throw Error('Некорректная ссылка');
 if(route.version!==3)return legacyKey?fetchArchiveRecord(route.target,legacyKey,fetcher):fetchArchiveById(route.target,matchId,fetcher);
 const recordId=legacyKey?legacyKey.slice(17):matchId;
 const r=await request(v3RecordUrl(route.target,recordId),{},fetcher);
 return r.value?routedRow(checkedV3Row(r.value,recordId)):null;
}
export function requireWritableArchive(route){if(route.phase==='frozen')throw Error('Архив временно закрыт для изменений: перенос V3');return route;}
export async function routedArchiveVersion(route,row,fetcher=fetch){
 requireWritableArchive(route);
 return route.version===3?readArchiveV3Version(route.target,row.id,fetcher):readArchiveVersion(route.target,archiveKey(row),fetcher);
}
export async function routedArchiveFind(route,row,fetcher=fetch){
 // V3 is keyed by ID: the version read already covers all dates.
 return route.version===3?null:fetchArchiveById(route.target,row.id,fetcher);
}
export async function routedArchiveWrite(route,row,value,token,etag,fetcher=fetch){
 requireWritableArchive(route);
 return route.version===3?writeArchiveV3Record(route.target,row.id,value,token,etag,fetcher):writeArchiveRecord(route.target,archiveKey(row),value,token,etag,fetcher);
}
