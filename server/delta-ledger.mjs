/* Opaque ledger for the synthetic delta relay. Never decrypts. Explicit privileged compaction replaces the anchor atomically. */
import {LIMIT} from './cloudflare-protocol.mjs';
export const MAX_DELTA_ENTRIES=128, MAX_LEDGER_BYTES=16*1024*1024;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const b64=(v,pattern)=>typeof v==='string'&&pattern.test(v);
const utf8=new TextEncoder();
export function normalizeDeltaWrite(body){
 if(!exact(body,['expectedRevision','envelope'])||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||body.expectedRevision>=Number.MAX_SAFE_INTEGER)return null;
 const e=body.envelope;
 if(!exact(e,['app','version','kdf','iterations','cipher','salt','iv','data'])||e.app!=='teachapp-encrypted'||e.version!==1||e.kdf!=='PBKDF2-SHA256'||e.iterations!==600000||e.cipher!=='AES-256-GCM'||
 !b64(e.salt,/^[A-Za-z0-9+/]{22}==$/)||!b64(e.iv,/^[A-Za-z0-9+/]{16}$/)||typeof e.data!=='string'||e.data.length<24||e.data.length>LIMIT||e.data.length%4!==0||!b64(e.data,/^[A-Za-z0-9+/]+={0,2}$/))return null;
 const envelope={app:e.app,version:e.version,kdf:e.kdf,iterations:e.iterations,cipher:e.cipher,salt:e.salt,iv:e.iv,data:e.data};
 const serialized=JSON.stringify(envelope),bytes=utf8.encode(JSON.stringify({expectedRevision:body.expectedRevision,envelope})).length;
 if(bytes>LIMIT)return null;
 return {expectedRevision:body.expectedRevision,serialized,bytes};
}
// This decision must be evaluated within the same transaction as the append.
export function decideDeltaWrite({revision,count,bytes},kind,packet,last){
 if(!packet||!['anchor','delta','compact','rotate'].includes(kind))return {status:400,error:'packet'};
 const wanted=packet.expectedRevision+1;
 if(revision===wanted&&last?.revision===wanted&&last.kind===(['compact','rotate'].includes(kind)?'anchor':kind)&&last.serialized===packet.serialized&&(kind!=='compact'||packet.expectedRevision>0))
  return {status:200,revision,replayed:true};
 if(packet.expectedRevision!==revision)return {status:409,error:'revision-conflict'};
 if((kind==='anchor'&&revision!==0)||(kind!=='anchor'&&revision===0))return {status:409,error:'anchor-required-or-exists'};
 // Compaction is allowed even at the history cap. It has a separate credential.
 if(kind==='rotate')return packet.bytes<=MAX_LEDGER_BYTES?{status:201,revision:wanted,replayed:false,compact:true}:{status:507,error:'ledger-full'};
 if(kind==='compact'){
  if(count<2)return {status:409,error:'no-history-to-compact'};
  return {status:201,revision:wanted,replayed:false,compact:true};
 }
 if(count>=MAX_DELTA_ENTRIES+1||bytes+packet.bytes>MAX_LEDGER_BYTES)return {status:507,error:'ledger-full'};
 return {status:201,revision:wanted,replayed:false};
}
