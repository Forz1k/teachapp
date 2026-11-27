/* Exact bundled HTTPS candidate in local workerd. All provider requests
 * intercepted; no cloud configuration, actual identity provider or real data. */
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readdir,readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as sleep} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {digestToken} from '../server/cloudflare-protocol.mjs';
const [bundle]=process.argv.slice(2),entries=(await readdir(bundle)).filter(n=>/\.(m?js)$/.test(n));assert.equal(entries.length,1);
const originalScript=await readFile(resolve(bundle,entries[0]),'utf8'),dir=await mkdtemp(join(tmpdir(),'teachapp-platform-candidate-'));
// Diagnostic only: ephemeral synthetic credentials and intercepted endpoint. Never used to authorize integration.
const script=originalScript.replace(/console\.warn\((["'])Platform provider response unknown:\1,\s*category\)/, 'console.warn("Synthetic transport exception:", e.name, e.message)');
assert.notEqual(script,originalScript,'Diagnostic instrumentation anchor');
const apiOrigin='https://platform-api.example.invalid',origin='https://platform-ui.example.invalid',issuer='https://identity.example.invalid/',audience='teachapp-candidate',clientId='candidate-test';
const random=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'),root=random(),backup=random(),storage=random();
const signing=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pub=await crypto.subtle.exportKey('jwk',signing.publicKey),vapid=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),vapidJwk=await crypto.subtle.exportKey('jwk',vapid.privateKey);
const bindings={TEACHAPP_PLATFORM_STAGE:'candidate',TEACHAPP_PLATFORM_ORIGIN:origin,TEACHAPP_PLATFORM_API_ORIGIN:apiOrigin,TEACHAPP_PLATFORM_ROOT_HASH:await digestToken(root),TEACHAPP_PLATFORM_OPERATOR_IDENTITY:await digestToken(JSON.stringify([issuer,'owner'])),TEACHAPP_PLATFORM_IDENTITY:JSON.stringify({issuer,audience,clientId,key:{kty:'RSA',kid:'candidate',n:pub.n,e:pub.e,alg:'RS256',use:'sig'}}),TEACHAPP_PLATFORM_BACKUP_KEY:backup,TEACHAPP_PLATFORM_PUSH_ENABLED:'true',TEACHAPP_PLATFORM_PUSH_STORAGE_KEY:storage,TEACHAPP_PLATFORM_PUSH_CONTACT:'mailto:lab@example.invalid',TEACHAPP_PLATFORM_PUSH_PROVIDERS:JSON.stringify([{origin:'https://fcm.googleapis.com',prefix:'/fcm/send/'}]),TEACHAPP_PLATFORM_VAPID_PRIVATE_JWK:JSON.stringify(Object.fromEntries(['kty','crv','x','y','d'].map(k=>[k,vapidJwk[k]])))};
const b64=v=>Buffer.from(v).toString('base64url'),encode=v=>b64(JSON.stringify(v));
async function token(sub,extra={}){
 const t=Math.floor(Date.now()/1000),unsigned=encode({alg:'RS256',kid:'candidate',typ:'at+jwt'})+'.'+encode({iss:issuer,aud:audience,client_id:clientId,sub,jti:crypto.randomUUID(),iat:t,exp:t+300,...extra});
 return unsigned+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',signing.privateKey,new TextEncoder().encode(unsigned)));
}
const endpoint='https://fcm.googleapis.com/fcm/send/synthetic-candidate',sent=[];
const mf=new Miniflare(convertV4MiniflareOptions({name:'teachapp-platform-candidate',modules:true,script,compatibilityDate:'2026-11-01',bindings,durableObjects:{WORKSPACES:{className:'PlatformWorkspace',useSQLite:true},INGRESS:{className:'PlatformIngress',useSQLite:true}},ratelimits:{EDGE_LIMIT:{namespace_id:'80000601',simple:{limit:120,period:60}}},resourcePersistencePath:dir,enableDevRegistry:false,cf:{colo:'TST',country:'GB'},upstream:apiOrigin,verbose:true,outboundService:{node:async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const url=new URL(req.url, 'https://'+req.headers.host).href,bytes=new Uint8Array(Buffer.concat(chunks));
  sent.push({url,method:req.method,encoding:req.headers['content-encoding'],authorization:req.headers.authorization,bytes});
  res.writeHead(url===endpoint?201:403);res.end();
}}}));
async function call(w,path,secret,method='GET',body){
 const res=await mf.dispatchFetch(apiOrigin+'/v1/workspaces/'+w+'/'+path,{method,headers:{Origin:origin,'CF-Connecting-IP':'192.0.2.10',Authorization:'Bearer '+secret,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return {status:res.status,...await res.json()};
}
try{
 const health=await mf.dispatchFetch(apiOrigin+'/healthz');assert.equal(health.status,200);assert.equal((await health.json()).status,'candidate-ready');
 assert.equal((await call('w','bootstrap',root,'POST',{name:'Blocked raw bootstrap'})).status,401);
 const ownerJwt=await token('owner'),athleteJwt=await token('athlete',{role:'owner'}),stranger=await token('stranger');
 assert.equal((await call('w','identity/bootstrap',stranger,'POST',{credential:root,name:'Blocked'})).status,401);
 const owner=await call('w','identity/bootstrap',ownerJwt,'POST',{credential:root,name:'Synthetic HTTPS'});assert.equal(owner.status,201,JSON.stringify({status:owner.status,error:owner.error}));assert.equal(owner.member.role,'owner');
 assert.equal((await call('w','identity/bind',ownerJwt,'POST',{credential:owner.token})).status,401);
 assert.equal((await call('w','teams',owner.token,'POST',{id:'t',name:'Team',players:[{id:'p',name:'Player',number:1}]})).status,201);
 const invite=await call('w','invite',owner.token,'POST',{role:'athlete',teamId:'t',athleteId:'p',matchId:null});assert.equal(invite.status,201);
 let member=await call('w','identity/redeem',athleteJwt,'POST',{credential:invite.invite});assert.equal(member.status,201);assert.equal(member.member.role,'athlete');
 assert.equal((await call('w','members',member.token)).status,403);assert.equal((await call('other','identity/session',athleteJwt,'POST',{})).status,401);
 assert.equal((await call('w','notification-lab',member.token)).status,404);
 const state=await call('w','notification/provider',member.token);assert.equal(state.status,200);assert.equal(state.enabled,false);
 const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']),sub={endpoint,p256dh:b64(await crypto.subtle.exportKey('raw',receiver.publicKey)),auth:b64(crypto.getRandomValues(new Uint8Array(16))),expirationTime:null};
 assert.equal((await call('w','notification/provider',member.token,'PUT',{expectedRevision:0,subscription:{...sub,endpoint:'https://other.invalid/synthetic'}})).status,400);
 const enabled=await call('w','notification/provider',member.token,'PUT',{expectedRevision:0,subscription:sub});assert.equal(enabled.status,200);assert.equal(enabled.enabled,true);
 const refreshed=await call('w','identity/session',await token('athlete'),'POST',{});assert.equal(refreshed.status,200);assert.equal((await call('w','me',member.token)).status,401);member=refreshed;assert.equal((await call('w','notification/provider',member.token)).enabled,true);
 const profile={expectedRevision:0,goals:[{id:'g',name:'Synthetic goal',status:'active',to:'2026-12-01'}],assignments:[],schedule:[]};
 assert.equal((await call('w','teams/t/athletes/p',owner.token,'PUT',profile)).status,200);
 const queued=await call('w','notification/provider/inbox',member.token);assert.equal(queued.pending,true,'Profile write must enqueue a notice');
 for(let i=0;i<100&&!sent.length;i++)await sleep(200);
 if(!sent.length){
  // Only synthetic status is printed, never ciphertext, endpoint, identity or credentials.
  for(const file of await readdir(dir,{recursive:true})){if(!file.endsWith('.sqlite'))continue;let db;try{db=new DatabaseSync(resolve(dir,file),{readOnly:true});const row=db.prepare('SELECT body FROM workspace_state WHERE id=1').get();const state=JSON.parse(row.body);console.log('Synthetic delivery diagnostic:',state.members.filter(m=>m.role==='athlete').map(m=>({pending:m.notificationLab?.notice?.pending,phase:m.notificationLab?.notice?.delivery?.phase??'ready',attempt:m.notificationLab?.notice?.delivery?.attempt??0})));}catch{}finally{db?.close();}}
 }
 assert.equal(sent.length,1,'Expected one background provider attempt');assert.equal(sent[0].url,endpoint);assert.equal(sent[0].method,'POST');assert.equal(sent[0].encoding,'aes128gcm');assert.match(sent[0].authorization,/^vapid t=/);assert.ok(sent[0].bytes.length>86);assert.ok(!Buffer.from(sent[0].bytes).includes(Buffer.from('Synthetic goal')));
 const inbox=await call('w','notification/provider/inbox',member.token);assert.equal(inbox.pending,true);
 assert.equal((await call('w','notification/provider/ack',member.token,'POST',{expectedRevision:inbox.revision,sequence:inbox.sequence})).pending,false);
 assert.equal((await call('w','notification/provider',member.token,'PUT',{expectedRevision:enabled.revision,subscription:null})).enabled,false);
 assert.equal((await call('w','teams/t/athletes/p',owner.token,'PUT',{...profile,expectedRevision:1})).status,200);
 await sleep(2500);assert.equal(sent.length,1);
 const copy=await call('w','workspace/backup',owner.token);assert.equal(copy.status,200);assert.ok(!JSON.stringify(copy).includes(endpoint));
 const restored=await call('restored','identity/restore',ownerJwt,'POST',{credential:root,sourceWorkspaceId:'w',packet:copy.packet});assert.equal(restored.status,201);
 assert.equal((await call('restored','teams/t/roster',restored.token)).team.players.length,1);
 assert.equal((await call('restored','members',restored.token)).members.length,1);
 assert.equal((await call('restored','identity/session',athleteJwt,'POST',{})).status,401);
 const short=await token('athlete',{exp:Math.floor(Date.now()/1000)+3}),fresh=await call('w','identity/session',short,'POST',{});assert.equal(fresh.status,200);
 assert.equal((await call('w','me',member.token)).status,401);
 await sleep(3500);assert.equal((await call('w','me',fresh.token)).status,401);
 const again=await call('w','identity/session',await token('athlete'),'POST',{});assert.equal(again.status,200);assert.equal(again.member.role,'athlete');
 assert.equal((await call('w','revoke',owner.token,'POST',{memberId:again.member.id})).status,200);
 assert.equal((await call('w','identity/session',athleteJwt,'POST',{})).status,401);
 console.log('PLATFORM HTTPS CANDIDATE PASS: signed bootstrap/enrollment, expiry, role isolation, encrypted subscription, actual durable alarm and intercepted provider POST, acknowledgement, opt-out, encrypted restore.');
}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
