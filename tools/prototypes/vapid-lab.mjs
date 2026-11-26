/* Synthetic RFC 8292 authentication rehearsal, no network or persistent keys.
 * Only a reserved .invalid push origin is accepted. */
const encoder=new TextEncoder(),algorithm={name:'ECDSA',namedCurve:'P-256'},signing={name:'ECDSA',hash:'SHA-256'};
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const json=value=>b64(encoder.encode(JSON.stringify(value)));
const endpointPattern=/^https:\/\/push\.example\.invalid\/sub\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function createVapidKeyLab(){
 return crypto.subtle.generateKey(algorithm,false,['sign','verify']);
}
export async function vapidAuthorizationLab({endpoint,keyPair,now,ttl=600}){
 check(typeof endpoint==='string'&&endpointPattern.test(endpoint),'Only synthetic endpoint is allowed');
 check(Number.isSafeInteger(now)&&now>=0&&Number.isSafeInteger(ttl)&&ttl>0&&ttl<=86400&&Number.isSafeInteger(now+ttl),'Invalid expiry');
 const {publicKey,privateKey}=keyPair??{};
 check(publicKey?.type==='public'&&privateKey?.type==='private'&&publicKey.algorithm.name==='ECDSA'&&privateKey.algorithm.name==='ECDSA'&&publicKey.algorithm.namedCurve==='P-256'&&privateKey.algorithm.namedCurve==='P-256'&&!privateKey.extractable,'Invalid signing key');
 const raw=new Uint8Array(await crypto.subtle.exportKey('raw',publicKey));
 check(raw.length===65&&raw[0]===4,'Invalid public key');
 const unsigned=json({typ:'JWT',alg:'ES256'})+'.'+json({aud:new URL(endpoint).origin,exp:now+ttl,sub:'mailto:lab@example.invalid'});
 const message=encoder.encode(unsigned),signature=new Uint8Array(await crypto.subtle.sign(signing,privateKey,message));
 check(signature.length===64&&await crypto.subtle.verify(signing,publicKey,signature,message),'Signing key mismatch');
 return {authorization:'vapid t='+unsigned+'.'+b64(signature)+', k='+b64(raw),expiresAt:now+ttl};
}
