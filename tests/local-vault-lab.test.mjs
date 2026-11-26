import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {openVaultLab,stageVaultLab,unlockVaultLab} from '../tools/prototypes/local-vault.mjs';
const password='synthetic-vault-password-2026',data={students:[{id:'student-secret',name:'Синтетический ученик'}],marks:[{id:'grade-secret',value:5}],empty:[]};
async function dbFor(t,name){const db=await openVaultLab('teachapp-vault-lab-'+name);t.after(()=>db.close());return db;}
async function raw(db){return new Promise((resolve,reject)=>{const req=db.transaction('sealed').objectStore('sealed').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function mutate(db,fn){return new Promise((resolve,reject)=>{const tx=db.transaction('sealed','readwrite');fn(tx.objectStore('sealed'));tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});}
test('LAB stage is atomic, reopens, has opaque record keys and no plaintext fields',async t=>{
 const db=await dbFor(t,'roundtrip');
 assert.deepEqual(await stageVaultLab(db,{scope:'school',data,password}),{scope:'school',records:2,verified:true});
 const rows=await raw(db);assert.equal(rows.length,4);assert.equal(rows.filter(r=>/^[a-f0-9]{32}$/.test(r.id)).length,2);
 const encrypted=rows.filter(r=>r.id!=='header');assert.equal(new Set(encrypted.map(r=>Array.from(r.iv).join(','))).size,3);
 for(const r of encrypted)assert.deepEqual(Object.keys(r).sort(),['data','id','iv']);
 assert.ok(!JSON.stringify(rows).includes('student-secret'));assert.ok(!JSON.stringify(rows).includes('Синтетический ученик'));
 const reopened=await openVaultLab(db.name);t.after(()=>reopened.close());
 assert.deepEqual(JSON.parse(JSON.stringify(await unlockVaultLab(reopened,{scope:'school',password}))),data);
 await assert.rejects(unlockVaultLab(reopened,{scope:'school',password:'wrong-password-123'}),/Не удалось открыть/);
 await assert.rejects(unlockVaultLab(reopened,{scope:'coach',password}),/Не удалось открыть/);
 await assert.rejects(stageVaultLab(db,{scope:'school',data,password}),/перезапись запрещена/);
 assert.deepEqual(await raw(db),rows);
 assert.throws(()=>openVaultLab('teachapp'),/отдельное имя/);
});
test('LAB refuses missing, injected and swapped envelopes; separate scopes do not share salt',async t=>{
 const db=await dbFor(t,'tamper'),other=await dbFor(t,'other');
 await stageVaultLab(db,{scope:'school',data,password});await stageVaultLab(other,{scope:'coach',data,password});
 const rows=await raw(db),[a,b]=rows.filter(r=>/^[a-f0-9]{32}$/.test(r.id));
 assert.notDeepEqual(rows.find(r=>r.id==='header').salt,(await raw(other)).find(r=>r.id==='header').salt);
 await mutate(db,s=>s.delete(a.id));await assert.rejects(unlockVaultLab(db,{scope:'school',password}),/повреждение/);
 await mutate(db,s=>{s.add(a);s.add({...b,id:'injected'});});await assert.rejects(unlockVaultLab(db,{scope:'school',password}),/повреждение/);
 await mutate(db,s=>{s.delete('injected');s.put({...b,id:a.id});s.put({...a,id:b.id});});await assert.rejects(unlockVaultLab(db,{scope:'school',password}),/повреждение/);
});
test('Invalid duplicate ID never creates partial ciphertext',async t=>{
 const db=await dbFor(t,'invalid');await assert.rejects(stageVaultLab(db,{scope:'school',data:{students:[data.students[0],data.students[0]]},password}),/ID/);assert.deepEqual(await raw(db),[]);
});

import {readVaultLab,replaceVaultLab,exportVaultLab,restoreVaultLab} from '../tools/prototypes/local-vault.mjs';
test('LAB snapshot replacement detects concurrent writers and rotates the password without losing data',async t=>{
 const db=await dbFor(t,'cas'),other=await openVaultLab(db.name);t.after(()=>other.close());
 await stageVaultLab(db,{scope:'school',data,password});
 const old=await readVaultLab(db,{scope:'school',password}),oldRows=await raw(db),a={...data,marks:[{id:'grade-secret',value:3}]},b={...data,marks:[{id:'grade-secret',value:4}]};
 const results=await Promise.allSettled([replaceVaultLab(db,{scope:'school',password,expectedRevision:old.revision,data:a}),replaceVaultLab(other,{scope:'school',password,expectedRevision:old.revision,data:b})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(results.find(x=>x.status==='rejected').reason.message,/изменился/);
 const current=await readVaultLab(db,{scope:'school',password});assert.notEqual(current.revision,old.revision);assert.ok([3,4].includes(current.data.marks[0].value));
 assert.notDeepEqual((await raw(db)).find(r=>r.id==='header').salt,oldRows.find(r=>r.id==='header').salt);
 await assert.rejects(replaceVaultLab(db,{scope:'school',password,expectedRevision:old.revision,data}),/изменился/);
 const newPassword='new-synthetic-vault-password';await replaceVaultLab(db,{scope:'school',password,expectedRevision:current.revision,data:current.data,nextPassword:newPassword});
 await assert.rejects(readVaultLab(db,{scope:'school',password}),/неверный пароль/);assert.deepEqual((await readVaultLab(db,{scope:'school',password:newPassword})).data,current.data);
});
test('Portable encrypted LAB backup restores independently and cannot overwrite an existing vault',async t=>{
 const db=await dbFor(t,'export'),dest=await dbFor(t,'restore'),bad=await dbFor(t,'bad-restore');
 await stageVaultLab(db,{scope:'coach',data,password});const source=await readVaultLab(db,{scope:'coach',password}),file=await exportVaultLab(db,{scope:'coach',password});
 assert.doesNotMatch(file,/student-secret|grade-secret|Синтетический ученик/);
 await assert.rejects(restoreVaultLab(bad,{scope:'coach',password:'wrong-password-123',file}),/неверный пароль/);assert.deepEqual(await raw(bad),[]);
 const edited=JSON.parse(file);edited.rows=edited.rows.filter(r=>r.id==='header'||r.id==='manifest');await assert.rejects(restoreVaultLab(bad,{scope:'coach',password,file:JSON.stringify(edited)}),/повреждение/);assert.deepEqual(await raw(bad),[]);
 await restoreVaultLab(dest,{scope:'coach',password,file});const copy=await readVaultLab(dest,{scope:'coach',password});assert.deepEqual(copy.data,source.data);assert.notEqual(copy.revision,source.revision);
 await assert.rejects(restoreVaultLab(dest,{scope:'coach',password,file}),/перезапись запрещена/);assert.deepEqual((await readVaultLab(dest,{scope:'coach',password})).data,source.data);
});
