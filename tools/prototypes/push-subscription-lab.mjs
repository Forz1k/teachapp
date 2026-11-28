/* Injected subscription adapter for a synthetic localhost fixture only.
 * No implicit browser permission prompt, actual PushManager or server write. */
const endpointPattern=/^https:\/\/push\.example\.invalid\/sub\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const bytes=(v,n)=>v instanceof Uint8Array&&v.length===n;
const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const snapshot=s=>{
 if(!s)return null;
 const endpoint=s.endpoint;
 check(typeof endpoint==='string'&&endpointPattern.test(endpoint),'Only synthetic subscription endpoint is allowed');
 const read=(v,n)=>{check(v instanceof ArrayBuffer&&v.byteLength===n,'Invalid subscription key');return new Uint8Array(v.slice(0));};
 const publicKey=read(s.getKey('p256dh'),65),auth=read(s.getKey('auth'),16),serverKey=read(s.options?.applicationServerKey,65);
 check(publicKey[0]===4&&serverKey[0]===4&&s.options.userVisibleOnly===true,'Invalid subscription options');
 const expiresAt=s.expirationTime;
 check(expiresAt===null||Number.isSafeInteger(expiresAt)&&expiresAt>=0,'Invalid subscription expiry');
 return {endpoint,publicKey,auth,serverKey,expiresAt};
};
export function subscriptionLifecycleLab({adapter,applicationServerKey,permission=()=> 'default',active=()=>false,now=()=>Date.now()}){
 check(adapter&&adapter.synthetic===true&&typeof adapter.getSubscription==='function'&&typeof adapter.subscribe==='function','Injected synthetic subscription adapter required');
 check(bytes(applicationServerKey,65)&&applicationServerKey[0]===4,'Invalid VAPID key');
 const key=applicationServerKey.slice();
 let busy=false,closed=false,generation=0;
 const valid=()=>{try{return !closed&&active()===true;}catch{return false;}};
 const granted=()=>{try{return permission()==='granted';}catch{return false;}};
 const describe=s=>{
  const p=snapshot(s);if(!p)return {state:'absent'};
  if(!equal(p.serverKey,key))return {state:'key-changed'};
  const time=now();check(Number.isSafeInteger(time)&&time>=0,'Invalid clock');
  if(p.expiresAt!==null&&p.expiresAt<=time)return {state:'expired'};
  return {state:'ready'};
 };
 const op=async fn=>{
  if(busy)return {state:'busy'};
  if(!valid())return {state:'stale'};
  busy=true;const epoch=generation;
  const current=()=>valid()&&epoch===generation;
  try{return await fn(current);}catch{return {state:current()?'unknown':'stale'};}finally{busy=false;}
 };
 return {
  inspect:()=>op(async current=>{const s=await adapter.getSubscription();return current()?describe(s):{state:'stale'};}),
  enable:({confirmed=false}={})=>op(async current=>{
   if(confirmed!==true||!granted())return {state:'permission-required'};
   const existing=await adapter.getSubscription();
   if(!current()||!granted())return {state:'stale'};
   if(existing)return describe(existing); // Never silently replace an existing subscription.
   const created=await adapter.subscribe({userVisibleOnly:true,applicationServerKey:key.slice()});
   if(!current()||!granted())return {state:'reconcile-required'}; // Unknown ownership; never destructive auto-cleanup.
   if(!created)return {state:'unknown'};
   return describe(created);
  }),
  disable:({confirmed=false}={})=>op(async current=>{
   if(confirmed!==true)return {state:'confirmation-required'};
   const s=await adapter.getSubscription();if(!current())return {state:'stale'};
   if(!s)return {state:'absent'};
   snapshot(s); // Do not touch an unrecognized or real endpoint.
   if(!current())return {state:'stale'};
   const removed=await s.unsubscribe();
   if(!current())return {state:'reconcile-required'};
   // Even false may mean another actor already removed it. Read back.
   const after=await adapter.getSubscription();
   if(!current())return {state:'reconcile-required'};
   if(!after)return {state:'absent'};
   return {state:removed===true?'reconcile-required':'still-subscribed'};
  }),
  invalidate(){generation++;},
  close(){closed=true;generation++;key.fill(0);}
 };
}
