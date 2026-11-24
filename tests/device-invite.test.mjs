import test from 'node:test';import assert from 'node:assert/strict';
import {createPersonalCode,personalCredentials} from '../js/personal-sync.js';
import {createDeviceInvite,redeemDeviceInvite,parseInvite,DEFAULT_INVITE_ENDPOINT} from '../js/device-invite.js';
import {createHash} from 'node:crypto';
test('one-time invitation transfers existing master code without exposing plaintext to relay',async()=>{
 const master=createPersonalCode(DEFAULT_INVITE_ENDPOINT),school=await personalCredentials(master,'school');
 let slot=null;
 const fetcher=async(url,init)=>{
  const body=JSON.parse(init.body);assert.ok(!init.body.includes(master));assert.ok(!url.includes(master));
  if(url.endsWith('/create')){assert.equal(init.headers.Authorization,'Bearer '+school.token);slot=body;return Response.json({status:'created'});}
  if(!slot||createHash('sha256').update(init.headers.Authorization.slice(7)).digest('hex')!==slot.verifier)return Response.json({}, {status:410});
  const envelope=slot.envelope;slot=null;return Response.json({envelope});
 };
 const invite=await createDeviceInvite(master,fetcher);assert.match(invite,/^TAC1\.[A-Za-z0-9_-]{22}$/);
 assert.ok(!invite.includes(master));assert.equal(parseInvite(invite).endpoint,DEFAULT_INVITE_ENDPOINT);
 assert.equal(await redeemDeviceInvite(invite,fetcher),master);
 await assert.rejects(redeemDeviceInvite(invite,fetcher),/истёк/);
});
test('invalid or insecure invite rejected',()=>{for(const code of ['','TAC1.123','TAP1.test','TAC1.'+'a'.repeat(801)])assert.throws(()=>parseInvite(code));});
