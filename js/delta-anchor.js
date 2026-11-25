/* Bounded opaque multipart anchors for the isolated Delta LAB.
 * The original AES-GCM envelope is preserved byte-for-byte. Hashes detect
 * missing/reordered/corrupt ciphertext; authentication remains AES-GCM and
 * the existing encrypted area/workspace/revision packet validation. */
export const DELTA_PART_SIZE=512*1024,DELTA_MAX_PARTS=30,DELTA_MAX_DATA=DELTA_PART_SIZE*DELTA_MAX_PARTS;
const fields=['app','version','kdf','iterations','cipher','salt','iv'];
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hashPattern=/^[a-f0-9]{64}$/;
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const encoder=new TextEncoder();
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const b64=(s,last)=>typeof s==='string'&&(last?/^[A-Za-z0-9+/]+={0,2}$/:/^[A-Za-z0-9+/]+$/).test(s);
function headerOf(e){
 if(!exact(e,fields)||e.app!=='teachapp-encrypted'||e.version!==1||e.kdf!=='PBKDF2-SHA256'||e.iterations!==600000||e.cipher!=='AES-256-GCM'||
 typeof e.salt!=='string'||!/^[A-Za-z0-9+/]{22}==$/.test(e.salt)||typeof e.iv!=='string'||!/^[A-Za-z0-9+/]{16}$/.test(e.iv))return null;
 return Object.fromEntries(fields.map(k=>[k,e[k]]));
}
export async function deltaPartHash(text){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function normalizeRotationHashes(r){
 if(!exact(r,['readHashes','compactHash'])||!Array.isArray(r.readHashes)||r.readHashes.length<1||r.readHashes.length>8||
 !r.readHashes.every(h=>typeof h==='string'&&hashPattern.test(h))||typeof r.compactHash!=='string'||!hashPattern.test(r.compactHash)||
 new Set([...r.readHashes,r.compactHash]).size!==r.readHashes.length+1)return null;
 return {readHashes:[...r.readHashes].sort(),compactHash:r.compactHash};
}
export function normalizeAnchorManifest(m){
 const rotation=m?.kind==='rotate'?normalizeRotationHashes(m.rotation):null;
 if(!exact(m,['app','version','kind','expectedRevision','header','dataLength','parts',...(m?.kind==='rotate'?['rotation']:[])])||(m.kind==='rotate'&&!rotation)||m.app!=='teachapp-delta-multipart'||m.version!==1||
 !['anchor','compact','rotate'].includes(m.kind)||!integer(m.expectedRevision)||m.expectedRevision>=Number.MAX_SAFE_INTEGER||
 (m.kind==='anchor'?m.expectedRevision!==0:m.expectedRevision===0)||
 !integer(m.dataLength)||m.dataLength<(m.kind==='rotate'?24:DELTA_PART_SIZE+1)||m.dataLength>DELTA_MAX_DATA||m.dataLength%4!==0||
 !Array.isArray(m.parts)||m.parts.length!==Math.ceil(m.dataLength/DELTA_PART_SIZE)||m.parts.length>DELTA_MAX_PARTS)return null;
 const header=headerOf(m.header);if(!header)return null;
 const parts=[];
 for(let i=0;i<m.parts.length;i++){
  const p=m.parts[i],size=Math.min(DELTA_PART_SIZE,m.dataLength-i*DELTA_PART_SIZE);
  if(!exact(p,['size','hash'])||p.size!==size||typeof p.hash!=='string'||!hashPattern.test(p.hash))return null;
  parts.push({size,hash:p.hash});
 }
 return {app:m.app,version:1,kind:m.kind,expectedRevision:m.expectedRevision,header,dataLength:m.dataLength,parts,...(rotation?{rotation}:{})};
}
export async function anchorUploadId(m){
 const manifest=normalizeAnchorManifest(m);check(manifest,'Некорректный манифест снимка');
 return deltaPartHash(JSON.stringify(manifest));
}
export async function verifyAnchorPart(m,index,data){
 const manifest=normalizeAnchorManifest(m),p=manifest?.parts[index];
 check(Number.isInteger(index)&&index>=0&&p&&typeof data==='string'&&data.length===p.size&&b64(data,index===manifest.parts.length-1),'Некорректная часть снимка');
 check(await deltaPartHash(data)===p.hash,'Контрольная сумма части не совпадает');
 return data;
}
export async function splitDeltaAnchor(envelope,{kind='anchor',expectedRevision=0,rotation}={}){
 check(exact(envelope,[...fields,'data']),'Некорректный зашифрованный снимок');
 const header=headerOf(Object.fromEntries(fields.map(k=>[k,envelope[k]]))),data=envelope.data;
 check(header&&typeof data==='string'&&data.length>=(kind==='rotate'?24:DELTA_PART_SIZE+1)&&data.length<=DELTA_MAX_DATA&&data.length%4===0&&b64(data,true),'Снимок не помещается в ограниченный multipart Delta LAB');
 const chunks=[];for(let i=0;i<data.length;i+=DELTA_PART_SIZE)chunks.push(data.slice(i,i+DELTA_PART_SIZE));
 const parts=[];for(const chunk of chunks)parts.push({size:chunk.length,hash:await deltaPartHash(chunk)});
 const manifest=normalizeAnchorManifest({app:'teachapp-delta-multipart',version:1,kind,expectedRevision,header,dataLength:data.length,parts,...(kind==='rotate'?{rotation}:{})});
 check(manifest,'Некорректная ревизия снимка');
 return {uploadId:await anchorUploadId(manifest),manifest,chunks};
}
export async function joinDeltaAnchor(raw,uploadId,readPart){
 const manifest=normalizeAnchorManifest(raw);
 check(manifest&&typeof uploadId==='string'&&hashPattern.test(uploadId)&&await anchorUploadId(manifest)===uploadId,'Манифест снимка подменён');
 const chunks=[];
 for(let i=0;i<manifest.parts.length;i++)chunks.push(await verifyAnchorPart(manifest,i,await readPart(i)));
 const data=chunks.join('');check(data.length===manifest.dataLength,'Неполный снимок');
 return {...manifest.header,data};
}

// Commitment to the actual stored revision-1 anchor; multipart uses the verified
// manifest ID, so neither worker needs to assemble the entire large ciphertext.
export async function singleDeltaAnchorCommitment(envelope){
 check(exact(envelope,[...fields,'data']),'Некорректный снимок назначения');
 return 'single:'+await deltaPartHash(JSON.stringify([...fields,'data'].map(k=>envelope[k])));
}
export async function migrationAnchorCommitment(envelope,packetLimit=1024*1024){
 if(encoder.encode(JSON.stringify({expectedRevision:0,envelope})).length<=packetLimit)return singleDeltaAnchorCommitment(envelope);
 return 'multipart:'+(await splitDeltaAnchor(envelope,{kind:'anchor',expectedRevision:0})).uploadId;
}
