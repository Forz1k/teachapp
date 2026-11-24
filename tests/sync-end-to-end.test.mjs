import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as db from '../js/db.js';
import * as S from '../js/store.js';
import {defaultSettings} from '../js/model.js';
import {relayClient,normalizeEndpoint,prepareSync,previewSync,executeSync,projectScope,combineScope,syncStatus,disconnectSync} from '../js/sync.js';
import {createRelay} from '../server/sync-relay.mjs';

const tokenA='A'.repeat(43),tokenB='B'.repeat(43),coachToken='C'.repeat(43);
const password='synthetic-test-password-only';
const empty=()=>Object.fromEntries(Object.keys(db.SCHEMA).map(n=>[n,[]]));
const settings=theme=>({...defaultSettings(),theme});
test('end to end: two independent databases, explicit conflicts, deletion, isolation, replay and authorization',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'teachapp-relay-test-'));
 const server=await createRelay({directory,tokens:{school:[tokenA,tokenB],coach:[coachToken]},allowedOrigin:'https://test.example'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint='http://127.0.0.1:'+server.address().port;
 const A=relayClient(endpoint,'school',tokenA),B=relayClient(endpoint,'school',tokenB);
 const prepare=(client,pw=password)=>prepareSync({area:'school',endpoint,password:pw,client});
 const sync=async(client,choices={})=>executeSync({plan:await prepare(client),choices,password,client,confirmed:true});
 try{
  assert.throws(()=>normalizeEndpoint('http://public.example'));
  assert.throws(()=>normalizeEndpoint('https://name:secret@example.org'));
  assert.equal((await fetch(endpoint+'/v1/snapshot/school')).status,401);
  assert.equal((await fetch(endpoint+'/v1/snapshot/coach',{headers:{Authorization:'Bearer '+tokenA}})).status,401);
  assert.equal((await fetch(endpoint+'/v1/snapshot/school',{headers:{Authorization:'Bearer '+tokenA,Origin:'https://wrong.example'}})).status,403);
  const preflight=await fetch(endpoint+'/v1/snapshot/school',{method:'OPTIONS',headers:{Origin:'https://test.example','Access-Control-Request-Method':'PUT'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'https://test.example');
  await db.replaceAll(empty());await db.put('meta',settings('dark'));await S.load();
  const c=await S.addClass('Синтетический класс'),p=await S.addStudent(c.id,'Синтетический ученик',1,'girls'),l=await S.addLesson(c.id,'2026-10-01');
  await S.setMark(p.id,l.id,{value:'5'});
  assert.equal((await sync(A)).revision,1);
  const file=await readFile(join(directory,'school.json'),'utf8');
  assert.ok(!file.includes('Синтетический')&&!file.includes(password)&&!file.includes(tokenA));
  let a=await db.dumpAll();
  assert.equal((await S.makeBackup()).data.meta.some(r=>r.id.startsWith('sync-checkpoint-')),false);
  assert.equal((await syncStatus('school')).revision,1);

  await db.replaceAll(empty());await db.put('meta',settings('light'));await db.put('coachTeams',{id:'t',name:'Локальная команда',archived:false});
  assert.equal((await sync(B)).revision,2);
  assert.equal((await db.get('meta','settings')).theme,'light');
  assert.equal((await db.get('coachTeams','t')).name,'Локальная команда');
  await S.load();await S.setMark(p.id,l.id,{value:'4'});
  assert.equal((await sync(B)).revision,3);
  let b=await db.dumpAll();

  await db.replaceAll(a);await S.load();
  const c2=await S.addClass('Новый класс');await S.setMark(p.id,l.id,{value:'3'});
  const plan=await prepare(A);
  assert.deepEqual(new Set(plan.conflicts.map(c=>c.store)),new Set(['marks','workRecords']));
  await assert.rejects(executeSync({plan,choices:{},password,client:A,confirmed:true}),/конфликт/);
  const mixed=Object.fromEntries(plan.conflicts.map(c=>[c.key,c.store==='marks'?'local':'remote']));
  const current=await db.dumpAll();
  assert.throws(()=>previewSync(current,plan,mixed),/несовместимых/);
  const choices=Object.fromEntries(plan.conflicts.map(c=>[c.key,'remote']));
  assert.equal((await executeSync({plan,choices,password,client:A,confirmed:true})).revision,4);
  assert.equal((await db.getAll('marks'))[0].value,'4');
  assert.ok(await db.get('classes',c2.id));assert.equal((await db.get('meta','settings')).theme,'dark');
  a=await db.dumpAll();

  await db.replaceAll(b);assert.equal((await sync(B)).revision,5);
  assert.ok(await db.get('classes',c2.id));
  assert.equal((await db.get('meta','settings')).theme,'light');
  const stale=await prepare(B);
  await db.del('classes',c2.id);
  await assert.rejects(executeSync({plan:stale,choices:{},password,client:B,confirmed:true}),/изменились/);
  assert.equal((await B.get()).revision,5);
  assert.equal((await sync(B)).revision,6);
  b=await db.dumpAll();

  await db.replaceAll(a);assert.equal((await sync(A)).revision,7);
  assert.equal(await db.get('classes',c2.id),undefined);
  assert.equal((await db.getAll('marks'))[0].value,'4');
  await assert.rejects(prepare(A,'wrong-password-for-test'),/неверный пароль/);
  await disconnectSync('school',true);assert.equal(await syncStatus('school'),null);
  assert.equal((await db.getAll('marks'))[0].value,'4');
  await db.put('classes',{id:'unrelated',name:'Другая база'});
  await assert.rejects(prepare(A),/Первичное подключение/);
  const coach=relayClient(endpoint,'coach',coachToken);
  assert.deepEqual(await coach.get(),{revision:0,envelope:null});
  const snap=projectScope(b,'school');
  assert.ok(!Object.hasOwn(snap,'coachTeams'));
  assert.ok(!Object.hasOwn(snap.meta[0],'theme'));
  assert.throws(()=>combineScope(b,{...snap,coachTeams:[]},'school'));
  const latest=await B.get();
  await assert.rejects(B.put(latest.revision-1,latest.envelope),/новая ревизия/);
  const race=await Promise.allSettled([A.put(latest.revision,latest.envelope),B.put(latest.revision,latest.envelope)]);
  assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(race.filter(x=>x.status==='rejected').length,1);
  await db.replaceAll(b);
  await assert.rejects(prepare(B),/подмена ревизии/); // server cannot decrypt opaque packet, client checks authenticated inner revision
 }finally{
  await new Promise(resolve=>server.close(resolve));
  await rm(directory,{recursive:true,force:true});
 }
});
