/* Build the reviewable production static package, never publish it.
 * Positive allowlist from precache + sw.js. No server/tools/LAB/source repo. */
import {readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,copyFileSync,existsSync,rmSync} from 'node:fs';
import {resolve,relative,dirname,sep,posix} from 'node:path';
import {pathToFileURL} from 'node:url';
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const allowed=p=>['index.html','live/index.html','manifest.webmanifest','sw.js','vendor/xlsx.full.min.js'].includes(p)||/^(?:js\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.js|css\/[a-z0-9_-]+\.css|icons\/[a-z0-9_-]+\.(?:png|svg))$/.test(p);
const required=['index.html','live/index.html','manifest.webmanifest','sw.js','js/app.js','js/public-view.js','vendor/xlsx.full.min.js'];
export function staticReleaseFiles(worker){
 const m=typeof worker==='string'&&worker.match(/const PRECACHE = \[([\s\S]*?)\];/);
 check(m,'Missing static precache');
 // Accept only the literal comma-separated single-quoted path grammar.
 const list=m[1].trim();
 check(/^'\.\/[^'\r\n]*'(?:\s*,\s*'\.\/[^'\r\n]*')*\s*,?$/.test(list),'Nonliteral or malformed precache');
 const paths=[...list.matchAll(/'([^']+)'/g)].map(x=>x[1].slice(2));
 check(new Set(paths).size===paths.length,'Duplicate precache entry');
 check(paths.includes('')&&paths.includes('index.html'),'Missing precache root');
 const result=['sw.js',...paths.filter(Boolean)].sort();
 check(new Set(result).size===result.length&&result.every(allowed),'Forbidden static release path');
 check(required.every(p=>result.includes(p)),'Incomplete static release');
 return result;
}
function safeFile(root,p){
 let cursor=root;
 for(const part of p.split('/')){cursor=resolve(cursor,part);const st=lstatSync(cursor);check(!st.isSymbolicLink(),'Symlink in release path: '+p);}
 check(lstatSync(cursor).isFile()&&realpathSync(cursor)===cursor,'Nonregular static file: '+p);return cursor;
}
export function buildStaticRelease(root,output){
 root=realpathSync(root);output=resolve(output);
 check(output!==root&&!existsSync(output),'Release output must be a new directory');
 const worker=readFileSync(safeFile(root,'sw.js'),'utf8'),files=staticReleaseFiles(worker),set=new Set(files),sources=new Map(files.map(p=>[p,safeFile(root,p)]));
 // Static relative dependencies from production module graph must be present.
 const dependency=(file,value)=>{
  if(value.startsWith('#'))return;
  check(value.startsWith('./')||value.startsWith('../'),'Unsupported local reference in '+file);
  const clean=value.split(/[?#]/)[0],target=posix.normalize(posix.join(posix.dirname(file),clean));
  check(set.has(target),'Missing packaged dependency: '+file+' -> '+target);
 };
 for(const p of files){
  if(p.startsWith('js/')){
   const src=readFileSync(sources.get(p),'utf8');
   for(const match of src.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.[^'"]+)['"]/g))dependency(p,match[1]);
  }
  if(p==='index.html'||p==='live/index.html'){
   const src=readFileSync(sources.get(p),'utf8');
   for(const match of src.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi))dependency(p,match[1]);
  }
 }
 const manifest=JSON.parse(readFileSync(sources.get('manifest.webmanifest'),'utf8'));
 for(const value of [manifest.start_url,...manifest.icons.map(i=>i.src),...(manifest.shortcuts??[]).map(s=>s.url)])dependency('manifest.webmanifest',value);
 mkdirSync(output,{recursive:false});
 try{
  for(const p of files){const dest=resolve(output,p);mkdirSync(dirname(dest),{recursive:true});copyFileSync(sources.get(p),dest);}
  writeFileSync(resolve(output,'.nojekyll'),'',{flag:'wx'});
 }catch(e){rmSync(output,{recursive:true,force:true});throw e;}
 return {files:files.length+1,output};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const [output,...extra]=process.argv.slice(2);check(output&&!extra.length,'Usage: node tools/build-static-release.mjs NEW_OUTPUT_DIRECTORY');const result=buildStaticRelease(process.cwd(),output);console.log('STATIC RELEASE ARTIFACT PASS: '+result.files+' files, no LAB or server. Not deployed.');}
 catch(e){console.error('Static release refused: '+e.message);process.exitCode=1;}
}
