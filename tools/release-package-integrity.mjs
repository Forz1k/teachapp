/* Integrity of the static review artifact. Manifest is separate, not a signature;
 * use only a trusted manifest from exact-SHA CI. No publishing or network. */
import {readFileSync,writeFileSync,lstatSync,readdirSync,realpathSync,existsSync} from 'node:fs';
import {resolve,relative,sep,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {staticReleaseFiles} from './build-static-release.mjs';
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const shaOK=s=>typeof s==='string'&&/^[0-9a-f]{40}$/.test(s);
const hash=b=>createHash('sha256').update(b).digest('hex');
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
function collect(root){
 const dir=resolve(root);check(!lstatSync(dir).isSymbolicLink()&&lstatSync(dir).isDirectory()&&realpathSync(dir)===dir,'Invalid package directory');
 const files=[],dirs=[];
 function walk(p,rel=''){
  for(const e of readdirSync(p).sort()){
   const file=join(p,e),name=rel?rel+'/'+e:e,st=lstatSync(file);check(!st.isSymbolicLink(),'Symlink in package: '+name);
   if(st.isDirectory()){dirs.push(name);walk(file,name);}
   else {check(st.isFile()&&realpathSync(file)===file,'Invalid file: '+name);files.push(name);}
  }
 }
 walk(dir);return {dir,files:files.sort(),dirs};
}
export function packageManifest(root,sha){
 check(shaOK(sha),'Expected full commit SHA');
 const {dir,files,dirs}=collect(root),read=p=>readFileSync(join(dir,p));
 check(files.includes('sw.js'),'Missing worker');
 const expected=[...staticReleaseFiles(read('sw.js').toString('utf8')),'.nojekyll'].sort();
 check(JSON.stringify(files)===JSON.stringify(expected),'Missing or extra package files');
 check(dirs.every(d=>expected.some(p=>p.startsWith(d+'/'))),'Unexpected empty directory');
 check(read('.nojekyll').length===0,'Invalid .nojekyll');
 const version=/^export const APP_VERSION = '([0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.]+)?)';\s*$/.exec(read('js/version.js').toString('utf8'))?.[1];
 check(version&&read('sw.js').toString('utf8').split(/\r?\n/).includes("const VERSION = 'v"+version+"';"),'Version mismatch');
 return {format:1,sha,version,files:files.map(path=>{const bytes=read(path);return {path,bytes:bytes.length,sha256:hash(bytes)};})};
}
export function verifyPackage(root,sha,manifest){
 check(exact(manifest,['format','sha','version','files'])&&manifest.format===1&&manifest.sha===sha&&Array.isArray(manifest.files)&&manifest.files.every(f=>exact(f,['path','bytes','sha256'])),'Manifest format or SHA mismatch');
 const actual=packageManifest(root,sha);
 check(manifest.version===actual.version&&manifest.files.length===actual.files.length&&actual.files.every((f,i)=>{const m=manifest.files[i];return m.path===f.path&&m.bytes===f.bytes&&m.sha256===f.sha256;}),'Package integrity mismatch');
 return actual;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [action,root,sha,file,...extra]=process.argv.slice(2);check(root&&file&&!extra.length&&['--create','--verify'].includes(action),'Usage: release-package-integrity.mjs --create|--verify PACKAGE SHA MANIFEST');
  const out=resolve(file),rel=relative(realpathSync(root),out);check(rel==='..'||rel.startsWith('..'+sep)||resolve(root)!==out&&rel.startsWith(sep),'Manifest must be outside package');
  if(action==='--create'){check(!existsSync(out),'Manifest already exists');const m=packageManifest(root,sha);writeFileSync(out,JSON.stringify(m,null,2)+'\n',{flag:'wx'});console.log('PACKAGE MANIFEST CREATED: '+m.version+' '+m.files.length+' files');}
  else {const st=lstatSync(out);check(st.isFile()&&!st.isSymbolicLink()&&st.size<=1024*1024,'Invalid manifest file');const m=verifyPackage(root,sha,JSON.parse(readFileSync(out,'utf8')));console.log('PACKAGE INTEGRITY PASS: '+m.version+' '+m.files.length+' files; '+sha);}
 }catch(e){console.error('Package integrity refused: '+e.message);process.exitCode=1;}
}
