import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';
import * as D from '../js/db.js';import * as S from '../js/store.js';import * as C from '../js/coach.js';
import {openVaultLab} from '../tools/prototypes/local-vault.mjs';
import {splitVaultScopesLab,joinVaultScopesLab,stageVaultScopeBundleLab,readVaultScopeLab,readVaultScopeBundleLab} from '../tools/prototypes/vault-scope-bundle.mjs';
const passwords={school:'synthetic-school-key',coach:'synthetic-coach-key',workspace:'synthetic-owner-key'};
const scopes=Object.keys(passwords);
async function bundle(id,t){
 const dbs=Object.fromEntries(await Promise.all(scopes.map(async s=>[s,await openVaultLab('teachapp-vault-lab-bundle-'+id+'-'+s)])));
 t.after(()=>Object.values(dbs).forEach(db=>db.close()));return dbs;
}
const ordered=data=>Object.fromEntries(Object.keys(D.SCHEMA).map(n=>[n,[...data[n]].sort((a,b)=>indexedDB.cmp(a.id,b.id))]));
test('Three independent keys, lossless school and coach records and owner-only shared data',async t=>{
 await D.clearAll();await S.load();const c=await S.addClass('7А');await S.addStudent(c.id,'Synthetic pupil',1,'girls');
 const team=await C.saveTeam({name:'Synthetic team'});await C.savePlayer({teamId:team.id,name:'Synthetic athlete',number:1,position:'setter'});
 const data=JSON.parse(JSON.stringify(await D.dumpAll()));
 data.meta.push({id:'owner-local-only',value:'OWNER_PRIVATE'});
 data.workRecords.push({id:'exercise-lab',kind:'exercise',name:'Synthetic exercise',category:'warmup',activityId:'other',minutes:5,description:'Synthetic description',equipment:'',level:'all'});
 const parts=splitVaultScopesLab(data);assert.deepEqual(ordered(joinVaultScopesLab(parts)),ordered(data));
 assert.ok(!Object.hasOwn(parts.school,'meta'));assert.ok(!Object.hasOwn(parts.school,'coachPlayers'));assert.ok(!Object.hasOwn(parts.coach,'students'));
 assert.equal(parts.workspace.workRecords[0].id,'exercise-lab');
 assert.throws(()=>joinVaultScopesLab({...parts,school:{...parts.school,meta:[]}}),/Неверный состав/);
 const checkpoint=structuredClone(data);checkpoint.meta.push({id:'sync-checkpoint-school'});assert.throws(()=>splitVaultScopesLab(checkpoint),/Контрольные точки/);
 const dbs=await bundle('full',t);
 await assert.rejects(stageVaultScopeBundleLab(dbs,{passwords:{...passwords,coach:passwords.school},data}),/три разных пароля/);
 assert.equal((await stageVaultScopeBundleLab(dbs,{passwords,data})).verified,true);
 const school=await readVaultScopeLab(dbs.school,{scope:'school',password:passwords.school});
 const coach=await readVaultScopeLab(dbs.coach,{scope:'coach',password:passwords.coach});
 assert.doesNotMatch(JSON.stringify(school.data),/Synthetic athlete|OWNER_PRIVATE/);assert.doesNotMatch(JSON.stringify(coach.data),/Synthetic pupil|OWNER_PRIVATE/);
 await assert.rejects(readVaultScopeLab(dbs.coach,{scope:'coach',password:passwords.school}),/неверный пароль/);
 await assert.rejects(readVaultScopeLab(dbs.school,{scope:'coach',password:passwords.school}),/неверный пароль/);
 assert.deepEqual(ordered((await readVaultScopeBundleLab(dbs,{passwords})).data),ordered(data));
 await assert.rejects(stageVaultScopeBundleLab(dbs,{passwords,data}),/перезапись запрещена/);
});
test('Partial and mixed bundles cannot be opened as one full snapshot',async t=>{
 const data=Object.fromEntries(Object.keys(D.SCHEMA).map(n=>[n,[]]));
 data.meta.push({id:'synthetic',value:1});
 const a=await bundle('one',t),b=await bundle('two',t);
 await stageVaultScopeBundleLab(a,{passwords,data});
 await assert.rejects(readVaultScopeBundleLab({...a,coach:b.coach},{passwords}),/неверный пароль/);
 await stageVaultScopeBundleLab(b,{passwords,data});
 await assert.rejects(readVaultScopeBundleLab({...a,coach:b.coach},{passwords}),/разных наборов/);
});
