import test from 'node:test';import assert from 'node:assert/strict';import {archiveKey,archivePage,archiveProjection,archiveTarget,resultLink,fixtureCalendar,archiveSeasons,filterArchiveSeason,equalArchiveResult,fetchArchivePage,writeArchiveRecord,searchArchive,mergeLoadedResults,publicResultCard} from '../js/public-archive.js';import {viewerTarget} from '../js/public-portal.js';
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
