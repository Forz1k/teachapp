/* Foreground sync; never runs from service worker or while another updated tab is active. */
import {syncAreas,relayClient,syncPersonalArea} from './sync.js';
import {readPersonalCode,personalCredentials} from './personal-sync.js';
let last={phase:'idle',areas:[],at:null},activeSession=null;
export const withSyncSession=task=>activeSession?activeSession.exclusive(task):task();
export const autoSyncStatus=()=>({...last,areas:last.areas.map(x=>({...x}))});
export async function runPersonalSync({getCode=readPersonalCode,online=()=>globalThis.navigator?.onLine!==false,clientFactory=relayClient,runArea=syncPersonalArea}={}){
 const code=getCode();
 if(!code)return {phase:'off',areas:[],at:null};
 if(!online())return {phase:'offline',areas:[],at:null};
 if(last.phase==='running')return last;
 last={phase:'running',areas:[],at:null};
 const areas=[];
 for(const area of Object.keys(syncAreas)){
  if(getCode()!==code||!online())break;
  try{
   const credentials=await personalCredentials(code,area);
   if(getCode()!==code||!online())break;
   const client=clientFactory(credentials.endpoint,area,credentials.token,{timeoutMs:7000});
   areas.push(await runArea({...credentials,client,stillAllowed:()=>getCode()===code&&online()}));
  }catch{areas.push({area,status:'error'});}
 }
 last={phase:'finished',areas,at:new Date().toISOString()};
 return autoSyncStatus();
}
// All updated tabs hold shared session locks before loading the database.
// To sync, temporarily release this tab's shared lock and acquire an exclusive lock.
// Browsers without Web Locks retain explicit manual synchronization.
export async function openSyncSession(locks=globalThis.navigator?.locks,scope='teachapp-db-v1'){
 if(!locks?.request)return null;
 let release,working=false;
 const acquire=()=>new Promise((resolve,reject)=>{
  locks.request(scope,{mode:'shared'},()=>new Promise(done=>{release=done;resolve();})).catch(reject);
 });
 await acquire();
 const session={async exclusive(task){
  if(working)return null;
  working=true;
  try{
   release();
   return await locks.request(scope,{mode:'exclusive',ifAvailable:true},lock=>lock?task():null);
  }finally{
   try{await acquire();}finally{working=false;}
  }
 }};
 activeSession=session;return session;
}
