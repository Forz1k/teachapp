import test from 'node:test';import assert from 'node:assert/strict';import {platformClient,platformEndpoint,isLocalPlatformPage} from '../js/platform-client.js';
const local=new URL('http://127.0.0.1:8099/platform-dev/'),secret='a'.repeat(64);
test('sandbox client is loopback only, never puts token in URL or browser storage',async()=>{assert.equal(isLocalPlatformPage(local),true);assert.equal(isLocalPlatformPage(new URL('https://forz1k.github.io/teachapp/')),false);for(const x of ['https://evil.test','http://127.0.0.1@evil.test','http://127.0.0.1:8788/path','http://localhost:8788/?x=1'])assert.throws(()=>platformEndpoint(x));const calls=[];const api=platformClient('http://127.0.0.1:8788','demo',secret,{location:local,fetcher:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({member:{id:'x'}}),{status:200});}});assert.deepEqual(await api.request('me'),{member:{id:'x'}});assert.equal(calls[0].options.headers.Authorization,'Bearer '+secret);assert.ok(!calls[0].url.includes(secret));assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');await assert.rejects(api.request('../bad'));api.close();await assert.rejects(api.request('me'));assert.throws(()=>platformClient('http://127.0.0.1:8788','demo',secret,{location:new URL('https://example.test')}));});

test('Client surfaces bounded Retry-After without automatically replaying a write',async()=>{let calls=0;const api=platformClient('http://127.0.0.1:8788','demo',secret,{location:local,fetcher:async()=>{calls++;return new Response(JSON.stringify({error:'rate-limit'}),{status:429,headers:{'Retry-After':'12'}});}});await assert.rejects(api.request('invite','POST',{}),e=>e.status===429&&e.retryAfter===12);assert.equal(calls,1);});

test('Closing a session aborts every pending request and discards late fetch results',async()=>{
 const calls=[];const api=platformClient('http://127.0.0.1:8788','demo',secret,{location:local,fetcher:(_url,options)=>new Promise(resolve=>calls.push({signal:options.signal,resolve}))});
 const first=api.request('me'),second=api.request('teams');const checked=Promise.all([assert.rejects(first,/Сессия закрыта/),assert.rejects(second,/Сессия закрыта/)]);
 api.close();api.close();assert.equal(calls.length,2);assert.ok(calls.every(c=>c.signal.aborted));for(const c of calls)c.resolve(new Response('{}'));
 await checked;await assert.rejects(api.request('me'),/Сессия закрыта/);assert.equal(calls.length,2);
});
test('Closing while decoding a response discards the old session payload',async()=>{
 let resolveBody,signal;const api=platformClient('http://127.0.0.1:8788','demo',secret,{location:local,fetcher:async(_url,options)=>{signal=options.signal;return {ok:true,json:()=>new Promise(resolve=>{resolveBody=resolve;})};}});
 const request=api.request('me');const checked=assert.rejects(request,/Сессия закрыта/);await Promise.resolve();assert.equal(typeof resolveBody,'function');api.close();assert.equal(signal.aborted,true);resolveBody({member:{id:'old-session'}});await checked;
});
