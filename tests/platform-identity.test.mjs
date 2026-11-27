import test from 'node:test';
import assert from 'node:assert/strict';
import {identityConfig,verifyIdentityAccessToken,identityPlan,bindIdentityResult} from '../server/platform-identity.mjs';
import {dispatchWorkspace,STATE_LIMIT} from '../server/platform-api.mjs';
const now=1800000000000,sec=now/1000,root='a'.repeat(64),enc=new TextEncoder();
const b64=v=>Buffer.from(v).toString('base64url'),json=v=>b64(JSON.stringify(v));
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);
const raw={issuer:'https://identity.example.invalid/',audience:'teachapp-platform',clientId:'test-client',key:{kty:'RSA',kid:'key1',n:jwk.n,e:jwk.e,alg:'RS256',use:'sig'}};
const config=identityConfig(JSON.stringify(raw));
const claims={iss:raw.issuer,aud:raw.audience,client_id:raw.clientId,sub:'user-1',jti:'token-1',iat:sec,exp:sec+300};
const header={alg:'RS256',kid:'key1',typ:'at+jwt'};
async function sign(p=claims,h=header,key=keys.privateKey){
 const data=json(h)+'.'+json(p);
 return data+'.'+b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(data)));
}
test('RC6 signed identity validates only pinned access token, lifetime, issuer, client and audience',async()=>{
 assert.ok(config);
 const good=await sign(),id=await verifyIdentityAccessToken(config,good,now);assert.match(id,/^[a-f0-9]{64}$/);
 assert.equal(await verifyIdentityAccessToken(config,await sign({...claims,jti:'next',role:'owner',workspaceId:'other'}),now),id);
 assert.notEqual(await verifyIdentityAccessToken(config,await sign({...claims,sub:'user-2'}),now),id);
 for(const p of [{...claims,iss:'https://other.invalid/'},{...claims,aud:['teachapp-platform','other']},{...claims,client_id:'other'},{...claims,exp:sec},{...claims,exp:sec+901},{...claims,iat:sec+31},{...claims,nbf:sec+1},{...claims,sub:''},{...claims,jti:undefined}]){
  assert.equal(await verifyIdentityAccessToken(config,await sign(p),now),null);
 }
 for(const h of [{...header,alg:'none'},{...header,typ:'JWT'},{...header,kid:'other'},{...header,jku:'https://evil.invalid/'}])assert.equal(await verifyIdentityAccessToken(config,await sign(claims,h),now),null);
 const foreign=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
 assert.equal(await verifyIdentityAccessToken(config,await sign(claims,header,foreign.privateKey),now),null);
 assert.equal(await verifyIdentityAccessToken(config,good+'=',now),null);
 assert.equal(await verifyIdentityAccessToken(null,good,now),null);
 for(const invalid of [{...raw,issuer:'http://identity.example.invalid/'},{...raw,key:{...raw.key,d:'private'}},{...raw,key:{...raw.key,n:'AQAB'}},{...raw,clientId:''}])assert.equal(identityConfig(JSON.stringify(invalid)),null);
});
test('RC6 binds verified subject through single-use invitation and never accepts caller role or cross-workspace login',()=>{
 let state=null,seq=0;
 const call=(path,auth,body={},identityHash=null,workspaceId='w')=>{
  const hash=(++seq).toString(16).padStart(64,'0'),issued={id:'m-'+seq,hash,secret:hash};
  let input={workspaceId,method:'POST',path,auth,rootHash:root,body,issued,now,identityHash};
  const plan=path.startsWith('identity/')?identityPlan(state,input):null;if(plan?.error)return plan.error;
  let result=dispatchWorkspace(state,plan?.input??input);if(plan?.bind)result=bindIdentityResult(result,identityHash,STATE_LIMIT);
  if(result.changed)state=result.state;return result;
 };
 const subject='b'.repeat(64),second='c'.repeat(64);
 const o=call('bootstrap',root,{name:'Synthetic'}).body.token;
 call('teams',o,{id:'t',name:'T',players:[{id:'p',name:'P',number:1}]});
 const invite=()=>call('invite',o,{role:'athlete',teamId:'t',athleteId:'p',matchId:null}).body.invite;
 const code=invite();
 assert.equal(call('identity/redeem',null,{credentialHash:code,role:'owner'},subject).status,400);
 assert.equal(call('identity/session',null,{},subject).status,401);
 const enrolled=call('identity/redeem',null,{credentialHash:code},subject);
 assert.equal(enrolled.status,201);assert.equal(enrolled.body.member.role,'athlete');assert.equal(enrolled.body.member.identityHash,undefined);
 assert.equal(call('identity/redeem',null,{credentialHash:code},second).status,401);
 assert.equal(call('identity/redeem',null,{credentialHash:invite()},subject).status,409);
 assert.equal(call('identity/session',null,{},subject,'other').status,401);
 assert.equal(call('identity/session',null,{},second).status,401);
 const again=call('identity/session',null,{},subject);assert.equal(again.status,200);assert.deepEqual(again.body.member,enrolled.body.member);assert.notEqual(again.body.token,enrolled.body.token);
 assert.equal(call('session/rotate',enrolled.body.token).status,401);
 assert.equal(call('identity/bind',null,{credentialHash:again.body.token},second).status,409);
 assert.equal(call('revoke',o,{memberId:again.body.member.id}).status,200);
 assert.equal(call('identity/session',null,{},subject).status,401);
 const replacement=call('identity/redeem',null,{credentialHash:invite()},subject);assert.equal(replacement.status,201);assert.notEqual(replacement.body.member.id,enrolled.body.member.id);
 assert.equal(call('identity/bind',null,{credentialHash:o},second).status,409);
 assert.equal(call('owner/recovery',o,{recoveryHash:'d'.repeat(64),expectedVersion:0}).status,200);
 const owner=call('identity/bind',null,{credentialHash:o},second);assert.equal(owner.status,200);assert.equal(owner.body.member.role,'owner');
 assert.equal(call('identity/session',null,{},second).status,200);
});
