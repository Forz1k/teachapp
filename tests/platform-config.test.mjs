import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticPlatformConfig} from '../server/platform-config.mjs';
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
