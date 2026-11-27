import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateLabConfigs} from '../tools/lab-config-check.mjs';
const actual=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const changed=(file,fn)=>path=>{const raw=actual(path);if(path!==file)return raw;const v=JSON.parse(raw);fn(v);return JSON.stringify(v);};
test('Checked-in LAB configs have independent names, local bindings and no public routes',()=>{
 assert.equal(validateLabConfigs(actual).length,6);
});
test('LAB config check refuses routes, preview, env, credentials and cross-worker binding even if disabled elsewhere',()=>{
 for(const fn of [c=>c.routes=[],c=>c.workers_dev=true,c=>c.preview_urls=true,c=>c.env={production:{}},c=>c.vars={SECRET:'synthetic'},c=>c.name='teachapp-sync-beta',c=>c.durable_objects.bindings[0].script_name='teachapp-sync-beta',c=>c.durable_objects.bindings[0].class_name='SyncSnapshot',c=>c.observability.enabled=true]){
  assert.throws(()=>validateLabConfigs(changed('wrangler.platform-dev.jsonc',fn)),/wrangler.platform-dev/);
 }
 assert.throws(()=>validateLabConfigs(changed('firebase.json',c=>c.emulators.database.host='0.0.0.0')),/firebase.json/);
 assert.throws(()=>validateLabConfigs(changed('firebase.json',c=>c.hosting={})),/firebase.json/);
 assert.throws(()=>validateLabConfigs(changed('wrangler.jsonc',c=>c.name='teachapp-delta-synthetic')),/wrangler.delta-dev/);
});

test('HTTPS Delta candidate config cannot silently expose public routes',()=>{assert.throws(()=>validateLabConfigs(changed('wrangler.delta-candidate.jsonc',c=>c.workers_dev=true)),/wrangler.delta-candidate/);});

test('HTTPS Platform candidate config remains route-free and forbids external binding substitutions',()=>{for(const fn of [c=>c.routes=[],c=>c.vars={TEACHAPP_PLATFORM_STAGE:'candidate'},c=>c.preview_urls=true,c=>c.ratelimits[0].simple.limit=100000,c=>c.durable_objects.bindings[1].script_name='production'])assert.throws(()=>validateLabConfigs(changed('wrangler.platform-candidate.jsonc',fn)),/wrangler.platform-candidate/);});
