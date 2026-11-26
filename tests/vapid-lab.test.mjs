import test from 'node:test';
import assert from 'node:assert/strict';
import {createVapidKeyLab,vapidAuthorizationLab} from '../tools/prototypes/vapid-lab.mjs';
const endpoint='https://push.example.invalid/sub/00000000-0000-4000-8000-000000000001',now=1800000000;
const decode=s=>JSON.parse(Buffer.from(s,'base64url').toString('utf8'));
test('Synthetic VAPID signs exact audience and expiry using a separate nonextractable signing key',async()=>{
 const keyPair=await createVapidKeyLab();assert.equal(keyPair.privateKey.extractable,false);
 await assert.rejects(crypto.subtle.exportKey('jwk',keyPair.privateKey));
 const result=await vapidAuthorizationLab({endpoint,keyPair,now});
 const m=/^vapid t=([A-Za-z0-9_.-]+), k=([A-Za-z0-9_-]+)$/.exec(result.authorization);assert.ok(m);
 const [h,p,s]=m[1].split('.');assert.deepEqual(decode(h),{typ:'JWT',alg:'ES256'});
 assert.deepEqual(decode(p),{aud:'https://push.example.invalid',exp:now+600,sub:'mailto:lab@example.invalid'});
 assert.equal(result.expiresAt,now+600);
 const raw=Buffer.from(m[2],'base64url'),signature=Buffer.from(s,'base64url');assert.equal(raw.length,65);assert.equal(signature.length,64);
 const pub=await crypto.subtle.importKey('raw',raw,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 const verify=message=>crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,signature,new TextEncoder().encode(message));
 assert.equal(await verify(h+'.'+p),true);assert.equal(await verify(h+'.'+p+'x'),false);
});
test('Synthetic VAPID rejects real endpoints, invalid lifetimes, mismatched or ECDH keys',async()=>{
 const keyPair=await createVapidKeyLab(),other=await createVapidKeyLab();
 for(const bad of ['https://example.com/sub/a',endpoint+'?secret=x',endpoint.replace('https:','http:'),endpoint.replace('push.example.invalid','push.example.invalid.evil.test')])await assert.rejects(vapidAuthorizationLab({endpoint:bad,keyPair,now}),/synthetic/);
 for(const ttl of [0,-1,86401,1.5,NaN])await assert.rejects(vapidAuthorizationLab({endpoint,keyPair,now,ttl}),/expiry/);
 await assert.rejects(vapidAuthorizationLab({endpoint,keyPair:{publicKey:other.publicKey,privateKey:keyPair.privateKey},now}),/mismatch/);
 const ecdh=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
 await assert.rejects(vapidAuthorizationLab({endpoint,keyPair:ecdh,now}),/signing key/);
 assert.equal((await vapidAuthorizationLab({endpoint,keyPair,now,ttl:86400})).expiresAt,now+86400);
});
