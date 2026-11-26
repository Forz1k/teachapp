import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {SCHEMA} from '../js/db.js';
import {createWorkSession} from '../js/workbench.js';
import {createCoachSession} from '../js/coach.js';
import {partitionedVaultLab} from '../tools/prototypes/vault-partitioned-lab.mjs';
import {openPartitionRecoveryCopyLab} from '../tools/prototypes/vault-partition-recovery-lab.mjs';
const passwords={school:'synthetic-school-password',coach:'synthetic-coach-password',workspace:'synthetic-owner-password'};
const fixture=()=>{const data=Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]]));data.classes=[{id:'c',name:'Synthetic class',gradeLevel:7}];data.students=[{id:'p',classId:'c',fullName:'Synthetic pupil',number:1,normGroup:'girls'}];data.coachTeams=[{id:'t',name:'Synthetic team',archived:false}];data.meta=[{id:'owner',value:'Synthetic owner-only'}];return data;};
const open=(lab,scope,extra={})=>lab.openScope({scope,password:passwords[scope],...extra});
const event={kind:'event',name:'Synthetic event',date:'2025-09-01',time:'16:00',minutes:30,eventType:'meeting',note:'',remind:15,done:false};
test('Three-key writable partitions use real commands and independently update pinned revisions',async t=>{
 const lab=partitionedVaultLab('independent'),data=fixture();
 assert.deepEqual(await lab.status(),{active:false});
 await assert.rejects(open(lab,'school'),/не активирован/);
 await assert.rejects(lab.stage({data,passwords:{...passwords,coach:passwords.school}}),/независимых пароля/);
 const initial=await lab.stage({data,passwords});
 await assert.rejects(lab.stage({data,passwords}),/перезапись запрещена/);
 await assert.rejects(open(lab,'school',{password:passwords.coach}),/неверный пароль/);
 const schoolAccess=await open(lab,'school'),coachAccess=await open(lab,'coach'),ownerAccess=await open(lab,'workspace');
 const school=createWorkSession(schoolAccess,'school'),coach=createCoachSession(coachAccess),owner=createWorkSession(ownerAccess,'workspace');
 t.after(()=>[school,coach,owner].forEach(s=>s.close()));
 const [brief,team,appointment]=await Promise.all([
  school.saveBriefing({classId:'c',participantIds:['p'],date:'2025-09-01',category:'lesson',topic:'Synthetic safety',note:''},true),
  coach.saveTeam({name:'Second synthetic team'}),
  owner.saveWork(event)
 ]);
 assert.equal(brief.classId,'c');assert.equal(team.name,'Second synthetic team');
 const next=await lab.status();assert.equal(next.bundleId,initial.bundleId);
 for(const s of Object.keys(passwords))assert.notEqual(next.revisions[s],initial.revisions[s]);
 assert.deepEqual(await school.listWork('event'),[]);assert.deepEqual(await owner.listWork('briefing'),[]);
 assert.deepEqual(await schoolAccess.getAll('students'),data.students);assert.equal((await coachAccess.getAll('coachTeams')).length,2);
 assert.equal((await ownerAccess.get('meta','owner')).value,'Synthetic owner-only');
 const bad=await open(lab,'school');await assert.rejects(bad.getAll('meta'),/недоступно/);assert.ok(bad.isClosed());
 const wrong=await open(lab,'coach');await assert.rejects(wrong.put('workRecords',{...event,id:'foreign-event'}),/другой области/);assert.ok(wrong.isClosed());
 const after=await lab.snapshot({passwords});assert.deepEqual(after.students,data.students);assert.deepEqual(after.meta,data.meta);
 assert.equal(after.coachTeams.length,2);assert.ok(after.workRecords.some(r=>r.id===brief.id));assert.ok(after.workRecords.some(r=>r.id===appointment.id));assert.equal(after.workRecords.length,2);
 assert.deepEqual(await lab.status(),next);
 school.close();await assert.rejects(schoolAccess.getAll('students'),/заблокирован/);assert.equal((await coachAccess.getAll('coachTeams')).length,2);
});
test('Initial and later quota errors atomically preserve ciphertext and pointer',async t=>{
 const lab=partitionedVaultLab('quota'),data=fixture(),proto=IDBObjectStore.prototype,add=proto.add,put=proto.put;
 proto.add=function(...args){if(this.transaction.db.name==='teachapp-vault-mutable-lab-quota'&&this.name==='coach')throw new DOMException('Synthetic quota','QuotaExceededError');return add.apply(this,args);};
 try{await assert.rejects(lab.stage({data,passwords}),e=>e.name==='QuotaExceededError');}finally{proto.add=add;}
 assert.deepEqual(await lab.status(),{active:false});const initial=await lab.stage({data,passwords});
 const s=await open(lab,'school');t.after(()=>s.close());
 proto.put=function(...args){if(this.transaction.db.name==='teachapp-vault-mutable-lab-quota'&&this.name==='state')throw new DOMException('Synthetic pointer quota','QuotaExceededError');return put.apply(this,args);};
 try{await assert.rejects(s.put('classes',{id:'other',name:'Uncommitted'}),e=>e.name==='QuotaExceededError');}finally{proto.put=put;}
 assert.ok(s.isClosed());assert.deepEqual((await lab.status()).revisions,initial.revisions);assert.deepEqual(await lab.snapshot({passwords}),data);
 const retry=await open(lab,'school');t.after(()=>retry.close());await retry.put('classes',{id:'other',name:'Committed'});assert.equal((await retry.getAll('classes')).length,2);
});
test('Stale scope sessions and close during pending callback fail without overwriting',async t=>{
 const lab=partitionedVaultLab('race'),data=fixture();await lab.stage({data,passwords});
 const a=await open(lab,'school'),b=await open(lab,'school'),c=await open(lab,'coach');t.after(()=>[a,b,c].forEach(s=>s.close()));
 let enter,release;const entered=new Promise(r=>enter=r),waiting=new Promise(r=>release=r);
 const pending=a.transaction('classes','readwrite',async stores=>{await stores.classes.put({id:'stale',name:'Stale'});enter();await waiting;});
 await entered;await b.put('classes',{id:'fresh',name:'Fresh'});release();
 await assert.rejects(pending,/Ревизия области/);assert.ok(a.isClosed());assert.equal(await b.get('classes','stale'),undefined);
 assert.equal((await c.getAll('coachTeams')).length,1);
 const late=await open(lab,'school');t.after(()=>late.close());let entered2,release2;
 const start2=new Promise(r=>entered2=r),wait2=new Promise(r=>release2=r);
 const write=late.transaction('classes','readwrite',async stores=>{await stores.classes.put({id:'closed',name:'Closed'});entered2();await wait2;});
 await start2;late.close();release2();await assert.rejects(write,/заблокирован/);
 assert.equal(await b.get('classes','closed'),undefined);
 let clock=0;const expired=await open(lab,'school',{idleMs:10000,now:()=>clock});t.after(()=>expired.close());clock=10001;
 await assert.rejects(expired.getAll('classes'),/заблокирован/);assert.ok(expired.isClosed());
});

const backupPasswords={school:'synthetic-backup-school',coach:'synthetic-backup-coach',workspace:'synthetic-backup-owner'};
const newPasswords={school:'synthetic-new-school',coach:'synthetic-new-coach',workspace:'synthetic-new-owner'};
const restoredPasswords={school:'synthetic-restore-school',coach:'synthetic-restore-coach',workspace:'synthetic-restore-owner'};
test('Partition recovery copy is ciphertext-only, binds source revisions and restores independent keys',async t=>{
 const lab=partitionedVaultLab('recovery'),data=fixture(),initial=await lab.stage({data,passwords});
 await assert.rejects(lab.prepareRecoveryCopy({passwords,backupPasswords:{...backupPasswords,school:passwords.coach}}),/независимыми/);
 const first=await lab.prepareRecoveryCopy({passwords,backupPasswords});
 assert.doesNotMatch(first.file,/Synthetic pupil|Synthetic team|owner-only|synthetic-backup-school/);
 const recovered=await openPartitionRecoveryCopyLab(first.file,{passwords:backupPasswords});assert.deepEqual(recovered.data,data);assert.equal(recovered.source.sourceBundleId,initial.bundleId);assert.deepEqual(recovered.source.sourceRevisions,initial.revisions);
 await assert.rejects(openPartitionRecoveryCopyLab(first.file,{passwords:{...backupPasswords,coach:'wrong-backup-coach'}}),/неверный пароль/);
 const another=await lab.prepareRecoveryCopy({passwords,backupPasswords}),mixed=JSON.parse(first.file);mixed.parts.coach=JSON.parse(another.file).parts.coach;
 await assert.rejects(openPartitionRecoveryCopyLab(JSON.stringify(mixed),{passwords:backupPasswords}),/Другая область или набор/);
 const target=partitionedVaultLab('recovery-target');
 await assert.rejects(target.restoreRecoveryCopy({file:first.file,backupPasswords,newPasswords:restoredPasswords}),/Подтвердите/);
 const restored=await target.restoreRecoveryCopy({file:first.file,backupPasswords,newPasswords:restoredPasswords,confirmed:true});
 assert.notEqual(restored.bundleId,initial.bundleId);assert.deepEqual(await target.snapshot({passwords:restoredPasswords}),data);assert.deepEqual(await lab.status(),{active:true,...initial});
 await assert.rejects(target.restoreRecoveryCopy({file:first.file,backupPasswords,newPasswords:restoredPasswords,confirmed:true}),/перезапись запрещена/);
});
test('All-key rotation requires exact independent copy and atomically rejects quota and stale sessions',async t=>{
 const lab=partitionedVaultLab('rotation'),data=fixture();await lab.stage({data,passwords});
 const staleCopy=await lab.prepareRecoveryCopy({passwords,backupPasswords});
 const school=await open(lab,'school'),coach=await open(lab,'coach');t.after(()=>[school,coach].forEach(s=>s.close()));
 await school.put('classes',{id:'new',name:'Synthetic changed class'});const changed=await lab.snapshot({passwords});
 const rotate=backupFile=>lab.rotatePasswords({passwords,newPasswords,backupPasswords,backupFile,saved:true});
 await assert.rejects(rotate(staleCopy.file),/Копия устарела/);
 const copy=await lab.prepareRecoveryCopy({passwords,backupPasswords}),before=await lab.status();
 await assert.rejects(lab.rotatePasswords({passwords,newPasswords,backupPasswords,backupFile:copy.file}),/сохранённая независимая копия/);
 const proto=IDBObjectStore.prototype,put=proto.put;
 proto.put=function(...args){if(this.transaction.db.name==='teachapp-vault-mutable-lab-rotation'&&this.name==='state')throw new DOMException('Synthetic quota','QuotaExceededError');return put.apply(this,args);};
 try{await assert.rejects(rotate(copy.file),e=>e.name==='QuotaExceededError');}finally{proto.put=put;}
 assert.deepEqual(await lab.status(),before);assert.deepEqual(await lab.snapshot({passwords}),changed);
 assert.equal((await school.getAll('classes')).length,2);
 const next=await rotate(copy.file);assert.equal(next.bundleId,before.bundleId);for(const s of Object.keys(passwords))assert.notEqual(next.revisions[s],before.revisions[s]);
 await assert.rejects(school.getAll('classes'),/Ревизия области/);await assert.rejects(coach.getAll('coachTeams'),/Ревизия области/);
 await assert.rejects(lab.snapshot({passwords}),/неверный пароль/);
 assert.deepEqual(await lab.snapshot({passwords:newPasswords}),changed);
 const restored=partitionedVaultLab('rotation-restored');
 await restored.restoreRecoveryCopy({file:copy.file,backupPasswords,newPasswords:restoredPasswords,confirmed:true});
 assert.deepEqual(await restored.snapshot({passwords:restoredPasswords}),changed);
});
