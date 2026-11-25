/* Foreground sync; never runs from service worker or while another updated tab is active. */
import {syncAreas,relayClient,syncPersonalArea} from './sync.js';
import {readSyncIdentity,identityCredentials,identityAreas} from './device-trust.js';
let last={phase:'idle',areas:[],at:null},activeSession=null;
export const withSyncSession=task=>activeSession?activeSession.exclusive(task):task();
export const autoSyncStatus=()=>({...last,areas:last.areas.map(x=>({...x}))});
export async function runPersonalSync({getCode=readSyncIdentity,online=()=>globalThis.navigator?.onLine!==false,clientFactory=relayClient,runArea=syncPersonalArea,initialize=false}={}){
 // Do not replace an active attempt with a concurrent offline/disconnected request.
 if(last.phase==='running')return autoSyncStatus();
 const code=getCode();
 if(!code){last={phase:'off',areas:[],at:null};return autoSyncStatus();}
 if(!online()){last={phase:'offline',areas:[],at:null};return autoSyncStatus();}
 last={phase:'running',areas:[],at:null};
 const areas=[];
 const stillAllowed=()=>getCode()===code&&online();
 for(const area of identityAreas(code)){
  if(!stillAllowed()){areas.push({area,status:'paused'});continue;}
  try{
   const credentials=await identityCredentials(code,area);
   if(!stillAllowed()){areas.push({area,status:'paused'});continue;}
   const client=clientFactory(credentials.endpoint,area,credentials.token,{timeoutMs:7000,...(credentials.protocolVersion===2?{protocolVersion:2}:{})});
   const result=await runArea({...credentials,client,initialize,stillAllowed});
   areas.push(result.status==='synced'?{...result,successfulAt:new Date().toISOString()}:result);
  }catch(error){const allowed=stillAllowed();areas.push({area,status:allowed?'error':'paused',...(allowed&&error?.retryable===true?{retryable:true}:{})});}
 }
 last={phase:stillAllowed()?'finished':'interrupted',areas,at:new Date().toISOString()};
 return autoSyncStatus();
}
// At most two expedited attempts per transient outage; normal foreground polling
// remains responsible for longer outages. Always obtain a fresh revision on retry.
export function syncRetryDelay(report,attempt=0){
 if(report?.phase!=='finished'||!report.areas?.some(x=>x.status==='error'&&x.retryable===true)||!Number.isInteger(attempt)||attempt<0)return null;
 return [5000,15000][attempt]??null;
}
// All updated tabs hold shared session locks before loading the database.
// To sync, temporarily release this tab's shared lock and acquire an exclusive lock.
// Browsers without Web Locks retain explicit manual synchronization.
export async function openSyncSession(locks=globalThis.navigator?.locks,scope='teachapp-db-v1'){
 if(!locks?.request)return null;
 let release,held,working=false;
 const acquire=()=>new Promise((resolve,reject)=>{
  held=locks.request(scope,{mode:'shared'},()=>new Promise(done=>{release=done;resolve();}));
  held.catch(reject);
 });
 await acquire();
 const session={async exclusive(task){
  if(working)return null;
  working=true;
  try{
   release();
   await held; // Wait until the browser has actually released this tab's shared lock.
   return await locks.request(scope,{mode:'exclusive',ifAvailable:true},lock=>lock?task():null);
  }finally{
   try{await acquire();}finally{working=false;}
  }
 }};
 activeSession=session;return session;
}
