/* RFC 8291 / RFC 8188 single-record encryption rehearsal.
 * No endpoints, network, stored credentials or live sender. */
const encoder=new TextEncoder(),rs=4096,headerSize=86,maxPayload=4096-headerSize-17;
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const bytes=(v,n)=>v instanceof Uint8Array&&v.length===n;
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of parts){out.set(p,pos);pos+=p.length;}return out;};
const info=(s)=>encoder.encode(s+'\0');
const ecdh={name:'ECDH',namedCurve:'P-256'};
async function derive(ikm,salt,context,bits){
 const key=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info:context},key,bits));
}
// Deterministic entry point solely for public standard vector testing.
// Caller MUST NOT reuse a sender key/salt in real messages.
export async function sealPushRecordVectorLab({payload,receiverPublic,auth,sender,salt}){
 check(payload instanceof Uint8Array&&payload.length<=maxPayload,'Invalid payload size');
 check(bytes(receiverPublic,65)&&receiverPublic[0]===4&&bytes(auth,16)&&bytes(salt,16),'Invalid subscription key or salt');
 check(sender?.privateKey?.algorithm?.name==='ECDH'&&sender.privateKey.algorithm.namedCurve==='P-256'&&sender.publicKey?.algorithm?.name==='ECDH'&&sender.publicKey.algorithm.namedCurve==='P-256','Invalid sender key');
 // Copy all caller-owned arrays before any asynchronous operation.
 payload=payload.slice();receiverPublic=receiverPublic.slice();auth=auth.slice();salt=salt.slice();
 const receiver=await crypto.subtle.importKey('raw',receiverPublic,ecdh,false,[]);
 const senderPublic=new Uint8Array(await crypto.subtle.exportKey('raw',sender.publicKey));
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:receiver},sender.privateKey,256));
 const ikm=await derive(shared,auth,concat(info('WebPush: info'),receiverPublic,senderPublic),256);
 const cek=await derive(ikm,salt,info('Content-Encoding: aes128gcm'),128);
 const nonce=await derive(ikm,salt,info('Content-Encoding: nonce'),96);
 const aes=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},aes,concat(payload,Uint8Array.of(2))));
 const header=new Uint8Array(headerSize);header.set(salt);new DataView(header.buffer).setUint32(16,rs);header[20]=65;header.set(senderPublic,21);
 return concat(header,encrypted);
}
// Only a fixed generic signal, never an arbitrary personal message.
export async function sealGenericPushLab({receiverPublic,auth}){
 check(bytes(receiverPublic,65)&&receiverPublic[0]===4&&bytes(auth,16),'Invalid subscription key');
 receiverPublic=receiverPublic.slice();auth=auth.slice();
 const sender=await crypto.subtle.generateKey(ecdh,false,['deriveBits']);
 const salt=crypto.getRandomValues(new Uint8Array(16));
 return sealPushRecordVectorLab({payload:encoder.encode(JSON.stringify({version:1,kind:'workspace-update'})),receiverPublic,auth,sender,salt});
}
