import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Exact-SHA evidence workflows run on integration pushes without production deployment',()=>{
 const names=['webkit','cloudflare','delta','firebase-archive','platform'];
 for(const name of names){const yaml=read('.github/workflows/'+name+'.yml');assert.match(yaml,/^on:\n  push:\n    branches:\n      - 'roadmap\/8\.0-integration'\n/m,name);assert.match(yaml,/^  pull_request:/m,name);}
 assert.match(read('.github/workflows/check.yml'),/^on: \[push, pull_request\]/m);
 const cloud=read('.github/workflows/cloudflare.yml');assert.match(cloud,/if: github\.ref == 'refs\/heads\/main' && github\.event_name != 'pull_request' && vars\.TEACHAPP_CLOUDFLARE_DEPLOY == 'true'/);
});
test('Published 6.0.2 is pinned for a real PWA upgrade check',()=>{
 const yaml=read('.github/workflows/webkit.yml'),sha='d4cb5bb3c4cae0658e7b2d4816679f367f8d4a19';
 assert.ok(yaml.includes('git fetch --no-tags --depth=1 origin '+sha));assert.ok(yaml.includes('git archive '+sha));assert.ok(yaml.includes('node tools/upgrade-smoke.mjs "$RUNNER_TEMP/teachapp-6.0.2"'));
 assert.match(read('tools/upgrade-smoke.mjs'),/\['5\.1\.0','5\.1\.1','6\.0\.0','6\.0\.2','6\.0\.6'\]\.includes\(baselineVersion\)/);
});

test('Stable 6.0.6 upgrade is pinned and includes live assist and rehearsal',()=>{const yaml=read('.github/workflows/webkit.yml'),sha='4d04398ee48d5f9ea359e50d5f43cd5dfb9b2d0c';assert.ok(yaml.includes('git fetch --no-tags --depth=1 origin '+sha));assert.ok(yaml.includes('node tools/upgrade-smoke.mjs "$RUNNER_TEMP/teachapp-6.0.6"'));assert.match(read('tools/upgrade-smoke.mjs'),/LIVE UPGRADE PASS/);});
