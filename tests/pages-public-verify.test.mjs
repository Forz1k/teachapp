import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyPublishedPackage,validatePublicManifest} from '../tools/pages-public-verify.mjs';
const sha='a'.repeat(40),version='8.0.0-rc.9';
const data={'index.html':'index','live/index.html':'live','js/app.js':'app','js/public-view.js':'public','js/version.js':"export const APP_VERSION = '"+version+"';\n",'vendor/xlsx.full.min.js':'vendor','manifest.webmanifest':'{}','css/app.css':'css','.nojekyll':''};
data['sw.js']="const VERSION = 'v"+version+"';\nconst PRECACHE = ["+["./",...Object.keys(data).filter(x=>x!=='.nojekyll').map(x=>'./'+x)].map(x=>"'"+x+"'").join(',')+"];";
const manifest={format:1,sha,version,files:Object.entries(data).map(([path,v])=>({path,bytes:Buffer.byteLength(v),sha256:createHash('sha256').update(v).digest('hex')}))};
const fetcher=async(url,opts)=>{const u=new URL(url);assert.equal(u.origin,'https://forz1k.github.io');assert.equal(opts.redirect,'error');assert.equal(opts.method,'GET');assert.match(u.searchParams.get('release-check'),/^a{40}-0$/);const path=u.pathname.slice('/teachapp/'.length);assert.notEqual(path,'.nojekyll');return new Response(data[path]);};
test('RC9 public Pages verifier checks version, worker, and all served bytes, without authorizing release',async()=>{
 const result=await verifyPublishedPackage(manifest,sha,{fetcher});assert.deepEqual(result,{sha,version,files:9,origin:'https://forz1k.github.io/teachapp/',releaseAuthorized:false});
});
test('RC9 public Pages verifier refuses stale/foreign, duplicate, missing and altered public files',async()=>{
 assert.throws(()=>validatePublicManifest(manifest,'b'.repeat(40)),/identity/);
 const bad=structuredClone(manifest);bad.files[0].path='https://other.invalid/';assert.throws(()=>validatePublicManifest(bad,sha),/record/);
 const duplicate=structuredClone(manifest);duplicate.files.push(duplicate.files[0]);assert.throws(()=>validatePublicManifest(duplicate,sha),/paths/);
 await assert.rejects(verifyPublishedPackage(manifest,sha,{fetcher:async url=>new Response(new URL(url).pathname.endsWith('/js/version.js')?'old':'wrong')}),/mismatch/);
 await assert.rejects(verifyPublishedPackage(manifest,sha,{fetcher:async(url,opts)=>new URL(url).pathname.endsWith('/css/app.css')?new Response('missing',{status:404}):fetcher(url,opts)}),/HTTP 404/);
});
