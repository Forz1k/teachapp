/* Actual bundled Workers in local workerd via Miniflare. All HTTPS host names
 * are dispatchFetch identifiers; no external network, real secrets or deploy. */
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readdir,readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import 'fake-indexeddb/auto';
import {IDBFactory} from 'fake-indexeddb';
import * as D from '../js/db.js';
import {defaultSettings} from '../js/model.js';
import {encryptBackup} from '../js/privacy.js';
import {BACKUP_VERSION} from '../js/backup.js';
import {digestToken} from '../server/cloudflare-protocol.mjs';
import {prepareNativeEncryptionCopy,activateNativeEncryption,openEncryptedStorage,exportEncryptedRecoveryCopy,recoverIntoEmptyEncryptedStorage} from '../js/encrypted-storage.js';
import {projectScope,relayClient,deltaCandidateClient,prepareDeltaMigration,freezeDeltaCandidateSource,commitDeltaMigration,cutoverDeltaCandidateDevice,activateDeltaCandidateMigration,finalizeDeltaCandidateDevice,rollbackDeltaCandidateDevice,sealDeltaMigrationRollback,deltaMigrationFenceClient,deltaCandidateSyncAdapter,prepareSync,executeSync,migrationBindingStatus,verifyLocalCheckpoint} from '../js/sync.js';

const [sourceDir,deltaDir]=process.argv.slice(2),entry=async dir=>{const js=(await readdir(dir)).filter(n=>/\.(m?js)$/.test(n));assert.equal(js.length,1,'Expected one bundled entrypoint in '+dir);return resolve(dir,js[0]);};
const sourceScript=await readFile(await entry(sourceDir),'utf8'),deltaScript=await readFile(await entry(deltaDir),'utf8'),dir=await mkdtemp(join(tmpdir(),'teachapp-v3-'));
const origin='https://app.example.com',sourceEndpoint='https://source.example.com',destinationEndpoint='https://delta.example.com',scopes=['school','coach'];
const tok=n=>n.repeat(43),sourceToken={school:tok('A'),coach:tok('B')},destinationToken={school:tok('C'),coach:tok('D')},sourceFenceToken={school:tok('E'),coach:tok('F')},destinationSealToken={school:tok('G'),coach:tok('H')};
const sourcePassword={school:'synthetic-school-source',coach:'synthetic-coach-source'},destinationPassword={school:'synthetic-school-dest',coach:'synthetic-coach-dest'},backupPassword='synthetic-migration-file-password',deviceBackupPassword='synthetic-independent-device-copy',passwords={school:'synthetic-v11-school-key',coach:'synthetic-v11-coach-key',workspace:'synthetic-v11-owner-key'};
const map=async fn=>Object.fromEntries(await Promise.all(scopes.map(async a=>[a,await fn(a)])));
const signing=await map(async()=>{const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey),publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey)};});
const sourceVars={TEACHAPP_SYNC_ORIGIN:origin,TEACHAPP_SYNC_TOKEN_HASHES:JSON.stringify(await map(async a=>[await digestToken(sourceToken[a])])),TEACHAPP_SYNC_MIGRATION_CANDIDATE:'true',TEACHAPP_SYNC_MIGRATION_ENDPOINT:sourceEndpoint,TEACHAPP_SYNC_FENCE_HASHES:JSON.stringify(await map(a=>digestToken(sourceFenceToken[a]))),TEACHAPP_SYNC_ROLLBACK_VERIFY_KEYS:JSON.stringify(await map(a=>signing[a].publicKey))};
const targetVars={TEACHAPP_DELTA_CANDIDATE:'true',TEACHAPP_DELTA_ORIGIN:origin,TEACHAPP_DELTA_ENDPOINT:destinationEndpoint,TEACHAPP_DELTA_TOKEN_HASHES:JSON.stringify(await map(async a=>[await digestToken(destinationToken[a])])),TEACHAPP_DELTA_SEAL_HASHES:JSON.stringify(await map(a=>digestToken(destinationSealToken[a]))),TEACHAPP_DELTA_ROLLBACK_SIGN_KEYS:JSON.stringify(await map(a=>signing[a].privateKey))};
const start=(script,binding,className,bindings,persist)=>new Miniflare(convertV4MiniflareOptions({name:'teachapp-v3-'+persist,modules:true,script,compatibilityDate:'2026-11-01',bindings,durableObjects:{[binding]:{className,useSQLite:true}},resourcePersistencePath:join(dir,persist),enableDevRegistry:false,cf:false,upstream:persist==='source'?sourceEndpoint:destinationEndpoint,verbose:false}));
let source,target,access;
const store=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};};
Object.defineProperty(globalThis,'localStorage',{value:store(),configurable:true,writable:true});
Object.defineProperty(globalThis,'navigator',{value:{locks:{request:async(name,options,fn)=>fn({name})}},configurable:true});
const fetcher=(url,init={})=>{const u=new URL(url),worker=u.origin===sourceEndpoint?source:u.origin===destinationEndpoint?target:null;assert.ok(worker,'Unexpected origin '+u.origin);const headers=new Headers(init.headers);headers.set('Origin',origin);return worker.dispatchFetch(url,{...init,headers});};
const argsFor=area=>({area,sourceEndpoint,destinationEndpoint,sourceToken:sourceToken[area],destinationToken:destinationToken[area],sourcePassword:sourcePassword[area],destinationPassword:destinationPassword[area],backupPassword,protocolVersion:1,candidate:true,fetcher});
const clientFor=a=>deltaCandidateClient(destinationEndpoint,a,destinationToken[a],{confirmed:true,fetcher});
const empty=Object.fromEntries(Object.keys(D.SCHEMA).map(n=>[n,[]]));
const data={...empty,meta:[defaultSettings()],classes:[{id:'c',name:'Synthetic class'}],coachTeams:[{id:'t',name:'Synthetic team',archived:false}]};
async function seed(snapshot){const q=indexedDB.open('teachapp',10),db=await new Promise((resolve,reject)=>{q.onupgradeneeded=()=>{for(const [n,d] of Object.entries(D.SCHEMA)){const s=q.result.createObjectStore(n,{keyPath:d.keyPath});for(const [i,k,o] of d.indexes)s.createIndex(i,k,o||{});}};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});await new Promise((resolve,reject)=>{const tx=db.transaction(Object.keys(D.SCHEMA),'readwrite');for(const [n,rows] of Object.entries(snapshot))for(const row of rows)tx.objectStore(n).add(row);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();}
async function fresh(){return exportEncryptedRecoveryCopy({data:await D.dumpAll(),backupPassword:deviceBackupPassword});}
try{
 source=start(sourceScript,'SNAPSHOTS','SyncSnapshot',sourceVars,'source');
 target=start(deltaScript,'DELTA_LEDGERS','DeltaLedger',targetVars,'target');
 const plans={};
 for(const a of scopes){
  const workspaceId=crypto.randomUUID(),envelope=await encryptBackup({app:'teachapp-sync',version:1,backupVersion:BACKUP_VERSION,area:a,workspaceId,revision:1,snapshot:projectScope(data,a)},sourcePassword[a]);
  assert.equal((await relayClient(sourceEndpoint,a,sourceToken[a],{fetcher}).put(0,envelope)).revision,1);
  data.meta.push({id:'sync-checkpoint-'+a,endpoint:sourceEndpoint,workspaceId,revision:1,envelope});
  plans[a]=await prepareDeltaMigration({...argsFor(a),current:data});assert.equal(plans[a].sourceRevision,1);
 }
 await seed(data);const initialFile=await prepareNativeEncryptionCopy({backupPassword:deviceBackupPassword});
 await activateNativeEncryption({passwords,backupPassword:deviceBackupPassword,file:initialFile,checkpointPasswords:sourcePassword,confirmed:true});
 access=await openEncryptedStorage({passwords});D.configureEncryptedStorage({...access,isUnlocked:()=>!access.isClosed()});
 const gates=Object.fromEntries(scopes.map(a=>[a,{migrationId:plans[a].migrationId,anchorCommitment:plans[a].destinationAnchorCommitment}]));
 const vars={...targetVars,TEACHAPP_DELTA_MIGRATION_GATES:JSON.stringify(gates)};
 await target.dispose();target=start(deltaScript,'DELTA_LEDGERS','DeltaLedger',vars,'target');
 const operator=a=>({...argsFor(a),file:plans[a].file,current:data,sourceFenceToken:sourceFenceToken[a],destinationSealToken:destinationSealToken[a],sourceFenceId:plans[a].migrationId,expectedMigrationId:plans[a].migrationId,expectedSourceRevision:1,confirmed:true,backupVerified:true,allDevicesReconciled:true,sourceFrozen:true});
 const device=a=>{const {sourceFenceToken,destinationSealToken,current,...rest}=operator(a);return rest;};
 const wrong=data.meta.find(r=>r.id==='sync-checkpoint-school').envelope;
 await assert.rejects(clientFor('school').anchor(wrong),e=>e.status===423);
 await assert.rejects(clientFor('school').append(1,wrong),e=>e.status===423);
 const unauth=await fetcher(destinationEndpoint+'/v3/delta/school/migration-activate',{method:'PUT',headers:{Authorization:'Bearer '+destinationToken.school,'Content-Type':'application/json'},body:JSON.stringify({...gates.school,expectedRevision:1})});assert.equal(unauth.status,401);
 for(const a of scopes){
  const op=operator(a);assert.equal((await freezeDeltaCandidateSource(op)).status,'source-frozen');
  await assert.rejects(relayClient(sourceEndpoint,a,sourceToken[a],{fetcher}).put(1,data.meta.find(r=>r.id==='sync-checkpoint-'+a).envelope),e=>e.code==='migration-frozen');
  assert.equal((await commitDeltaMigration(op)).status,'verified-fenced-copy');assert.equal((await commitDeltaMigration(op)).replayed,true);
  const d=device(a);assert.equal((await cutoverDeltaCandidateDevice({...d,confirmed:false})).status,'cutover-preview');
  await assert.rejects(cutoverDeltaCandidateDevice(d),/пароль/);
  const before=await fresh();assert.equal((await cutoverDeltaCandidateDevice({...d,deviceBackupFile:before,deviceBackupPassword})).status,'cutover-completed');
  assert.equal((await migrationBindingStatus(a)).status,'v3-pending');assert.equal((await D.get('meta','sync-checkpoint-'+a)).protocol,'delta-v3');
  await assert.rejects(finalizeDeltaCandidateDevice({...d,confirmed:false}),/Барьер/);
  const adapter=deltaCandidateSyncAdapter({...argsFor(a),endpoint:destinationEndpoint,token:destinationToken[a],password:destinationPassword[a],confirmed:true,readData:D.dumpAll});await assert.rejects(adapter.get(),/перенос/);
  await verifyLocalCheckpoint({area:a,data:await D.dumpAll(),password:destinationPassword[a]});
 }
 // Verify durable gate cannot be bypassed by removing runtime configuration.
 await target.dispose();target=start(deltaScript,'DELTA_LEDGERS','DeltaLedger',targetVars,'target');
 await assert.rejects(clientFor('school').head(),e=>e.status===503);
 await target.dispose();target=start(deltaScript,'DELTA_LEDGERS','DeltaLedger',vars,'target');
 assert.equal((await clientFor('school').migrationStatus()).gate.active,false);
 // Exact independent recovery in a separate empty profile retains both pending bindings.
 const pending=await fresh(),originalDB=indexedDB,originalStorage=localStorage;
 globalThis.indexedDB=new IDBFactory();globalThis.localStorage=store();
 try{await recoverIntoEmptyEncryptedStorage({passwords,backupPassword:deviceBackupPassword,file:pending,checkpointPasswords:destinationPassword,confirmed:true});
  const recovered=await openEncryptedStorage({passwords});try{const meta=await recovered.transaction('meta','readonly',s=>s.meta.getAll());assert.equal(meta.filter(r=>r.id.startsWith('sync-checkpoint-migration-')).length,2);}finally{recovered.close();}
 }finally{globalThis.indexedDB=originalDB;globalThis.localStorage=originalStorage;}
 // Rollback school, including signed receipt and refusal of a tampered signature.
 const school=operator('school'),sd=device('school');
 assert.equal((await sealDeltaMigrationRollback(school)).status,'rollback-sealed');
 await assert.rejects(activateDeltaCandidateMigration(school),/закрыто/);
 const sb=await fresh();assert.equal((await rollbackDeltaCandidateDevice({...sd,deviceBackupPassword,deviceBackupFile:sb})).status,'rollback-completed');
 assert.equal((await migrationBindingStatus('school')).status,'none');
 const receipt=await clientFor('school').rollbackReceipt(),fence=deltaMigrationFenceClient(school),resume={expectedRevision:1,migrationId:plans.school.migrationId,confirmed:true,backupVerified:true,allDevicesReconciled:true};
 await assert.rejects(fence.resumeCloudflareSource({...resume,receipt:{...receipt,signature:'A'.repeat(86)}}),/HTTP 409/);
 assert.equal((await fence.resumeCloudflareSource({...resume,receipt})).fence,null);
 assert.equal((await relayClient(sourceEndpoint,'school',sourceToken.school,{fetcher}).put(1,wrong)).revision,2);
 // Activate coach. Once active even revision 1 may never be sealed.
 const coach=operator('coach'),cd=device('coach');
 assert.equal((await activateDeltaCandidateMigration(coach)).status,'activated');
 assert.equal((await activateDeltaCandidateMigration(coach)).replayed,true);
 await assert.rejects(sealDeltaMigrationRollback(coach),/Барьер/);
 await assert.rejects(finalizeDeltaCandidateDevice({...cd,deviceBackupPassword,deviceBackupFile:pending}),/устарела/);
 const cb=await fresh();assert.equal((await finalizeDeltaCandidateDevice({...cd,deviceBackupPassword,deviceBackupFile:cb})).status,'finalize-completed');
 await D.put('coachTeams',{id:'t',name:'Edited after activation',archived:false});
 const client=deltaCandidateSyncAdapter({endpoint:destinationEndpoint,area:'coach',token:destinationToken.coach,password:destinationPassword.coach,confirmed:true,readData:D.dumpAll,fetcher});
 const plan=await prepareSync({area:'coach',endpoint:destinationEndpoint,password:destinationPassword.coach,client});
 assert.equal((await executeSync({plan,choices:{},password:destinationPassword.coach,client,confirmed:true})).revision,2);
 assert.equal((await D.get('meta','sync-checkpoint-coach')).revision,2);
 assert.equal((await D.getAll('classes'))[0].name,'Synthetic class');
 console.log('DELTA V3 MIGRATION PASS: actual local workerd HTTPS dispatch, pinned source and destination, durable gate, v11 CAS, independent pending recovery, signed rollback, activation and delta-only sync.');
}finally{access?.close();await Promise.allSettled([source?.dispose(),target?.dispose()]);await rm(dir,{recursive:true,force:true});}
