import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {openVaultLab,readVaultLab,replaceVaultLab} from '../tools/prototypes/local-vault.mjs';
import {vaultBundleActivationLab} from '../tools/prototypes/vault-bundle-activation-lab.mjs';
const passwords={school:'synthetic-school-key',coach:'synthetic-coach-key',workspace:'synthetic-owner-key'};
function lockQueue(){const tails=new Map();return {request(name,opts,fn){assert.equal(opts.mode,'exclusive');const current=(tails.get(name)||Promise.resolve()).then(fn);tails.set(name,current.catch(()=>{}));return current;}};}
const fixture=()=>{const data=Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]]));data.classes.push({id:'c',name:'Synthetic class',gradeLevel:7});data.students.push({id:'p',classId:'c',fullName:'Synthetic pupil',number:1,normGroup:'girls'});data.meta.push({id:'owner',value:'private-owner'});return data;};
test('Complete bundle becomes visible through one registry commit, with individual scoped reads and pinned revisions',async t=>{
 const locks=lockQueue(),a=vaultBundleActivationLab('activate',{locks}),b=vaultBundleActivationLab('activate',{locks}),data=fixture();
 assert.deepEqual(await b.status(),{active:false});await assert.rejects(b.readScope({scope:'school',password:passwords.school}),/не активирован/);
 const staged=await a.stage({passwords,data});
 assert.deepEqual(await b.status(),{active:false});
 await assert.rejects(a.activate({expectedData:data,passwords:{...passwords,coach:'incorrect-coach-key'},expectedBundleId:staged.bundleId}),/неверный пароль/);
 const changed=structuredClone(data);changed.meta[0].value='different';
 await assert.rejects(a.activate({expectedData:changed,passwords,expectedBundleId:staged.bundleId}),/не совпадает/);
 const proto=IDBObjectStore.prototype,add=proto.add;
 proto.add=function(...args){if(this.transaction.db.name==='teachapp-vault-bundle-registry-lab-activate')throw new DOMException('Simulated registry quota','QuotaExceededError');return add.apply(this,args);};
 try{await assert.rejects(a.activate({expectedData:data,passwords,expectedBundleId:staged.bundleId}),e=>e.name==='QuotaExceededError');}finally{proto.add=add;}
 assert.deepEqual(await b.status(),{active:false});
 const active=await a.activate({expectedData:data,passwords,expectedBundleId:staged.bundleId});assert.equal(active.bundleId,staged.bundleId);assert.equal((await b.status()).active,true);
 const school=await b.readScope({scope:'school',password:passwords.school});assert.equal(school.students[0].id,'p');assert.ok(!Object.hasOwn(school,'meta'));
 await assert.rejects(b.readScope({scope:'school',password:passwords.coach}),/неверный пароль/);assert.deepEqual(await a.snapshot({passwords}),data);
 await assert.rejects(b.activate({expectedData:data,passwords,expectedBundleId:staged.bundleId}),/уже активирован/);
 const vault=await openVaultLab('teachapp-vault-lab-active-activate-school');t.after(()=>vault.close());
 const old=await readVaultLab(vault,{scope:'school',password:passwords.school});await replaceVaultLab(vault,{scope:'school',password:passwords.school,expectedRevision:old.revision,data:old.data});
 await assert.rejects(b.readScope({scope:'school',password:passwords.school}),/ревизия области LAB изменилась/);
 await assert.rejects(a.snapshot({passwords}),/ревизия области LAB изменилась/);
});
test('Interrupted stage cannot activate an incomplete scope bundle',async()=>{
 const a=vaultBundleActivationLab('partial',{locks:lockQueue()}),data=fixture();
 const proto=IDBObjectStore.prototype,add=proto.add;
 proto.add=function(...args){if(this.transaction.db.name==='teachapp-vault-lab-active-partial-coach')throw new DOMException('Simulated coach quota','QuotaExceededError');return add.apply(this,args);};
 try{await assert.rejects(a.stage({passwords,data}),e=>e.name==='QuotaExceededError');}finally{proto.add=add;}
 assert.deepEqual(await a.status(),{active:false});
 await assert.rejects(a.activate({expectedData:data,passwords,expectedBundleId:crypto.randomUUID()}),/неверный пароль/);
 await assert.rejects(a.snapshot({passwords}),/не активирован/);
 await assert.rejects(a.stage({passwords,data}),/перезапись запрещена/);
});
