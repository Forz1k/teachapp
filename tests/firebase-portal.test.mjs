import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firebaseSignIn,firebasePublisher} from '../js/firebase-portal.js';
import * as P from '../js/public-publisher.js';
import {localDay} from '../js/public-portal.js';
const origin='https://demo-default-rtdb.europe-west1.firebasedatabase.app',apiKey='public_api_key_demo';
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
const calls=[];let server=null,revision=0;
const etag=()=>server===null?'null_etag':'rev-'+revision;
const fake=async (url,options={})=>{
 calls.push({url,method:options.method||'GET',body:options.body,headers:options.headers});
 if(url.includes('identitytoolkit.googleapis.com'))return json({localId:'owner1',idToken:'PRIVATE_TOKEN',refreshToken:'PRIVATE_REFRESH',expiresIn:'3600'});
 if(url.includes('securetoken.googleapis.com'))return json({user_id:'owner1',id_token:'NEW_PRIVATE',refresh_token:'NEW_REFRESH',expires_in:'3600'});
 if(['PUT','DELETE'].includes(options.method)){
  assert.ok(options.headers['If-Match'],'No unconditional write');
  if(options.headers['If-Match']!==etag())return json(server,412);
  server=options.method==='DELETE'?null:JSON.parse(options.body);
  if(server)server.updatedAt=Date.now();revision++;
  return json(server);
 }
 if(options.method==='PATCH')throw Error('PATCH is not conditional');
 if(options.headers?.['X-Firebase-ETag'])return new Response(JSON.stringify(server),{status:200,headers:{ETag:etag(),'Content-Type':'application/json'}});
 return json(server);
};
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Не дождались синхронизации');};
test('REST: auth защищает запись, зрительское чтение не содержит токен, 204 допустим',async()=>{
 const s=await firebaseSignIn(apiKey,'trainer@example.org','privatePassword',fake),pub=firebasePublisher(origin,'demo',s,fake);
 const initial=await pub.readVersion(),written=await pub.write({schema:1,team:'Команда',updatedAt:1},initial.etag);assert.equal(typeof server.updatedAt,'number');const write=calls.findLast(x=>x.method==='PUT');assert.match(write.url,/auth=PRIVATE_TOKEN/);assert.equal(write.body.includes('PRIVATE_TOKEN'),false);assert.deepEqual(JSON.parse(write.body).updatedAt,{'.sv':'timestamp'});
 await pub.read();assert.equal(calls.at(-1).url.includes('auth='),false);const removed=await pub.remove(written.etag);assert.equal(server,null);s.close();await assert.rejects(()=>pub.write({},removed.etag),/Войдите/);
});
test('Публикация выключена до явного согласия; расписание, live, отмена, завершение и отзыв',async()=>{
 const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const id='team_portal_test',start=new Date('2026-11-24T12:00:00Z').getTime(),day=localDay(start);
 P.saveFixture(id,{id:'fixture1',opponent:'Гости',startAt:start});
 const before=calls.length;await P.connectPortal(id,{origin,apiKey,email:'trainer@example.org',password:'privatePassword',slug:'public_team',team:'Команда'},fake);
 assert.equal(calls.slice(before).some(x=>x.method==='PUT'),false);
 assert.equal(P.portalInfo(id).data.enabled,false);P.setPortalEnabled(id,true,'Команда');await wait(()=>server?.team==='Команда');
 const players=Array.from({length:6},(_,i)=>({id:'a'+i,number:i+1,name:'PRIVATE '+i}));
 let d={id:'match1',teamId:id,date:day,mode:'dual',teamName:'Команда',opponent:'Гости',competition:'',venue:'',startedAt:new Date(start).toISOString(),ourPlayers:players,awayPlayers:[],roster:players.map(p=>p.id),lineup:players.map(p=>p.id),awayLineup:[],libero:null,scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'ours',events:[]};
 assert.equal(P.syncPortalMatch(d),true);await wait(()=>server?.match?.id==='match_'+start);
 const {detailEvent}=await import('../js/match-protocol.js');d=detailEvent(d,{type:'rally',side:'ours',kind:'kill',player:'a2'});P.syncPortalMatch(d);await wait(()=>server?.match?.score?.ours===1);
 assert.equal(server.match.events[0].number,undefined);assert.equal(JSON.stringify(server).includes('PRIVATE'),false);
 P.setPortalSettings(id,{numbers:true});P.syncPortalMatch(d);await wait(()=>server?.match?.events?.[0]?.number===3);
 d=detailEvent(d,null);P.syncPortalMatch(d);await wait(()=>server?.match?.score?.ours===0);
 // The same page must never serialize credentials to storage.
 assert.equal([...map.values()].join('').includes('privatePassword'),false);assert.equal([...map.values()].join('').includes('PRIVATE_TOKEN'),false);assert.equal([...map.values()].join('').includes('PRIVATE_REFRESH'),false);
 assert.ok(P.portalLink(id,'https://example.com/teachapp/').includes('/teachapp/live/'));
 P.syncPortalMatch(d,{discard:true});await wait(()=>!server?.match);P.setPortalEnabled(id,false,'Команда');await wait(()=>server===null);P.disconnectPortal(id);
});
test('Правила закрывают корень и требуют разрешённого владельца',()=>{
 const {rules}=JSON.parse(readFileSync(new URL('../firebase-portal.rules.json',import.meta.url),'utf8'));
 const r=rules.publicTeams.$uid.$slug;assert.equal(rules['.read'],false);assert.equal(rules['.write'],false);assert.equal(r['.read'],true);assert.match(r['.write'],/auth.uid === \$uid/);assert.match(r['.write'],/publishers/);assert.equal(r.$other['.validate'],false);assert.equal(r.match.$other['.validate'],false);assert.equal(r.match.events.$i.$other['.validate'],false);
});

test('Ручная публикация результата: только счёт, обновление без дубля, расписание, отзыв',async()=>{
 const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const id='manual_team',m={id:'private-local-match',teamId:id,date:localDay(Date.now()),opponent:'Гости',sets:[{ours:25,theirs:17},{ours:25,theirs:19}],roster:['PRIVATE'],stats:{PRIVATE:{points:8}}};
 server=null;await assert.rejects(P.publishSavedResult(id,m),/опубликуйте/);
 await P.connectPortal(id,{origin,apiKey,email:'trainer@example.org',password:'privatePassword',slug:'manual',team:'Команда'},fake);
 P.setPortalEnabled(id,true,'Команда');await wait(()=>server?.team==='Команда');
 P.saveFixture(id,{id:'fixture2',opponent:m.opponent,startAt:Date.now()});await wait(()=>server?.schedule?.length===1);
 const result=await P.publishSavedResult(id,m,{fixtureId:'fixture2'});await wait(()=>server?.archive?.length===1&&!server?.schedule?.length);
 assert.deepEqual(result.setsWon,{ours:2,theirs:0});assert.equal(JSON.stringify(server).includes('private-local-match'),false);assert.equal(JSON.stringify(server).includes('PRIVATE'),false);
 await assert.rejects(P.publishSavedResult(id,{...m,teamId:'another'}),/другой команде/);
 P.disconnectPortal(id);const corrected=await P.publishSavedResult(id,{...m,sets:[{ours:25,theirs:18}]});assert.equal(P.portalInfo(id).dirty,true);assert.equal(server.archive[0].sets.length,2);await P.connectPortal(id,{origin,apiKey,email:'trainer@example.org',password:'privatePassword',slug:'manual',team:'Команда'},fake);assert.equal(corrected.id,result.id);await wait(()=>server?.archive?.[0]?.sets?.length===1);assert.equal(server.archive.length,1);
 P.unpublishResult(id,result.id);await wait(()=>!server?.archive?.length);assert.equal(m.sets.length,2);
 P.setPortalEnabled(id,false,'Команда');await wait(()=>server===null);P.disconnectPortal(id);
});

test('two publishers cannot overwrite newer score; resolution never writes automatically',async()=>{
 server=null;
 const a=await firebaseSignIn(apiKey,'trainer@example.org','password',fake);
 const b=await firebaseSignIn(apiKey,'trainer@example.org','password',fake);
 const p=firebasePublisher(origin,'same',a,fake),q=firebasePublisher(origin,'same',b,fake);
 const old=await p.readVersion();
 const first=await p.write({schema:1,team:'Первый',updatedAt:1},old.etag);
 await assert.rejects(q.write({schema:1,team:'Устаревший',updatedAt:1},old.etag),e=>e.status===412);
 assert.equal(server.team,'Первый');
 await assert.rejects(q.remove(old.etag),e=>e.status===412);
 const confirmed=await q.write({schema:1,team:'Первый',updatedAt:1},old.etag);
 assert.equal(confirmed.etag,first.etag);
 const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const id='cas-team';
 await P.connectPortal(id,{origin,apiKey,email:'trainer@example.org',password:'password',slug:'same',team:'Первый'},fake);
 P.setPortalEnabled(id,true,'Первый');await wait(()=>!P.portalInfo(id).dirty&&server?.team==='Первый');
 const current=await q.readVersion();await q.write({schema:1,team:'Второе устройство',updatedAt:1},current.etag);
 P.setPublicTeamName(id,'Старое устройство');await wait(()=>P.portalInfo(id).conflict);
 assert.equal(server.team,'Второе устройство');
 await P.acceptRemotePortal(id);assert.equal(P.portalInfo(id).data.team,'Второе устройство');assert.equal(P.portalInfo(id).conflict,false);assert.equal(P.portalInfo(id).data.settings.auto,false);
 P.disconnectPortal(id);a.close();b.close();
});

test('cooperative LIVE handoff pauses the first device, validates the published score and refuses stale preview',async()=>{
 server=null;const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const a='handoff-a',b='handoff-b',start=Date.parse('2026-11-25T12:00:00Z'),players=Array.from({length:6},(_,i)=>({id:'a'+i,number:i+1,name:'Synthetic '+i}));
 const base={id:'local-match',teamId:a,date:localDay(start),mode:'dual',teamName:'Команда',opponent:'Гости',competition:'',venue:'',startedAt:new Date(start).toISOString(),ourPlayers:players,awayPlayers:[],roster:players.map(x=>x.id),lineup:players.map(x=>x.id),awayLineup:[],libero:null,scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'ours',events:[]};
 const credentials={origin,apiKey,email:'trainer@example.org',password:'password',slug:'handoff',team:'Команда'};
 const {detailEvent}=await import('../js/match-protocol.js');const d=detailEvent(base,{type:'rally',side:'ours',kind:'point'});
 await P.connectPortal(a,credentials,fake);P.setPortalEnabled(a,true,'Команда');P.syncPortalMatch(d,{start:true});await wait(()=>server?.match?.score.ours===1&&!P.portalInfo(a).dirty);await new Promise(r=>setTimeout(r,20));
 P.pausePortalPublisher(a);assert.equal(P.portalInfo(a).data.publisherPaused,true);
 const count=calls.filter(x=>x.method==='PUT').length;P.heartbeatPortal(a,d.id);assert.equal(P.syncPortalMatch(detailEvent(d,{type:'rally',side:'ours',kind:'point'})),false);assert.throws(()=>P.setPublicTeamName(a,'Blocked'),/приостановлена/);
 await P.connectPortal(b,credentials,fake);assert.equal(P.portalInfo(b).data.publisherPaused,true);assert.equal(calls.filter(x=>x.method==='PUT').length,count);
 const db={...d,teamId:b};await assert.rejects(P.previewPortalHandoff(b,{...base,teamId:b}),/различаются/);
 let preview=await P.previewPortalHandoff(b,db);assert.equal(preview.score.ours,1);await assert.rejects(P.continuePortalHandoff(b,db,preview.etag),/Подтвердите/);
 const session=await firebaseSignIn(apiKey,'trainer@example.org','password',fake),external=firebasePublisher(origin,'handoff',session,fake);
 const v=await external.readVersion();await external.write({...v.data,team:'Новое название'},v.etag);
 await assert.rejects(P.continuePortalHandoff(b,db,preview.etag,{confirmed:true}),/изменилась/);
 preview=await P.previewPortalHandoff(b,db);const before=calls.filter(x=>x.method==='PUT').length;await P.continuePortalHandoff(b,db,preview.etag,{confirmed:true});assert.equal(calls.filter(x=>x.method==='PUT').length,before);
 assert.equal(P.portalInfo(b).data.publisherPaused,false);assert.equal(P.portalInfo(b).data.activeId,db.id);
 P.syncPortalMatch(detailEvent(db,{type:'rally',side:'ours',kind:'point'}));await wait(()=>server?.match?.score.ours===2&&!P.portalInfo(b).dirty);
 P.disconnectPortal(a);await P.connectPortal(a,credentials,fake);assert.equal(P.portalInfo(a).data.publisherPaused,true);P.heartbeatPortal(a,d.id);assert.equal(server.match.score.ours,2);P.disconnectPortal(a);P.disconnectPortal(b);session.close();
});

test('persistent pause marker prevents stale local publisher from sending after a pause in another tab',async()=>{server=null;const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};const id='cross-tab-pause';await P.connectPortal(id,{origin,apiKey,email:'trainer@example.org',password:'password',slug:'pause',team:'Команда'},fake);P.setPortalEnabled(id,true,'Команда');await wait(()=>server?.team==='Команда'&&!P.portalInfo(id).dirty);map.set('teachapp:portal-paused:'+id,'1');assert.equal(P.portalInfo(id).data.publisherPaused,true);assert.throws(()=>P.setPublicTeamName(id,'Blocked'),/приостановлена/);assert.equal(server.team,'Команда');P.disconnectPortal(id);});

test('Opt-in archive queue survives disconnection, never overwrites conflicts, and retries idempotently',async()=>{
 server=null;const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const id='archive-queue-test',credentials={origin,apiKey,email:'trainer@example.org',password:'password',slug:'queue',team:'Команда'},records=new Map();let archiveWrites=0;
 const fetcher=async(url,opt={})=>{
  if(url.includes('/archiveMigration/'))return json(null,401);
  if(!url.includes('/publicMatchArchive/'))return fake(url,opt);
  const u=new URL(url),k=u.pathname.split('/').at(-1).replace(/\.json$/,'');
  if(u.searchParams.has('equalTo'))return json(Object.fromEntries([...records].filter(([,r])=>r.id===JSON.parse(u.searchParams.get('equalTo')))));
  if(opt.method==='PUT'){if(opt.headers['If-Match']!==(records.has(k)?'present':'empty'))return json(null,412);archiveWrites++;records.set(k,JSON.parse(opt.body));return json(records.get(k));}
  return new Response(JSON.stringify(records.get(k)||null),{headers:{ETag:records.has(k)?'present':'empty'}});
 };
 await P.connectPortal(id,credentials,fetcher);P.setPortalEnabled(id,true,'Команда');await wait(()=>!P.portalInfo(id).dirty&&P.portalInfo(id).status.startsWith('Опубликовано'));
 const match={id:'private_id',teamId:id,date:'2025-11-01',opponent:'Гости',sets:[{ours:25,theirs:20}],privateNote:'secret'};
 await P.publishSavedResult(id,match);await wait(()=>!P.portalInfo(id).dirty&&P.portalInfo(id).status.startsWith('Опубликовано'));assert.equal(P.portalInfo(id).data.archivePending.length,0);
 P.setPortalSettings(id,{permanent:true});await wait(()=>!P.portalInfo(id).dirty&&P.portalInfo(id).status.startsWith('Опубликовано'));
 P.disconnectPortal(id);const result=await P.publishSavedResult(id,match);assert.equal(P.portalInfo(id).data.archivePending.length,1);assert.equal([...map.values()].join('').includes('privateNote'),false);
 await P.connectPortal(id,credentials,fetcher);await wait(()=>!P.portalInfo(id).dirty&&P.portalInfo(id).status.startsWith('Опубликовано'));
 const cancelled=await P.sendPendingArchive(id,{confirm:()=>false,fetcher});assert.equal(cancelled.cancelled,true);assert.equal(archiveWrites,0);
 const key=String(result.startedAt).padStart(16,'0')+'_'+result.id;records.set(key,{...result,opponent:'Other'});
 const conflict=await P.sendPendingArchive(id,{confirm:()=>true,fetcher});assert.equal(conflict.conflicts,1);assert.equal(archiveWrites,0);assert.equal(P.portalInfo(id).data.archivePending.length,1);
 records.delete(key);const sent=await P.sendPendingArchive(id,{confirm:()=>true,fetcher});assert.equal(sent.copied,1);assert.equal(archiveWrites,1);assert.equal(P.portalInfo(id).data.archivePending.length,0);
 await P.publishSavedResult(id,match);await wait(()=>!P.portalInfo(id).dirty&&P.portalInfo(id).status.startsWith('Опубликовано'));const retry=await P.sendPendingArchive(id,{confirm:()=>true,fetcher});assert.equal(retry.existing,1);assert.equal(archiveWrites,1);
 P.disconnectPortal(id);
});

test('all archive mutations share one in-tab lock, cancellation and failure release it',async()=>{
 const P=await import('../js/public-publisher.js'),previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),data=new Map();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),key:i=>[...data.keys()][i],get length(){return data.size;}}});
 const id='archive-mutex-58',row={id:'result_mutex',opponent:'Synthetic',startedAt:1700000000000,setsWon:{ours:1,theirs:0},sets:[{ours:25,theirs:21}]};
 const origin='https://demo.firebaseio.com',parent={schema:1,team:'Synthetic',updatedAt:1,schedule:[],archive:[]};
 let publicData=parent,etag='"parent"',ready;
 const fetcher=async(url,opt={})=>{
  if(url.includes('identitytoolkit'))return new Response(JSON.stringify({localId:'owner',idToken:'token',refreshToken:'refresh',expiresIn:3600}));
  if(url.includes('/publicTeams/')){
   if(opt.method==='PUT'){publicData={...JSON.parse(opt.body),updatedAt:1};}
   return new Response(JSON.stringify(publicData),{headers:{ETag:etag}});
  }
  if(url.includes('orderBy='))return new Response('null');
  return new Response('null',{headers:{ETag:'"empty"'}});
 };
 data.set('teachapp:public-portal:'+id,JSON.stringify({origin,owner:'owner',slug:'slug',team:'Synthetic',enabled:true,confirmedEtag:etag}));
 try{
  await P.connectPortal(id,{origin,apiKey:'synthetic-key',email:'synthetic@example.test',password:'x',team:'Synthetic'},fetcher);
  for(let i=0;i<20&&P.portalInfo(id).dirty;i++)await new Promise(r=>setTimeout(r,5));
  // Allow the parent CAS loop to finish before starting archive operations.
  await new Promise(r=>setTimeout(r,20));
  const started=new Promise(r=>ready=r);let cancel;
  const pending=P.publishExtendedResult(id,row,{fetcher,confirm:()=>{ready();return new Promise(r=>cancel=r);}});
  await started;assert.equal(P.portalInfo(id).archiveSending,true);
  await assert.rejects(P.removeExtendedResult(id,row,{fetcher}),/операцию архива/);
  await assert.rejects(P.migrateExtendedArchive(id,{fetcher}),/операцию архива/);
  await assert.rejects(P.sendPendingArchive(id,{fetcher}),/операцию архива/);
  cancel(false);assert.equal(await pending,false);assert.equal(P.portalInfo(id).archiveSending,false);
  await assert.rejects(P.publishExtendedResult(id,row,{fetcher,confirm:()=>{throw Error('cancelled-error');}}),/cancelled-error/);
  assert.equal(P.portalInfo(id).archiveSending,false);
  assert.equal(await P.publishExtendedResult(id,row,{fetcher,confirm:()=>false}),false);
 }finally{P.disconnectPortal(id);if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;}
});
