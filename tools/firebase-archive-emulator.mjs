import './firebase-portal-emulator.mjs';
import assert from 'node:assert/strict';
import {readMediaVersion,writePublicMedia,removePublicMedia,fetchPublicMedia} from '../js/public-media.js';
import {captureFrozenArchiveV3Backup,executeFrozenArchiveV3Copy,inspectArchiveV3Control,transitionArchiveV3} from '../js/public-archive.js';
const user=async()=>{const r=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:crypto.randomUUID()+'@example.test',password:crypto.randomUUID(),returnSecureToken:true})});assert.equal(r.status,200);return r.json();};
const owner=await user(),other=await user(),page='publicTeams/'+owner.localId+'/team',archive='publicMatchArchive/'+owner.localId+'/team';
async function call(method,path,value,token,expected,params={},headers={}){const u=new URL('http://127.0.0.1:9000/'+(path?path+'.json':'.json'));u.searchParams.set('ns','demo-teachapp-default-rtdb');for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);if(token&&token!=='owner')u.searchParams.set('auth',token);const r=await fetch(u,{method,headers:{...headers,...(token==='owner'?{Authorization:'Bearer owner'}:{})},...(value===undefined?{}:{body:JSON.stringify(value)})});const data=await r.json();assert.equal(r.status,expected,method+' '+path+' '+JSON.stringify(data).slice(0,200));return {data,etag:r.headers.get('ETag')};}
await call('PUT','publishers/'+owner.localId,true,'owner',200);await call('PUT',page,{schema:1,team:'Synthetic',updatedAt:1},owner.idToken,200);
const key=i=>String(1700000000000+i).padStart(16,'0')+'_r'+i,row=i=>({id:'r'+i,opponent:'Synthetic',startedAt:1700000000000+i,setsWon:{ours:1,theirs:0},sets:[{ours:25,theirs:19}]});
for(let i=0;i<45;i++)await call('PUT',archive+'/'+key(i),row(i),owner.idToken,200);
await call('GET',archive,undefined,null,401);await call('GET',archive,undefined,null,401,{orderBy:'"$key"',limitToLast:'43'});await call('GET',archive,undefined,null,401,{orderBy:'"startedAt"',limitToLast:'21'});
const first=await call('GET',archive,undefined,null,200,{orderBy:'"$key"',limitToLast:'21'});assert.equal(Object.keys(first.data).length,21);const second=await call('GET',archive,undefined,null,200,{orderBy:'"$key"',endAt:JSON.stringify(key(25)),limitToLast:'22'});assert.equal(Object.keys(second.data).length,22);
// Date-range key queries remain bounded and do not need broader read permission.
const lower=String(Date.UTC(2023,8,1)).padStart(16,'0')+'_',upper=String(Date.UTC(2024,8,1)-1).padStart(16,'0')+'_\uf8ff';
const season=await call('GET',archive,undefined,null,200,{orderBy:'"$key"',startAt:JSON.stringify(lower),endAt:JSON.stringify(upper),limitToLast:'21'});assert.equal(Object.keys(season.data).length,21);
const emptySeason=await call('GET',archive,undefined,null,200,{orderBy:'"$key"',startAt:JSON.stringify(String(Date.UTC(2022,8,1)).padStart(16,'0')+'_'),endAt:JSON.stringify(String(Date.UTC(2023,8,1)-1).padStart(16,'0')+'_\uf8ff'),limitToLast:'21'});assert.equal(emptySeason.data,null);
const exact=await call('GET',archive,undefined,null,200,{orderBy:'"id"',equalTo:'"r1"',limitToFirst:'2'});assert.equal(Object.keys(exact.data).length,1);
await call('GET',archive,undefined,null,401,{orderBy:'"id"',limitToFirst:'2'});await call('GET',archive,undefined,null,401,{orderBy:'"id"',equalTo:'"r1"',limitToFirst:'3'});
const path=archive+'/'+key(1);
await call('PUT',path,{...row(1),id:'wrong'},owner.idToken,401);await call('PUT',path,{...row(1),startedAt:1700000000002},owner.idToken,401);await call('PUT',path,{...row(1),setsWon:{ours:0,theirs:1}},owner.idToken,401);await call('PUT',path,{...row(1),sets:[{ours:25,theirs:25}]},owner.idToken,401);await call('PUT',path,{...row(1),sets:[{ours:25.5,theirs:19}]},owner.idToken,401);await call('PUT',path,{...row(1),sets:{0:{ours:25,theirs:19},2:{ours:25,theirs:19}},setsWon:{ours:2,theirs:0}},owner.idToken,401);await call('PUT',path,{...row(1),medical:'private'},owner.idToken,401);await call('PUT',path,row(1),other.idToken,401);await call('DELETE',path,undefined,null,401);
const v=await call('GET',path,undefined,null,200,{}, {'X-Firebase-ETag':'true'});assert.ok(v.etag);await call('PUT',path,{...row(1),opponent:'Changed'},owner.idToken,200,{}, {'If-Match':v.etag});await call('PUT',path,row(1),owner.idToken,412,{}, {'If-Match':v.etag});await call('DELETE',page,undefined,owner.idToken,200);await call('GET',path,undefined,null,401);await call('GET',archive,undefined,null,401,{orderBy:'"$key"',limitToLast:'21'});console.log('PASS: legacy rules, >20 records, bounded archive reads, owner-only writes, private fields denied, CAS conflict, unpublish hides archive');

await call('PUT',page,{schema:1,team:'Synthetic',updatedAt:1},owner.idToken,200);
const media='publicMedia/'+owner.localId+'/team',news={publicId:'news1',type:'announcement',title:'Synthetic announcement',body:'Synthetic text',date:'2026-11-25'},publicData={schema:1,news:[news],tournament:{name:'Synthetic tournament',system:'league',format:'score',rows:[{name:'Team A',place:1,group:0,played:1,won:1,draw:0,lost:0,points:3}],games:[{round:1,group:0,a:'Team A',b:'Team B',date:'2026-11-25',time:'10:00',venue:'Hall',status:'finished',score:'2:0'}]}};
const mv=await call('GET',media,undefined,null,200,{}, {'X-Firebase-ETag':'true'});await call('PUT',media,publicData,owner.idToken,200,{}, {'If-Match':mv.etag});await call('GET',media,undefined,null,200);await call('PUT',media,publicData,other.idToken,401);await call('PUT',media,{...publicData,news:[{...news,privateNote:'secret'}]},owner.idToken,401);await call('PUT',media,{...publicData,news:Array(21).fill(news)},owner.idToken,401);await call('PUT',media,{...publicData,tournament:{...publicData.tournament,games:[{...publicData.tournament.games[0],studentId:'secret'}]}},owner.idToken,401);await call('PUT',media,publicData,owner.idToken,412,{}, {'If-Match':mv.etag});
const mediaUrl='https://demo-teachapp-default-rtdb.firebaseio.com/'+media+'.json';
const mediaAdapter=(url,opts)=>{const u=new URL(url),local=new URL('http://127.0.0.1:9000'+u.pathname+u.search);local.searchParams.set('ns','demo-teachapp-default-rtdb');return fetch(local,opts);};
const mediaBefore=await readMediaVersion(mediaUrl,mediaAdapter,owner.idToken);assert.equal(mediaBefore.exists,true);
const mediaNext=await writePublicMedia(mediaUrl,{...publicData,news:[{...news,title:'Verified update'}]},owner.idToken,mediaBefore.etag,mediaAdapter);
assert.equal(mediaNext.value.news[0].title,'Verified update');
await assert.rejects(removePublicMedia(mediaUrl,owner.idToken,mediaBefore.etag,mediaAdapter),e=>e.status===412);
await call('PATCH','',{[page]:null,[media]:publicData},owner.idToken,401);
await call('DELETE',page,undefined,owner.idToken,200);await call('GET',media,undefined,null,401);
await call('GET',media,undefined,other.idToken,401);await call('DELETE',media,undefined,other.idToken,401);
await call('PUT',media,publicData,owner.idToken,401);
const hidden=await readMediaVersion(mediaUrl,mediaAdapter,owner.idToken);assert.equal(hidden.exists,true);assert.equal(hidden.value.news[0].title,'Verified update');
const purged=await removePublicMedia(mediaUrl,owner.idToken,hidden.etag,mediaAdapter);assert.equal(purged.exists,false);
await call('PUT',page,{schema:1,team:'Synthetic',updatedAt:1},owner.idToken,200);
assert.deepEqual(await fetchPublicMedia(mediaUrl,mediaAdapter),{schema:1,news:[]});
await call('DELETE',page,undefined,owner.idToken,200);
console.log('PASS: bounded public media, no private fields, owner-only CAS, verified hidden purge and no stale media on republish');


await call('PUT',page,{schema:1,team:'Synthetic',updatedAt:1},owner.idToken,200);
const v3='publicMatchArchiveV3/'+owner.localId+'/team',v3row=r=>({...r,sortKey:String(r.startedAt).padStart(16,'0')+'_'+r.id});
const original=v3row(row(1)),sameDate=v3row({...row(2),startedAt:row(1).startedAt});
await call('PUT',v3+'/r1',original,owner.idToken,200);await call('PUT',v3+'/r2',sameDate,owner.idToken,200);
await call('PUT',v3+'/different',original,owner.idToken,401);await call('PUT',v3+'/r1',{...original,sortKey:key(2)},owner.idToken,401);await call('PUT',v3+'/r1',{...original,private:'secret'},owner.idToken,401);await call('PUT',v3+'/r1',original,other.idToken,401);
await call('GET',v3,undefined,null,401);await call('GET',v3,undefined,null,401,{orderBy:'"sortKey"',limitToLast:'43'});const latest=await call('GET',v3,undefined,null,200,{orderBy:'"sortKey"',limitToLast:'1'});assert.deepEqual(Object.keys(latest.data),['r2']);
const current=await call('GET',v3+'/r1',undefined,null,200,{}, {'X-Firebase-ETag':'true'});assert.ok(current.etag);
const correction=delta=>v3row({...row(1),startedAt:row(1).startedAt+delta}),race=async delta=>{const u=new URL('http://127.0.0.1:9000/'+v3+'/r1.json');u.searchParams.set('ns','demo-teachapp-default-rtdb');u.searchParams.set('auth',owner.idToken);return (await fetch(u,{method:'PUT',headers:{'If-Match':current.etag,'Content-Type':'application/json'},body:JSON.stringify(correction(delta))})).status;};
assert.deepEqual((await Promise.all([race(1000),race(2000)])).sort(),[200,412]);const listed=await call('GET',v3,undefined,null,200,{orderBy:'"sortKey"',limitToLast:'42'});assert.deepEqual(Object.keys(listed.data).sort(),['r1','r2']);assert.ok([correction(1000).sortKey,correction(2000).sortKey].includes(listed.data.r1.sortKey));
await call('DELETE',page,undefined,owner.idToken,200);await call('GET',v3+'/r1',undefined,null,401);console.log('V3 PASS: immutable ID, concurrent date corrections CAS, bounded sort-key pagination, hidden on unpublish');

 // A separate synthetic portal tests a migration without modifying earlier fixtures.
const slug='migration',oldPath='publicMatchArchive/'+owner.localId+'/'+slug,newPath='publicMatchArchiveV3/'+owner.localId+'/'+slug,control='archiveMigration/'+owner.localId+'/'+slug,parent='publicTeams/'+owner.localId+'/'+slug;
await call('PUT',parent,{schema:1,team:'Synthetic Migration',updatedAt:1},owner.idToken,200);
for(let i=0;i<45;i++)await call('PUT',oldPath+'/'+key(i),row(i),owner.idToken,200);
await call('GET',control,undefined,null,200);await call('PUT',control,{phase:'frozen',generation:1},other.idToken,401);await call('PUT',control,{phase:'v3',generation:1},owner.idToken,401);
const initial=await call('GET',control,undefined,owner.idToken,200,{}, {'X-Firebase-ETag':'true'});assert.equal(initial.data,null);assert.ok(initial.etag);
await call('PATCH','',{[control]:{phase:'frozen',generation:1},[oldPath+'/'+key(0)]:{...row(0),opponent:'Changed'}},owner.idToken,401);
await call('PATCH','',{[control]:{phase:'frozen',generation:1},[newPath+'/r0']:v3row(row(0))},owner.idToken,401);
const address='https://demo-teachapp-default-rtdb.firebaseio.com/'+parent+'.json';
const adapter=(url,opts)=>{const u=new URL(url),local=new URL('http://127.0.0.1:9000'+u.pathname+u.search);local.searchParams.set('ns','demo-teachapp-default-rtdb');return fetch(local,opts);};
const controlOpts={confirmed:true,getToken:async()=>owner.idToken,fetcher:adapter};
const initialState=await inspectArchiveV3Control(address,controlOpts);assert.deepEqual(initialState,{phase:'legacy',generation:0});
assert.deepEqual(await transitionArchiveV3(address,'freeze',{...controlOpts,expected:initialState}),{phase:'frozen',generation:1});
await call('PUT',oldPath+'/'+key(1),{...row(1),opponent:'Changed'},owner.idToken,401);
await call('DELETE',oldPath+'/'+key(2),undefined,owner.idToken,401);
const marked=(i,generation)=>({...v3row(row(i)),migrationGeneration:generation});
await call('PUT',newPath+'/r1',{...marked(1,1),opponent:'Fabricated'},owner.idToken,401);
await call('PUT',newPath+'/r1',{...marked(1,1),sets:[{ours:25,theirs:1}]},owner.idToken,401);
await call('PUT',newPath+'/r1',v3row(row(1)),owner.idToken,401);
await call('PUT',newPath+'/r1',marked(1,2),owner.idToken,401);
await call('PUT',newPath+'/r1',marked(1,1),other.idToken,401);
await call('PUT',newPath+'/r1',marked(1,1),owner.idToken,200);
await call('PUT',newPath+'/r1',marked(1,1),owner.idToken,401);
// The same multi-location write may not thaw and copy using the old generation.
await call('PATCH','',{[control]:{phase:'legacy',generation:2},[newPath+'/r2']:marked(2,1)},owner.idToken,401);
await call('DELETE',newPath+'/r1',undefined,owner.idToken,401);
await call('DELETE',control,undefined,owner.idToken,401);
await call('PUT',control,{phase:'legacy',generation:1},owner.idToken,401);
const frozen=await call('GET',control,undefined,owner.idToken,200,{}, {'X-Firebase-ETag':'true'});
assert.ok(frozen.etag);assert.deepEqual(await transitionArchiveV3(address,'thaw',{...controlOpts,expected:{phase:'frozen',generation:1}}),{phase:'legacy',generation:2});
await call('PUT',newPath+'/r2',marked(2,1),owner.idToken,401);
await call('PUT',oldPath+'/'+key(0),row(0),owner.idToken,200);
assert.deepEqual(await transitionArchiveV3(address,'freeze',{...controlOpts,expected:{phase:'legacy',generation:2}}),{phase:'frozen',generation:3});
await call('PUT',newPath+'/r2',marked(2,1),owner.idToken,401);
const backup=await captureFrozenArchiveV3Backup(address,{fetcher:adapter});
await assert.rejects(transitionArchiveV3(address,'activate',{...controlOpts,expected:{phase:'frozen',generation:3},backup}),/не совпадают/);
assert.deepEqual(await inspectArchiveV3Control(address,controlOpts),{phase:'frozen',generation:3});
assert.equal(backup.source.length,45);assert.equal(backup.destination.length,1);
const opts={confirmed:true,getToken:async()=>owner.idToken,fetcher:adapter,batchLimit:20};
const firstCopy=await executeFrozenArchiveV3Copy(address,backup,opts);assert.equal(firstCopy.copied,20);assert.equal(firstCopy.remaining,24);
const secondCopy=await executeFrozenArchiveV3Copy(address,backup,{...opts,batchLimit:50});assert.equal(secondCopy.copied,24);assert.equal(secondCopy.complete,true);
const retryCopy=await executeFrozenArchiveV3Copy(address,backup,opts);assert.equal(retryCopy.copied,0);assert.equal(retryCopy.complete,true);
const migrated=[];let cursor=null;
for(;;){const page=(await call('GET',newPath,undefined,null,200,{orderBy:'"sortKey"',limitToLast:cursor?'41':'40',...(cursor?{endAt:JSON.stringify(cursor)}:{})})).data;const rows=Object.values(page||{}).sort((a,b)=>b.sortKey.localeCompare(a.sortKey));if(cursor)assert.equal(rows.shift()?.sortKey,cursor);migrated.push(...rows);if(rows.length<40)break;cursor=rows.at(-1).sortKey;}
assert.equal(migrated.length,45);for(const v of migrated){const i=Number(v.id.slice(1));assert.deepEqual(v,marked(i,i===1?1:3));}
await assert.rejects(transitionArchiveV3(address,'activate',{...controlOpts,expected:{phase:'frozen',generation:1},backup}),/Поколение/);
assert.deepEqual(await transitionArchiveV3(address,'activate',{...controlOpts,expected:{phase:'frozen',generation:3},backup}),{phase:'v3',generation:4});
await call('PUT',oldPath+'/'+key(0),row(0),owner.idToken,401);await call('PUT',control,{phase:'legacy',generation:5},owner.idToken,401);
await call('PUT',newPath+'/r999',marked(999,3),owner.idToken,401);
await call('PUT',newPath+'/r1',v3row({...row(1),opponent:'Corrected'}),owner.idToken,200);
assert.equal((await call('GET',newPath+'/r1',undefined,null,200)).data.migrationGeneration,undefined);
await call('GET',oldPath+'/'+key(1),undefined,null,401);await call('GET',oldPath,undefined,null,401,{orderBy:'"$key"',limitToLast:'40'});assert.equal((await call('GET',oldPath+'/'+key(1),undefined,owner.idToken,200)).data.opponent,'Synthetic');assert.deepEqual((await call('GET',control,undefined,null,200)).data,{phase:'v3',generation:4});
console.log('V3 MIGRATION BARRIER PASS: owner-only monotonic state, V2 freeze, exact create-only copies, 45 verified rows, pre-cutover thaw, irreversible activation and legacy owner recovery read; public stale path denied.');
