import test from 'node:test';import assert from 'node:assert/strict';import {archiveKey,archivePage,fetchArchiveById,queueArchiveResult,archiveMatchSummary,opponentHistory,archiveSeasonBounds,archiveProjection,archiveTarget,resultLink,fixtureCalendar,archiveSeasons,filterArchiveSeason,equalArchiveResult,fetchArchivePage,writeArchiveRecord,searchArchive,mergeLoadedResults,publicResultCard} from '../js/public-archive.js';import {viewerTarget} from '../js/public-portal.js';
const row=i=>({id:'r'+i,opponent:'Гости',startedAt:1700000000000+i,setsWon:{ours:1,theirs:0},sets:[{ours:25,theirs:20}],private:'secret'});
test('archive uses score-only data, stable cursor and pages beyond 20',()=>{const raw=Object.fromEntries(Array.from({length:45},(_,i)=>[archiveKey(row(i)),row(i)]));const a=archivePage(raw),b=archivePage(raw,{cursor:a.cursor}),c=archivePage(raw,{cursor:b.cursor});assert.equal(a.rows.length,20);assert.equal(b.rows.length,20);assert.equal(c.rows.length,5);assert.equal(c.cursor,null);assert.equal(new Set([...a.rows,...b.rows,...c.rows].map(x=>x.id)).size,45);assert.equal(Object.hasOwn(archiveProjection(row(1)),'private'),false);assert.throws(()=>archiveProjection({...row(1),setsWon:{ours:0,theirs:1}}));});
test('archive URL and public deep link preserve canonical target',()=>{const t=viewerTarget('https://example.com/live/');const u=resultLink(t.share,{...row(1),archiveKey:archiveKey(row(1))});assert.equal(new URL(viewerTarget(u).share).searchParams.get('archive'),archiveKey(row(1)));assert.match(archiveTarget(t.address),/publicMatchArchive/);});
test('calendar does not invent end time or allow newline injection',()=>{const x=fixtureCalendar('Команда\nBEGIN:VEVENT',{id:'a',opponent:'Гости',startAt:1700000000000});assert.equal(x.split('BEGIN:VEVENT').length,3);assert.ok(!x.includes('\r\nBEGIN:VEVENT\r\nBEGIN:VEVENT'));assert.ok(!x.includes('DTEND'));});

test('sport season boundaries and filter are stable across device timezones',()=>{const rows=[{startedAt:Date.parse('2026-08-31T23:59:59Z')},{startedAt:Date.parse('2026-09-01T00:00:00Z')},{startedAt:Date.parse('2027-08-31T23:59:59Z')}];assert.deepEqual(archiveSeasons(rows),[2026,2025]);assert.deepEqual(filterArchiveSeason(rows,'2026'),rows.slice(1));assert.deepEqual(filterArchiveSeason(rows,'all'),rows);});
test('archive comparison ignores private fields but rejects changed score',()=>{assert.equal(equalArchiveResult(row(1),{...row(1),private:'different'}),true);assert.equal(equalArchiveResult(row(1),{...row(1),sets:[{ours:25,theirs:19}]}),false);assert.throws(()=>archiveProjection({...row(1),id:undefined}));});
test('archive deletion uses conditional authenticated write and surfaces conflicts',async()=>{const target=archiveTarget(viewerTarget('https://example.com/live/').address),r=row(1);await assert.rejects(writeArchiveRecord(target,archiveKey(r),null,'synthetic','old',async(url,opt)=>{assert.equal(opt.method,'DELETE');assert.equal(opt.headers['If-Match'],'old');assert.equal(opt.referrerPolicy,'no-referrer');assert.equal(new URL(url).searchParams.get('auth'),'synthetic');return new Response('{}',{status:412});}),e=>e.status===412);});

test('Loaded archive search combines normalized opponent terms with season and outcome without mutating source',()=>{
 const a={...row(1),opponent:'Лицей № 102',startedAt:Date.parse('2026-10-01T10:00:00Z')},b={...a,id:'b',opponent:'Гимназия № 102',setsWon:{ours:0,theirs:1},sets:[{ours:15,theirs:25}]},c={...a,id:'c',opponent:'Орёл Лицей',startedAt:Date.parse('2025-10-01T10:00:00Z')};
 const rows=[a,b,c],before=structuredClone(rows);
 assert.deepEqual(searchArchive(rows,{query:'102   ЛИЦЕЙ',season:'2026',outcome:'win'}),[a]);
 assert.deepEqual(searchArchive(rows,{query:'орел'}),[c]);assert.deepEqual(searchArchive(rows,{query:'2026'}),[]);
 assert.deepEqual(searchArchive(rows,{outcome:'loss'}),[b]);assert.deepEqual(rows,before);
});
test('Current score takes precedence over stale archive and only identical public projections preserve deep link',()=>{
 const r=row(1),old={...r,archiveKey:archiveKey(r)},changed={...r,sets:[{ours:25,theirs:19}]};
 assert.deepEqual(mergeLoadedResults([r],[old]),[{...r,archiveKey:old.archiveKey}]);
 assert.deepEqual(mergeLoadedResults([changed],[old]),[changed]);
 assert.equal(mergeLoadedResults([r],[old,row(2)]).length,2);
});
test('Spectator result card rejects incomplete/inconsistent results and projects public score fields only',()=>{
 const model=publicResultCard('Наши',{...row(1),roster:['PRIVATE'],stats:[{name:'SECRET'}]});
 assert.equal(model.score,'1 : 0');assert.match(model.details,/25:20/);assert.ok(!JSON.stringify(model).includes('PRIVATE'));assert.ok(!JSON.stringify(model).includes('SECRET'));
 assert.throws(()=>publicResultCard('Наши',{...row(1),sets:[]}));
 assert.throws(()=>publicResultCard('Наши',{...row(1),setsWon:{ours:2,theirs:0}}));
});

test('Multi-term archive search matches word prefixes rather than letters inside an already matched word',()=>{const a={...row(1),opponent:'Победа А'},b={...row(2),opponent:'Победа Б'};assert.deepEqual(searchArchive([a,b],{query:'победа б'}),[b]);assert.deepEqual(searchArchive([a,b],{query:'обеда'}),[a,b]);});

test('Season-bounded archive pagination reaches old seasons directly and rejects foreign cursors',async()=>{
 const at=(i,t)=>({...row(i),startedAt:Date.parse(t)}),before=at(90,'2024-08-31T23:59:59.999Z'),first=at(91,'2024-09-01T00:00:00.000Z'),last=at(92,'2025-08-31T23:59:59.999Z'),after=at(93,'2025-09-01T00:00:00.000Z');
 const raw=Object.fromEntries([before,first,last,after].map(r=>[archiveKey(r),r]));
 const bounds=archiveSeasonBounds('2024');const target=archiveTarget(viewerTarget('https://example.com/live/').address);
 let calls=0;
 const fetcher=async url=>{calls++;const q=new URL(url).searchParams;assert.equal(q.get('orderBy'),'"$key"');assert.equal(JSON.parse(q.get('startAt')),bounds.start);assert.equal(JSON.parse(q.get('endAt')),calls===1?bounds.end:archiveKey(last));assert.equal(q.get('limitToLast'),calls===1?'2':'3');return new Response(JSON.stringify(raw));};
 const page=await fetchArchivePage(target,{season:'2024',limit:1,fetcher});assert.deepEqual(page.rows.map(r=>r.id),[last.id]);assert.equal(page.cursor,archiveKey(last));
 const next=await fetchArchivePage(target,{season:'2024',cursor:page.cursor,limit:1,fetcher});assert.deepEqual(next.rows.map(r=>r.id),[first.id]);assert.equal(next.cursor,null);
 assert.throws(()=>archivePage(raw,{season:'2024',cursor:archiveKey(after)}));assert.throws(()=>archiveSeasonBounds('2024.5'));assert.throws(()=>archiveSeasonBounds('1969'));assert.throws(()=>archiveSeasonBounds('9999'));assert.equal(archiveSeasonBounds('all'),null);
 assert.deepEqual(archivePage(raw,{season:'2022'}),{rows:[],cursor:null});
});

test('Archived historical details and opponents use exact scores and ignore duplicate IDs and private fields',()=>{
 const a={...row(1),opponent:'Орёл',sets:[{ours:25,theirs:19},{ours:20,theirs:25},{ours:15,theirs:10}],setsWon:{ours:2,theirs:1}},b={...row(2),opponent:'орел',sets:[{ours:21,theirs:25}],setsWon:{ours:0,theirs:1}};
 const s=archiveMatchSummary(a);assert.deepEqual(s.points,{ours:60,theirs:54});assert.equal(s.margin,6);assert.deepEqual(s.sets.map(x=>x.margin),[6,-5,5]);
 const groups=opponentHistory([a,b,a]);assert.equal(groups.length,1);assert.equal(groups[0].played,2);assert.equal(groups[0].win,1);assert.equal(groups[0].loss,1);assert.deepEqual(groups[0].points,{ours:81,theirs:79});assert.equal(JSON.stringify(groups).includes('secret'),false);
 assert.throws(()=>archiveProjection({...a,sets:{0:a.sets[0],2:a.sets[2]}}));
 const queue=queueArchiveResult(queueArchiveResult([],a),{...a,opponent:'Corrected'});assert.equal(queue.length,1);assert.equal(queue[0].opponent,'Corrected');assert.equal(Object.hasOwn(queue[0],'private'),false);
});
test('Legacy opaque link resolution requests exactly one ID and refuses ambiguity',async()=>{
 const target=archiveTarget(viewerTarget('https://example.com/live/').address),r=row(1),k=archiveKey(r);
 const got=await fetchArchiveById(target,r.id,async url=>{const q=new URL(url).searchParams;assert.equal(q.get('orderBy'),'"id"');assert.equal(q.get('equalTo'),JSON.stringify(r.id));assert.equal(q.get('limitToFirst'),'2');return new Response(JSON.stringify({[k]:r}));});
 assert.equal(got.archiveKey,k);assert.equal(await fetchArchiveById(target,r.id,async()=>new Response('null')),null);
 await assert.rejects(fetchArchiveById(target,r.id,async()=>new Response(JSON.stringify({[k]:r,other:r}))),/Несколько/);
});

test('Calendar exports stable UID, escapes CR and LF, and folds Unicode at 75 octets',()=>{
 const fixture={id:'fixture_1',opponent:'Гости',startAt:1700000000000};
 const text=fixtureCalendar('Команда\rX-FAKE:1\n'+ '🏐'.repeat(60),fixture);
 const next=fixtureCalendar('Команда',{...fixture,startAt:fixture.startAt+3600000});
 const unfold=s=>s.replace(/\r\n /g,'');
 assert.equal(unfold(text).match(/^UID:(.*)$/m)[1],next.match(/^UID:(.*)$/m)[1]);
 assert.match(unfold(text),/Команда\\nX-FAKE:1\\n/);
 assert.ok(!text.includes('\rX-FAKE:1'));
 assert.ok(text.split('\r\n').every(line=>new TextEncoder().encode(line).length<=75));
 assert.ok(unfold(text).includes('🏐'.repeat(60)));
 assert.notEqual(text.match(/^DTSTART:(.*)$/m)[1],next.match(/^DTSTART:(.*)$/m)[1]);
 for(const f of [{...fixture,id:'bad\r\nUID:fake'},{...fixture,startAt:null},{...fixture,startAt:Infinity}])assert.throws(()=>fixtureCalendar('Команда',f));
});

test('Conflicting archive IDs are not silently chosen; current publication wins without an ambiguous link',async()=>{
 const {mergeLoadedArchive}=await import('../js/public-archive.js');
 const a=row(1),b={...a,startedAt:a.startedAt+1000};
 const old={...a,archiveKey:archiveKey(a)},changed={...b,archiveKey:archiveKey(b)};
 assert.deepEqual(mergeLoadedArchive([], [old,changed]),{rows:[],conflicts:[a.id]});
 assert.deepEqual(mergeLoadedArchive([], [old,old]),{rows:[old],conflicts:[]});
 assert.deepEqual(mergeLoadedArchive([a],[old,changed]),{rows:[a],conflicts:[a.id]});
 assert.equal(mergeLoadedArchive([],[changed,old,row(2)]).rows.length,1);
});

import {archiveV3Target,archiveV3Projection,archiveV3Page,fetchArchiveV3Page,readArchiveV3Version,writeArchiveV3Record,planArchiveV3Migration} from '../js/public-archive.js';
test('V3 uses immutable ID and unique sort key with bounded pagination',async()=>{const target=archiveV3Target(viewerTarget('https://example.com/live/').address),a=row(1),b={...row(2),startedAt:a.startedAt},raw=Object.fromEntries([a,b].map(r=>[r.id,archiveV3Projection(r)]));const one=archiveV3Page(raw,{limit:1});assert.equal(one.rows[0].id,b.id);assert.equal(archiveV3Page(raw,{limit:1,cursor:one.cursor}).rows[0].id,a.id);assert.throws(()=>archiveV3Page({wrong:raw[a.id]}));assert.throws(()=>archiveV3Page({[a.id]:{...raw[a.id],sortKey:'bad'}}));const out=await fetchArchiveV3Page(target,{limit:1,fetcher:async url=>{const q=new URL(url).searchParams;assert.equal(q.get('orderBy'),'"sortKey"');assert.equal(q.get('limitToLast'),'2');return new Response(JSON.stringify(raw));}});assert.deepEqual(out,one);const old=await readArchiveV3Version(target,a.id,async url=>{assert.ok(url.endsWith('/'+a.id+'.json'));return new Response(JSON.stringify(raw[a.id]),{headers:{ETag:'v1'}});});assert.equal(old.etag,'v1');await assert.rejects(writeArchiveV3Record(target,a.id,{...a,startedAt:a.startedAt+100},'synthetic',old.etag,async(url,opt)=>{assert.equal(new URL(url).pathname.split('/').at(-1),a.id+'.json');assert.equal(opt.headers['If-Match'],'v1');assert.equal(JSON.parse(opt.body).sortKey,archiveKey({...a,startedAt:a.startedAt+100}));return new Response('{}',{status:412});}),e=>e.status===412);await assert.rejects(writeArchiveV3Record(target,a.id,b,'synthetic','v1'),/ID/);const migration=planArchiveV3Migration([a,{...a,startedAt:a.startedAt+1},b]);assert.deepEqual(migration.conflicts,[a.id]);assert.equal(migration.ready[0].id,b.id);});

import {inspectArchiveV3Migration} from '../js/public-archive.js';
function migrationFetcher(source,dest){
 return async(url,opt)=>{
  assert.ok(!opt.method||opt.method==='GET');const u=new URL(url),isV3=u.pathname.includes('publicMatchArchiveV3'),rows=isV3?dest:source,q=u.searchParams,limit=Number(q.get('limitToLast')),end=q.has('endAt')?JSON.parse(q.get('endAt')):null;
  assert.ok(limit<=41);assert.equal(q.get('orderBy'),isV3?'"sortKey"':'"$key"');
  const selected=rows.map(archiveV3Projection).filter(r=>!end||r.sortKey<=end).sort((a,b)=>a.sortKey<b.sortKey?-1:a.sortKey>b.sortKey?1:0).slice(-limit);
  return new Response(JSON.stringify(selected.length?Object.fromEntries(selected.map(r=>{const {sortKey,...v}=r;return [isV3?r.id:sortKey,isV3?r:v];})):null));
 };
}
test('V3 migration preview scans all pages twice, reports conflicts and never writes',async()=>{
 const address=viewerTarget('https://example.com/live/').address,source=Array.from({length:45},(_,i)=>row(i)),duplicate={...row(1),startedAt:row(1).startedAt+5000},dest=[row(2),{...row(3),opponent:'Changed'},row(100)];
 const p=await inspectArchiveV3Migration(address,{fetcher:migrationFetcher([...source,duplicate],dest)});
 assert.equal(p.sourceCount,46);assert.equal(p.destinationCount,3);assert.deepEqual(p.sourceConflicts,['r1']);assert.deepEqual(p.identical,['r2']);assert.deepEqual(p.mismatches,['r3']);assert.deepEqual(p.destinationOnly,['r100']);assert.equal(p.ready.length,42);assert.equal(p.requiresReview,true);
 assert.ok(p.ready.every(r=>!Object.hasOwn(r,'private')));await assert.rejects(inspectArchiveV3Migration(address,{fetcher:migrationFetcher(source,dest),maxRecords:40}),/лимит/);
 const clean=await inspectArchiveV3Migration(address,{fetcher:migrationFetcher([],[])});assert.equal(clean.requiresReview,false);assert.equal(clean.sourceCount,0);
});
test('Migration refuses unstable data and corrupt key rather than silently skipping records',async()=>{
 const address=viewerTarget('https://example.com/live/').address;let visits=0;
 const fetcher=async(url,opt)=>{const v3=new URL(url).pathname.includes('publicMatchArchiveV3');if(!v3)visits++;return migrationFetcher([row(visits)],[])(url,opt);};
 await assert.rejects(inspectArchiveV3Migration(address,{fetcher}),/изменился/);
 const broken=async()=>new Response(JSON.stringify({bad:archiveProjection(row(1))}));await assert.rejects(inspectArchiveV3Migration(address,{fetcher:broken}),/Некорректная запись/);
});

import {resolveArchiveRoute,routedArchivePage,routedArchiveRecord,routedArchiveVersion,routedArchiveWrite,requireWritableArchive} from '../js/public-archive.js';
test('Route mode preserves old URLs across date corrections, never leaks stale V2 after V3 deletion',async()=>{
 const address=viewerTarget('https://example.com/live/').address,a=row(1),corrected={...a,startedAt:a.startedAt+5000,opponent:'Corrected'},v3=archiveV3Projection(corrected),calls=[];
 const fetcher=async(url,opt)=>{calls.push({url,opt});const u=new URL(url);if(u.pathname.includes('/archiveMigration/'))return new Response(JSON.stringify({phase:'v3',generation:2}));if(u.pathname.includes('/publicMatchArchiveV3/'))return new Response(JSON.stringify(u.pathname.endsWith('/r1.json')?v3:{r1:v3}),{headers:{ETag:'v3'}});throw Error('V2 must not be read');};
 const route=await resolveArchiveRoute(address,{fetcher});assert.equal(route.version,3);assert.equal(route.key,'3:2');
 const page=await routedArchivePage(route,{fetcher});assert.equal(page.rows[0].archiveKey,archiveKey(corrected));
 const old=await routedArchiveRecord(route,{archiveKey:archiveKey(a)},fetcher);assert.equal(old.opponent,'Corrected');assert.equal(old.startedAt,corrected.startedAt);
 assert.equal((await routedArchiveVersion(route,a,fetcher)).value.startedAt,corrected.startedAt);
 await routedArchiveWrite(route,a,corrected,'token','v3',async(url,opt)=>{assert.match(new URL(url).pathname,/publicMatchArchiveV3\/.*\/r1\.json$/);assert.equal(opt.headers['If-Match'],'v3');return new Response('{}');});
 assert.equal(await routedArchiveRecord(route,{archiveKey:archiveKey(a)},async()=>new Response('null')),null);
 await assert.rejects(resolveArchiveRoute(address,{previous:route,fetcher:async()=>new Response('{}',{status:401})}),/подтвердить/);
 const legacy=await resolveArchiveRoute(address,{fetcher:async()=>new Response('{}',{status:401})});assert.equal(legacy.version,2);
 const frozen=await resolveArchiveRoute(address,{fetcher:async()=>new Response(JSON.stringify({phase:'frozen',generation:1}))});assert.throws(()=>requireWritableArchive(frozen),/перенос/);await assert.rejects(routedArchiveVersion(frozen,a,async()=>{throw Error('must not call');}),/перенос/);
 assert.ok(calls.every(x=>!x.url.includes('/publicMatchArchive/')));
});

import {captureFrozenArchiveV3Backup,verifyFrozenArchiveV3Backup} from '../js/public-archive.js';
test('Frozen V3 backup covers both complete paths, verifies offline and rejects altered scores',async()=>{
 const address=viewerTarget('https://example.com/live/').address,source=Array.from({length:45},(_,i)=>row(i)),destination=source.slice(0,40);
 const fetcher=async(url,opt)=>{
  assert.ok(!opt.method||opt.method==='GET');
  if(new URL(url).pathname.includes('/archiveMigration/'))return new Response(JSON.stringify({phase:'frozen',generation:3}));
  return migrationFetcher(source,destination)(url,opt);
 };
 const backup=await captureFrozenArchiveV3Backup(address,{fetcher});
 assert.equal(backup.source.length,45);assert.equal(backup.destination.length,40);assert.match(backup.sha256,/^[a-f0-9]{64}$/);
 const report=await verifyFrozenArchiveV3Backup(JSON.parse(JSON.stringify(backup)));
 assert.equal(report.generation,3);assert.equal(report.ready.length,5);assert.equal(report.identical.length,40);assert.equal(report.requiresReview,false);
 const altered=structuredClone(backup);altered.source[0].opponent='Changed';
 await assert.rejects(verifyFrozenArchiveV3Backup(altered),/сумма/);
 const nested=structuredClone(backup);nested.source[0].sets[0].private='not-public';
 await assert.rejects(verifyFrozenArchiveV3Backup(nested),/Некорректная запись/);
 const reordered=structuredClone(backup);reordered.source.reverse();
 await assert.rejects(verifyFrozenArchiveV3Backup(reordered),/порядок/);
});
test('Frozen archive backup refuses non-frozen state, changed generation and unknown nested remote fields',async()=>{
 const address=viewerTarget('https://example.com/live/').address;
 await assert.rejects(captureFrozenArchiveV3Backup(address,{fetcher:async()=>new Response(JSON.stringify({phase:'legacy',generation:1}))}),/замороженный/);
 let controls=0;
 const changed=async(url,opt)=>new URL(url).pathname.includes('/archiveMigration/')?new Response(JSON.stringify({phase:'frozen',generation:++controls})):migrationFetcher([row(1)],[])(url,opt);
 await assert.rejects(captureFrozenArchiveV3Backup(address,{fetcher:changed}),/Поколение/);
 const a=archiveProjection(row(1));a.sets[0].private='not-public';
 const bad=async()=>new Response(JSON.stringify({[archiveKey(a)]:a}));
 await assert.rejects(inspectArchiveV3Migration(address,{fetcher:bad}),/Некорректная запись/);
});

import {prepareFrozenArchiveV3Copy} from '../js/public-archive.js';
test('V3 copy preflight verifies saved source and allows exact resumed copies without writing',async()=>{
 const address=viewerTarget('https://example.com/live/').address,source=Array.from({length:45},(_,i)=>row(i));
 let generation=7,dest=source.slice(0,40),calls=0;
 const fetcher=async(url,opt)=>{
  calls++;assert.ok(!opt.method||opt.method==='GET');
  if(new URL(url).pathname.includes('/archiveMigration/'))return new Response(JSON.stringify({phase:'frozen',generation}));
  return migrationFetcher(source,dest)(url,opt);
 };
 const backup=await captureFrozenArchiveV3Backup(address,{fetcher});
 dest=source.slice(0,43);
 const plan=await prepareFrozenArchiveV3Copy(address,backup,{fetcher});
 assert.equal(plan.generation,7);assert.equal(plan.backupSha256,backup.sha256);assert.equal(plan.ready.length,2);assert.equal(plan.identical.length,43);assert.equal(plan.complete,false);
 dest=source.slice();assert.equal((await prepareFrozenArchiveV3Copy(address,backup,{fetcher})).complete,true);
 const before=calls;const other=address.replace(/\/[^/]+\.json$/,'/other-team.json');
 await assert.rejects(prepareFrozenArchiveV3Copy(other,backup,{fetcher}),/другому порталу/);assert.equal(calls,before);
 generation++;await assert.rejects(prepareFrozenArchiveV3Copy(address,backup,{fetcher}),/Поколение/);
 generation--;dest=source.slice(1);await assert.rejects(prepareFrozenArchiveV3Copy(address,backup,{fetcher}),/Целевой архив/);
 dest=source.slice();source[44]={...source[44],opponent:'Changed'};
 await assert.rejects(prepareFrozenArchiveV3Copy(address,backup,{fetcher}),/Исходный архив/);
});
test('V3 copy preflight rejects destination conflicts and corrupt backup before any network call',async()=>{
 const address=viewerTarget('https://example.com/live/').address,source=[row(1),row(2)];let dest=[row(1)],calls=0;
 const fetcher=async(url,opt)=>{
  calls++;assert.ok(!opt.method||opt.method==='GET');
  if(new URL(url).pathname.includes('/archiveMigration/'))return new Response(JSON.stringify({phase:'frozen',generation:1}));
  return migrationFetcher(source,dest)(url,opt);
 };
 const backup=await captureFrozenArchiveV3Backup(address,{fetcher}),bad=structuredClone(backup);bad.sha256='0'.repeat(64);
 const before=calls;await assert.rejects(prepareFrozenArchiveV3Copy(address,bad,{fetcher}),/сумма/);assert.equal(calls,before);
 dest=[row(1),row(99)];await assert.rejects(prepareFrozenArchiveV3Copy(address,backup,{fetcher}),/конфликты/);
 dest=[{...row(1),opponent:'Changed'}];await assert.rejects(prepareFrozenArchiveV3Copy(address,backup,{fetcher}),/конфликты/);
});
