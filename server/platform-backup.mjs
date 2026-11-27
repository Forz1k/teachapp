/* Operator recovery rehearsal: authenticated encrypted data-only workspace
 * package, never copies bearer hashes, identities, invitations or push keys.
 * Restore only into an explicitly named empty workspace. */
const enc=new TextEncoder(),dec=new TextDecoder('utf-8',{fatal:true}),FORMAT='teachapp-platform-backup-v1';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const int=x=>Number.isSafeInteger(x)&&x>=0;
const exact=(v,k)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===k.slice().sort().join('|');
const b64=x=>{let s='';for(let i=0;i<x.length;i+=8192)s+=String.fromCharCode(...x.subarray(i,i+8192));return btoa(s).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');};
function decode(s,max){if(typeof s!=='string'||s.length>max||! /^[A-Za-z0-9_-]+$/.test(s))throw Error('encoding');const a=Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));if(b64(a)!==s)throw Error('encoding');return a;}
export const BACKUP_BODY_LIMIT=750*1024;
async function key(raw){
 if(typeof raw!=='string'||! /^[a-f0-9]{64}$/.test(raw))throw Error('backup-disabled');
 return crypto.subtle.importKey('raw',Uint8Array.from(raw.match(/../g),v=>parseInt(v,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
const aad=(source,createdAt)=>enc.encode(JSON.stringify([FORMAT,source,createdAt]));
export function workspaceBackupData(state){
 if(!state||!id(state.id))throw Error('workspace');
 return structuredClone({name:state.name,teams:state.teams,athletes:state.athletes,matches:state.matches.map(m=>({...m,lease:null,generation:m.generation+1})),audit:state.audit});
}
function valid(data){
 if(!exact(data,['name','teams','athletes','matches','audit'])||typeof data.name!=='string'||!data.name||data.name.length>100||!Array.isArray(data.teams)||data.teams.length>12||!Array.isArray(data.athletes)||data.athletes.length>768||!Array.isArray(data.matches)||data.matches.length>32||!Array.isArray(data.audit)||data.audit.length>200)return false;
 const unique=a=>new Set(a).size===a.length;
 if(!unique(data.teams.map(t=>t?.id))||!unique(data.matches.map(m=>m?.id))||!unique(data.athletes.map(a=>a?.teamId+'/'+a?.id)))return false;
 const teams=new Map();
 for(const t of data.teams){
  if(!exact(t,['id','name','players'])||!id(t.id)||typeof t.name!=='string'||!Array.isArray(t.players)||t.players.length>64||!unique(t.players.map(p=>p?.id))||t.players.some(p=>!exact(p,['id','name','number'])||!id(p.id)||typeof p.name!=='string'||!int(p.number)||p.number>99))return false;
  teams.set(t.id,new Set(t.players.map(p=>p.id)));
 }
 for(const a of data.athletes){
  if(!exact(a,['id','teamId','goals','assignments','schedule','revision','responses'])||!teams.get(a.teamId)?.has(a.id)||!int(a.revision)||!['goals','assignments','schedule','responses'].every(k=>Array.isArray(a[k])&&a[k].length<=32))return false;
  if(a.goals.some(g=>!exact(g,['id','name','status','to']))||a.assignments.some(g=>!exact(g,['id','name','due','status']))||a.schedule.some(g=>!exact(g,['id','date','time','title']))||a.responses.some(g=>!exact(g,['assignmentId','response','at'])))return false;
 }
 const score=s=>exact(s,['ours','theirs'])&&int(s.ours)&&int(s.theirs)&&s.ours<=999&&s.theirs<=999;
 for(const m of data.matches){
  if(!exact(m,['id','teamId','opponent','bestOf','target','decider','status','revision','set','score','sets','lease','generation','ops'])||!id(m.id)||!teams.has(m.teamId)||typeof m.opponent!=='string'||![3,5].includes(m.bestOf)||![15,21,25].includes(m.target)||![15,21,25].includes(m.decider)||!['live','finished'].includes(m.status)||!int(m.revision)||!int(m.set)||m.set<1||m.set>m.bestOf||!score(m.score)||!Array.isArray(m.sets)||m.sets.length>m.bestOf||m.sets.some(s=>!score(s))||m.lease!==null||!int(m.generation)||!Array.isArray(m.ops)||m.ops.length>5000||m.ops.some(o=>!exact(o,['id','actorId','generation','expectedRevision','op','side','revision'])))return false;
 }
 return data.audit.every(a=>exact(a,['at','actorId','action','target'])&&int(a.at)&&id(a.actorId)&&typeof a.action==='string'&&typeof a.target==='string');
}
export async function sealWorkspaceBackup(state,rawKey,createdAt=Date.now()){
 if(!int(createdAt))throw Error('time');
 const data=workspaceBackupData(state);if(!valid(data))throw Error('schema');
 const plain=enc.encode(JSON.stringify(data));if(plain.length>512*1024)throw Error('size');
 const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(state.id,createdAt)},await key(rawKey),plain);
 return {format:FORMAT,source:state.id,createdAt,iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))};
}
export async function openWorkspaceBackup(packet,rawKey,expectedSource){
 if(!exact(packet,['format','source','createdAt','iv','ciphertext'])||packet.format!==FORMAT||!id(expectedSource)||packet.source!==expectedSource||!int(packet.createdAt))throw Error('packet');
 const iv=decode(packet.iv,32),cipher=decode(packet.ciphertext,BACKUP_BODY_LIMIT);if(iv.length!==12||cipher.length<17||cipher.length>512*1024+16)throw Error('size');
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(packet.source,packet.createdAt)},await key(rawKey),cipher);
 const data=JSON.parse(dec.decode(plain));if(!valid(data))throw Error('schema');return data;
}
export function restoreWorkspaceData(bootstrapped,data,now){
 if(!bootstrapped?.state||!valid(data)||!int(now))throw Error('restore');
 const s=bootstrapped.state;
 if(s.members.length!==1||s.teams.length||s.athletes.length||s.matches.length||s.invites.length)throw Error('not empty');
 const owner=s.members[0];s.name=data.name;s.teams=structuredClone(data.teams);s.athletes=structuredClone(data.athletes);s.matches=structuredClone(data.matches);
 s.audit=structuredClone(data.audit).slice(-199).concat({at:now,actorId:owner.id,action:'workspace.restore',target:s.id});
 if(enc.encode(JSON.stringify(s)).length>512*1024)throw Error('workspace-limit');
 return bootstrapped;
}
