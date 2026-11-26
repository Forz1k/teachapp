import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {staticReleaseFiles,buildStaticRelease} from '../tools/build-static-release.mjs';
const files=['./','./index.html','./live/index.html','./manifest.webmanifest','./js/app.js','./js/public-view.js','./vendor/xlsx.full.min.js'];
const sw=extra=>'const PRECACHE = ['+[...files,...extra].map(p=>"'"+p+"'").join(',')+'];';
test('Static release allowlist excludes LAB and path escapes, rejects duplicates/nonliteral entries',()=>{
 for(const path of ['./tools/prototypes/x.mjs','./platform-dev/index.html','./server/worker.mjs','./js/../server/a.js','./js/foo%2fbar.js','./js/.secret.js','./index.html','./sw.js'])assert.throws(()=>staticReleaseFiles(sw([path])));
 assert.throws(()=>staticReleaseFiles(sw([]).replace("'./index.html'","getEntry()")));
 assert.equal(staticReleaseFiles(sw([])).length,7);
});
test('Static artifact builds only reviewed files and refuses missing import, symlink and overwrite',t=>{
 const root=mkdtempSync(join(tmpdir(),'teachapp-static-fixture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(p,s)=>{const f=join(root,p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,s);};
 for(const p of files.slice(1))put(p.slice(2),'');
 put('index.html','<script type="module" src="./js/app.js"></script>');
 put('live/index.html','<script type="module" src="../js/public-view.js"></script>');
 put('manifest.webmanifest',JSON.stringify({start_url:'./index.html',icons:[]}));
 put('sw.js',sw([]));put('tools/prototypes/private.mjs','PRIVATE');put('server/key.txt','SECRET');
 const out=join(root,'artifact');assert.equal(buildStaticRelease(root,out).files,8);
 assert.equal(readFileSync(join(out,'index.html'),'utf8'),readFileSync(join(root,'index.html'),'utf8'));assert.equal(existsSync(join(out,'.nojekyll')),true);assert.equal(existsSync(join(out,'tools')),false);assert.equal(existsSync(join(out,'server')),false);
 assert.throws(()=>buildStaticRelease(root,out),/new directory/);
 put('js/app.js',"import './missing.js';");assert.throws(()=>buildStaticRelease(root,join(root,'bad')),/Missing packaged dependency/);assert.equal(existsSync(join(root,'bad')),false);
 put('js/app.js','');rmSync(join(root,'js/public-view.js'));symlinkSync(join(root,'server/key.txt'),join(root,'js/public-view.js'));
 assert.throws(()=>buildStaticRelease(root,join(root,'link')),/Symlink/);
});
