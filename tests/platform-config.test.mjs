import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticPlatformConfig,candidatePlatformConfig,edgeAddress} from '../server/platform-config.mjs';
const rootHash='a'.repeat(64);
const fixture={TEACHAPP_PLATFORM_SYNTHETIC:'true',TEACHAPP_PLATFORM_ORIGIN:'http://127.0.0.1:8099',TEACHAPP_PLATFORM_ROOT_HASH:rootHash};
test('Synthetic Platform accepts only canonical loopback config and loopback request URLs',()=>{
 for(const host of ['localhost','127.0.0.1','[::1]'])for(const scheme of ['http','https']){
  const origin=scheme+'://'+host+':8099';
  assert.deepEqual(syntheticPlatformConfig({...fixture,TEACHAPP_PLATFORM_ORIGIN:origin},scheme+'://'+host+':8788/healthz'),{origin,rootHash});
 }
 for(const origin of ['https://example.com','http://192.168.1.1:8099','http://localhost.evil.example','http://localhost:8099/path','http://localhost:8099/','http://x:secret@localhost:8099','http://localhost:8099?x=1']){
  assert.equal(syntheticPlatformConfig({...fixture,TEACHAPP_PLATFORM_ORIGIN:origin},'http://localhost:8788/healthz'),null,origin);
 }
 for(const url of ['https://example.workers.dev/healthz','https://127.0.0.1.evil.example/healthz','http://192.168.1.1/healthz','ftp://localhost/healthz','http://user@localhost/healthz']){
  assert.equal(syntheticPlatformConfig(fixture,url),null,url);
 }
 for(const env of [{},{...fixture,TEACHAPP_PLATFORM_SYNTHETIC:true},{...fixture,TEACHAPP_PLATFORM_SYNTHETIC:'false'},{...fixture,TEACHAPP_PLATFORM_ROOT_HASH:null}]){
  assert.equal(syntheticPlatformConfig(env,'http://127.0.0.1:8788/healthz'),null);
 }
});

test('RC8 candidate refuses collapsed origins, reused secrets and missing durable bindings',async()=>{
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']),j=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const env={TEACHAPP_PLATFORM_STAGE:'candidate',TEACHAPP_PLATFORM_ORIGIN:'https://ui.example.invalid',TEACHAPP_PLATFORM_API_ORIGIN:'https://api.example.invalid',TEACHAPP_PLATFORM_ROOT_HASH:'a'.repeat(64),TEACHAPP_PLATFORM_BACKUP_KEY:'b'.repeat(64),TEACHAPP_PLATFORM_OPERATOR_IDENTITY:'c'.repeat(64),TEACHAPP_PLATFORM_IDENTITY:JSON.stringify({issuer:'https://identity.example.invalid/',audience:'test',clientId:'test',key:{kty:'RSA',kid:'key',alg:'RS256',use:'sig',e:j.e,n:j.n}}),EDGE_LIMIT:{limit(){}},INGRESS:{idFromName(){}},WORKSPACES:{idFromName(){}}};
 const url=env.TEACHAPP_PLATFORM_API_ORIGIN+'/healthz';assert.ok(candidatePlatformConfig(env,url));
 for(const change of [{TEACHAPP_PLATFORM_ORIGIN:env.TEACHAPP_PLATFORM_API_ORIGIN},{TEACHAPP_PLATFORM_BACKUP_KEY:env.TEACHAPP_PLATFORM_ROOT_HASH},{TEACHAPP_PLATFORM_BACKUP_KEY:env.TEACHAPP_PLATFORM_OPERATOR_IDENTITY},{INGRESS:null},{WORKSPACES:null},{EDGE_LIMIT:null},{TEACHAPP_PLATFORM_SYNTHETIC:'true'}])assert.equal(candidatePlatformConfig({...env,...change},url),null);
 assert.equal(candidatePlatformConfig(env,'https://other.example.invalid/healthz'),null);
 assert.equal(edgeAddress({headers:new Headers({'CF-Connecting-IP':'192.0.2.1'})}),null);
 assert.equal(edgeAddress({cf:{},headers:new Headers({'CF-Connecting-IP':'192.0.2.1','X-Forwarded-For':'203.0.113.1'})}),'192.0.2.1');
});
