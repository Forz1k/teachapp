import 'fake-indexeddb/auto';
import test from 'node:test';import assert from 'node:assert/strict';
import * as db from '../js/db.js';import * as S from '../js/store.js';
import {saveKtpVersion,listKtpVersions,compareKtpVersion,restoreKtpVersionCopy,deleteKtpVersion,validateKtpVersion} from '../js/ktp-history.js';
import {projectScope} from '../js/sync.js';
import {validateBackup} from '../js/backup.js';
async function setup(){
 await db.clearAll();await S.load();const k=await S.addKtp({name:'Исходный КТП',classIds:[]});
 await S.appendKtpTopics(k.id,[{name:'Бег'},{name:'Прыжок'}]);return k;
}
test('KTP manual checkpoint, comparison, automatic pre-replace and independent restored copy',async()=>{
 const k=await setup(),[first,second]=S.topicsOfKtp(k.id);
 await S.updateTopic(first.id,{activityIds:['run'],activitiesConfirmed:true});
 const version=await saveKtpVersion(k.id,'Первая редакция');
 await S.updateTopic(first.id,{name:'Бег 30 м'});
 const diff=compareKtpVersion(version,k,S.topicsOfKtp(k.id));assert.equal(diff.changed.length,1);assert.equal(diff.changed[0].before.name,'Бег');
 await S.replaceKtpTopics(k.id,[{name:'Новая тема'}]);
 const versions=await listKtpVersions(k.id);assert.equal(versions.length,2);assert.ok(versions.some(v=>v.reason==='replace'));
 const before=await db.dumpAll();await assert.rejects(restoreKtpVersionCopy(version.id,{name:'Копия'}),/Подтвердите/);
 const result=await restoreKtpVersionCopy(version.id,{name:'Копия',confirmed:true});
 assert.equal(result.topics,2);assert.deepEqual(result.plan.classIds,[]);
 const restored=await db.transaction(['topics'],'readonly',s=>s.topics.index('ktpId').getAll(result.plan.id));
 assert.deepEqual(restored.sort((a,b)=>a.ktpOrder-b.ktpOrder).map(t=>t.name),['Бег','Прыжок']);
 assert.ok(restored.every(t=>t.activitiesConfirmed===false&&![first.id,second.id].includes(t.id)));
 assert.deepEqual(await db.get('ktp',k.id),before.ktp.find(x=>x.id===k.id));
 assert.deepEqual((await db.getAll('topics')).filter(t=>t.ktpId===k.id),before.topics);
 const data=await db.dumpAll(),backup=await S.makeBackup();validateBackup(backup);
 assert.equal(projectScope(data,'school').workRecords.filter(r=>r.kind==='ktpVersion').length,2);
 assert.equal(projectScope(data,'coach').workRecords.filter(r=>r.kind==='ktpVersion').length,0);
 assert.throws(()=>validateKtpVersion({...version,topics:[version.topics[0],version.topics[0]]}),/Некорректная тема/);
 await assert.rejects(deleteKtpVersion(version.id),/Подтвердите/);await deleteKtpVersion(version.id,true);assert.equal((await listKtpVersions(k.id)).length,1);
});
test('used topics cannot be deleted by stale tab; unused deletions record version atomically',async()=>{
 const k=await setup(),[first,second]=S.topicsOfKtp(k.id);
 await db.put('lessons',{id:'late',classId:'synthetic',date:'2026-11-25',topicId:first.id});
 const before=await db.dumpAll();await assert.rejects(S.deleteTopic(first.id),/используется/);await assert.rejects(S.deleteKtp(k.id),/используются/);
 assert.deepEqual(await db.dumpAll(),before);assert.equal((await listKtpVersions(k.id)).length,0);
 await db.del('lessons','late');await S.deleteTopic(second.id);assert.equal((await listKtpVersions(k.id))[0].reason,'deleteTopic');
 await S.deleteKtp(k.id);assert.equal((await listKtpVersions(k.id)).length,2);assert.equal(await db.get('ktp',k.id),undefined);
 assert.equal((await listKtpVersions()).length,2);
});
test('reorder is atomic, deterministic, rejects stale and invalid permutations',async()=>{
 const k=await setup(),ids=S.topicsOfKtp(k.id).map(t=>t.id),reversed=ids.slice().reverse();
 await S.reorderKtpTopics(k.id,ids,reversed);assert.deepEqual(S.topicsOfKtp(k.id).map(t=>t.id),reversed);assert.deepEqual(S.topicsOfKtp(k.id).map(t=>t.ktpOrder),[1,2]);
 const before=await db.dumpAll();await assert.rejects(S.reorderKtpTopics(k.id,ids,reversed),/изменился/);await assert.rejects(S.reorderKtpTopics(k.id,reversed,[ids[0],ids[0]]),/Некорректный/);assert.deepEqual(await db.dumpAll(),before);
});
