import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
import {packageManifest,verifyPackage} from '../tools/release-package-integrity.mjs';
const sha='a'.repeat(40);
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'teachapp-integrity-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const put=(p,s)=>{const path=join(dir,p);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,s);};
 const files=['index.html','live/index.html','manifest.webmanifest','js/app.js','js/public-view.js','vendor/xlsx.full.min.js','js/version.js'];
 for(const p of files)put(p,'synthetic');
 put('js/version.js',"export const APP_VERSION = '8.0.0-rc.2';\n");put('.nojekyll','');
 put('sw.js',"const VERSION = 'v8.0.0-rc.2';\nconst PRECACHE = ["+['./',...files.map(p=>'./'+p)].map(p=>"'"+p+"'").join(',')+"];");
 return {dir,put};
}
test('Static integrity detects changed bytes, wrong SHA, extra and omitted files and version mismatch',t=>{
 const {dir,put}=fixture(t),manifest=packageManifest(dir,sha);assert.deepEqual(verifyPackage(dir,sha,manifest),manifest);
 assert.throws(()=>verifyPackage(dir,'b'.repeat(40),manifest),/SHA/);
 put('js/app.js','SYNTHETIC');assert.throws(()=>verifyPackage(dir,sha,manifest),/integrity/);put('js/app.js','synthetic');
 put('tools/private.txt','secret');assert.throws(()=>packageManifest(dir,sha),/extra/);rmSync(join(dir,'tools'),{recursive:true});
 mkdirSync(join(dir,'empty'));assert.throws(()=>packageManifest(dir,sha),/empty/);rmSync(join(dir,'empty'),{recursive:true});
 rmSync(join(dir,'js/app.js'));assert.throws(()=>packageManifest(dir,sha),/Missing/);put('js/app.js','synthetic');
 put('js/version.js',"export const APP_VERSION = '6.0.6';\n");assert.throws(()=>packageManifest(dir,sha),/Version mismatch/);
});
test('Static integrity refuses symlinks even when target content matches',t=>{
 const {dir}=fixture(t),m=packageManifest(dir,sha);rmSync(join(dir,'js/app.js'));symlinkSync(join(dir,'js/public-view.js'),join(dir,'js/app.js'));assert.throws(()=>verifyPackage(dir,sha,m),/Symlink/);
});
