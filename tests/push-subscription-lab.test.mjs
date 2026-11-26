import test from 'node:test';
import assert from 'node:assert/strict';
import {subscriptionLifecycleLab} from '../tools/prototypes/push-subscription-lab.mjs';
const endpoint='https://push.example.invalid/sub/00000000-0000-4000-8000-000000000001',key=Uint8Array.from([4,...Array(64).fill(7)]),other=Uint8Array.from([4,...Array(64).fill(9)]);
function fixture(){
 let existing=null,granted='granted',visible=true,creates=0,deletes=0;
 const make=(serverKey=key,url=endpoint,expiry=null)=>({endpoint:url,expirationTime:expiry,options:{userVisibleOnly:true,applicationServerKey:serverKey.slice().buffer},getKey:name=>(name==='p256dh'?other.slice():new Uint8Array(16)).buffer,unsubscribe:async()=>{deletes++;existing=null;return true;}});
 const adapter={synthetic:true,getSubscription:async()=>existing,subscribe:async opts=>{creates++;assert.equal(opts.userVisibleOnly,true);assert.deepEqual(opts.applicationServerKey,key);existing=make();return existing;}};
 const c=subscriptionLifecycleLab({adapter,applicationServerKey:key,permission:()=>granted,active:()=>visible,now:()=>1000});
 return {adapter,c,make,set:s=>existing=s,permission:s=>granted=s,active:v=>visible=v,counts:()=>({creates,deletes})};
}
test('Explicit subscription lifecycle, no silent VAPID rotation, no permission prompt, aggregate status only',async()=>{
 const f=fixture();assert.deepEqual(await f.c.inspect(),{state:'absent'});
 assert.equal((await f.c.enable()).state,'permission-required');f.permission('denied');assert.equal((await f.c.enable({confirmed:true})).state,'permission-required');
 f.permission('granted');assert.deepEqual(await f.c.enable({confirmed:true}),{state:'ready'});assert.equal((await f.c.enable({confirmed:true})).state,'ready');
 assert.deepEqual(f.counts(),{creates:1,deletes:0});
 f.set(f.make(other));assert.equal((await f.c.enable({confirmed:true})).state,'key-changed');assert.equal(f.counts().creates,1);
 f.set(f.make(key,endpoint,999));assert.equal((await f.c.inspect()).state,'expired');
 assert.equal((await f.c.disable()).state,'confirmation-required');f.permission('denied');assert.equal((await f.c.disable({confirmed:true})).state,'absent');
 assert.deepEqual(f.counts(),{creates:1,deletes:1});
 f.set(f.make(key,'https://example.com/real'));assert.equal((await f.c.disable({confirmed:true})).state,'unknown');assert.equal(f.counts().deletes,1);
});
test('Pending operations are exclusive; late consent changes require reconciliation without auto deletion',async()=>{
 const f=fixture();let release,entered;
 const wait=new Promise(r=>release=r),started=new Promise(r=>entered=r),subscribe=f.adapter.subscribe;
 f.adapter.subscribe=async opts=>{entered();await wait;return subscribe(opts);};
 const work=f.c.enable({confirmed:true});await started;
 assert.equal((await f.c.enable({confirmed:true})).state,'busy');assert.equal((await f.c.disable({confirmed:true})).state,'busy');
 f.c.invalidate();release();assert.equal((await work).state,'reconcile-required');
 assert.deepEqual(f.counts(),{creates:1,deletes:0});assert.equal((await f.c.inspect()).state,'ready');
 f.c.close();assert.equal((await f.c.inspect()).state,'stale');
 const g=fixture();let read;g.adapter.getSubscription=()=>new Promise(r=>read=r);
 const pending=g.c.enable({confirmed:true});g.active(false);read(null);assert.equal((await pending).state,'stale');assert.equal(g.counts().creates,0);
});
