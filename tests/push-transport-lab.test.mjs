import test from 'node:test';
import assert from 'node:assert/strict';
import {deliverGenericPushLab,classifyPushResponseLab} from '../tools/prototypes/push-transport-lab.mjs';
import {createVapidKeyLab} from '../tools/prototypes/vapid-lab.mjs';
const endpoint='https://push.example.invalid/sub/00000000-0000-4000-8000-000000000001',now=1800000000;
async function fixture(){
 const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);
 return {endpoint,receiverPublic:new Uint8Array(await crypto.subtle.exportKey('raw',receiver.publicKey)),auth:crypto.getRandomValues(new Uint8Array(16)),keyPair:await createVapidKeyLab(),now,expiresAt:now+900,stillCurrent:()=>true};
}
test('Synthetic transport composes encryption and VAPID, one attempt and no response content',async()=>{
 const f=await fixture(),sent=[];
 const result=await deliverGenericPushLab({...f,transport:async(url,request)=>{sent.push({url,request});return {status:201,get body(){throw Error('Must not read');}};}});
 assert.deepEqual(result,{outcome:'accepted',retryAfter:null});assert.equal(sent.length,1);
 const {url,request}=sent[0];assert.equal(url,endpoint);assert.equal(request.method,'POST');assert.equal(request.redirect,'error');assert.equal(request.headers.TTL,'900');assert.equal(request.headers['Content-Encoding'],'aes128gcm');assert.equal(request.headers.Topic,'teachapp-workspace-update');
 assert.match(request.headers.Authorization,/^vapid t=/);assert.equal(request.body[20],65);assert.equal(new DataView(request.body.buffer).getUint32(16),4096);
 assert.doesNotMatch(JSON.stringify(result),/vapid|example.invalid/);
 let calls=0;
 const transport=async()=>{calls++;throw Error('PRIVATE endpoint');};
 assert.deepEqual(await deliverGenericPushLab({...f,transport}),{outcome:'unknown',retryAfter:null});assert.equal(calls,1);
 assert.deepEqual(await deliverGenericPushLab({...f,expiresAt:now,transport}),{outcome:'cancelled',retryAfter:null});
 assert.deepEqual(await deliverGenericPushLab({...f,stillCurrent:()=>false,transport}),{outcome:'cancelled',retryAfter:null});
 let checks=0;assert.deepEqual(await deliverGenericPushLab({...f,stillCurrent:()=>++checks===1,transport}),{outcome:'cancelled',retryAfter:null});assert.equal(calls,1);
 await assert.rejects(deliverGenericPushLab({...f,endpoint:'https://example.com/real',transport}),/synthetic/);assert.equal(calls,1);
});
test('Push response classification preserves uncertainty, gone subscriptions and bounded retry hints',()=>{
 const classify=(status,header=null,ttl=900)=>classifyPushResponseLab({status,headers:{get:()=>header}},{now,ttl});
 for(const status of [201,202])assert.equal(classify(status).outcome,'accepted');
 for(const status of [404,410])assert.equal(classify(status).outcome,'subscription-gone');
 for(const status of [401,403])assert.equal(classify(status).outcome,'authorization-error');
 assert.equal(classify(413).outcome,'payload-error');assert.equal(classify(302).outcome,'rejected');assert.equal(classify(500).outcome,'unknown');
 assert.deepEqual(classify(429,'120'),{outcome:'retry-later',retryAfter:120});
 assert.equal(classify(503,new Date((now+90)*1000).toUTCString()).retryAfter,90);
 assert.equal(classify(429,'900').retryAfter,null);assert.equal(classify(429,'3601',7200).retryAfter,null);
 assert.equal(classify(429,'0').retryAfter,1);assert.equal(classify(429,'garbage').retryAfter,60);assert.equal(classify(503,null,60).retryAfter,null);
});
