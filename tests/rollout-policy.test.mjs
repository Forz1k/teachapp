import test from 'node:test';
import assert from 'node:assert/strict';
import {migrationLabAllowed} from '../js/rollout-policy.js';
test('RC9 public preview denies experimental migration at all non-loopback origins and cannot be enabled by query or fragment',()=>{
 for(const href of ['http://localhost:8099/','http://127.0.0.1:8099/','https://[::1]/'])assert.equal(migrationLabAllowed({href}),true);
 for(const href of ['https://forz1k.github.io/teachapp/?secure-migration=1','https://localhost.example.com/?lab=1','https://example.invalid/#localhost','https://192.168.1.1/','https://127.0.0.1@evil.invalid/','https://x@localhost/','file:///tmp/index.html','invalid'])assert.equal(migrationLabAllowed({href}),false);
 assert.equal(migrationLabAllowed(null),false);
});
