import test from 'node:test';
import assert from 'node:assert/strict';
import {collectUpdateDiagnostics,updateDiagnosticsText} from '../js/update-diagnostics.js';
const version='8.0.0-rc.10',scope='https://synthetic.invalid/teachapp/';
const fixture=(overrides={})=>({version,location:{href:scope+'index.html?private=do-not-include'},nav:{onLine:false,standalone:true,serviceWorker:{controller:{state:'activated'},getRegistration:async()=>({scope,active:{},waiting:{}})}},cacheStorage:{match:async(url,opts)=>{assert.equal(url,scope+'js/version.js');assert.equal(opts.cacheName,'teachapp:'+scope+':v'+version);return new Response("export const APP_VERSION = '"+version+"';\n");}},...overrides});
test('offline diagnostics is read-only, bounded vocabulary and has no URL or user records',async()=>{
 const r=await collectUpdateDiagnostics(fixture());assert.deepEqual(r,{format:1,version,storageRoute:'native',network:'offline',display:'standalone',worker:'controlled',update:'waiting',versionCache:'matching'});
 assert.doesNotMatch(JSON.stringify(r)+updateDiagnosticsText(r),/synthetic|private|https:/);
});
test('diagnostics distinguish missing, inconsistent cache and worker failures; never expose errors',async()=>{
 for(const [cacheStorage,value] of [[{match:async()=>undefined},'missing'],[{match:async()=>new Response('foreign bytes')},'mismatch'],[{match:async()=>{throw Error('private-token');}},'unavailable']]){
  const r=await collectUpdateDiagnostics(fixture({cacheStorage,encrypted:true}));assert.equal(r.storageRoute,'encrypted');assert.equal(r.versionCache,value);assert.doesNotMatch(JSON.stringify(r),/private-token/);
 }
 const r=await collectUpdateDiagnostics(fixture({nav:{onLine:true}}));assert.equal(r.worker,'unavailable');assert.equal(r.versionCache,'unavailable');
 const unrelated=await collectUpdateDiagnostics(fixture({location:{href:'https://other.invalid/'},cacheStorage:{match:async()=>{assert.fail('cross-origin read');}}}));assert.equal(unrelated.versionCache,'unavailable');
});
