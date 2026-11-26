/* Fail closed for checked-in synthetic configuration, not a cloud audit.
 * Configs intentionally use the strict JSON subset of JSONC. */
import {readFileSync} from 'node:fs';
const lab=Object.freeze({
 'wrangler.delta-dev.jsonc':['teachapp-delta-synthetic','server/delta-worker.mjs','DELTA_LEDGERS','DeltaLedger'],
 'wrangler.platform-dev.jsonc':['teachapp-platform-synthetic','server/platform-worker.mjs','WORKSPACES','PlatformWorkspace'],
 'wrangler.migration-source-dev.jsonc':['teachapp-migration-source-synthetic','server/cloudflare-relay.mjs','SNAPSHOTS','SyncSnapshot']
});
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const assert=(ok,file,reason)=>{if(!ok)throw Error(file+': '+reason);};
export function validateLabConfigs(read=path=>readFileSync(path,'utf8')){
 const readConfig=file=>{try{return JSON.parse(read(file));}catch{throw Error(file+': strict JSON required');}};
 const production=readConfig('wrangler.jsonc'),names=new Set([production.name]),results=[];
 assert(typeof production.name==='string'&&production.name.length>0,'wrangler.jsonc','missing worker name');
 for(const [file,[name,main,binding,className]] of Object.entries(lab)){
  const c=readConfig(file);
  assert(exact(c,['name','main','compatibility_date','workers_dev','preview_urls','observability','durable_objects','migrations']),file,'unexpected configuration fields (routes, env, vars and external bindings forbidden)');
  assert(c.name===name&&!names.has(c.name)&&c.main===main,file,'unexpected worker identity or entrypoint');
  assert(typeof c.compatibility_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(c.compatibility_date),file,'invalid compatibility date');
  assert(c.workers_dev===false&&c.preview_urls===false,file,'public or preview endpoint enabled');
  assert(exact(c.observability,['enabled'])&&c.observability.enabled===false,file,'observability must stay disabled');
  const b=c.durable_objects?.bindings;
  assert(exact(c.durable_objects,['bindings'])&&Array.isArray(b)&&b.length===1&&exact(b[0],['name','class_name'])&&b[0].name===binding&&b[0].class_name===className,file,'unexpected Durable Object binding');
  const m=c.migrations;
  assert(Array.isArray(m)&&m.length===1&&exact(m[0],['tag','new_sqlite_classes'])&&m[0].tag==='v1'&&Array.isArray(m[0].new_sqlite_classes)&&m[0].new_sqlite_classes.length===1&&m[0].new_sqlite_classes[0]===className,file,'unexpected migration; review required');
  names.add(c.name);results.push(file);
 }
 const file='firebase.json',c=readConfig(file);
 assert(exact(c,['database','emulators'])&&exact(c.database,['rules'])&&c.database.rules==='firebase-portal.rules.json',file,'unexpected service or rules path');
 assert(exact(c.emulators,['database','auth','ui']),file,'unexpected emulator');
 for(const [kind,port] of [['database',9000],['auth',9099]]){
  const e=c.emulators[kind];
  assert(exact(e,['host','port'])&&e.host==='127.0.0.1'&&e.port===port,file,'emulator must use loopback and expected port');
 }
 assert(exact(c.emulators.ui,['enabled'])&&c.emulators.ui.enabled===false,file,'emulator UI must stay disabled');
 return [...results,file];
}
