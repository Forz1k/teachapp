/* Fail closed for checked-in synthetic configuration, not a cloud audit.
 * Configs intentionally use the strict JSON subset of JSONC. */
import {readFileSync} from 'node:fs';
const lab=Object.freeze({
 'wrangler.delta-candidate.jsonc':['teachapp-delta-v3-candidate','server/delta-worker.mjs','DELTA_LEDGERS','DeltaLedger'],
 'wrangler.delta-dev.jsonc':['teachapp-delta-synthetic','server/delta-worker.mjs','DELTA_LEDGERS','DeltaLedger'],
 'wrangler.platform-dev.jsonc':['teachapp-platform-synthetic','server/platform-worker.mjs','WORKSPACES','PlatformWorkspace'],
 'wrangler.platform-candidate.jsonc':['teachapp-platform-https-candidate','server/platform-worker.mjs','WORKSPACES','PlatformWorkspace'],
 'wrangler.migration-source-dev.jsonc':['teachapp-migration-source-synthetic','server/cloudflare-relay.mjs','SNAPSHOTS','SyncSnapshot']
});
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
const assert=(ok,file,reason)=>{if(!ok)throw Error(file+': '+reason);};
export function validateLabConfigs(read=path=>readFileSync(path,'utf8')){
 const readConfig=file=>{try{return JSON.parse(read(file));}catch{throw Error(file+': strict JSON required');}};
 const production=readConfig('wrangler.jsonc'),names=new Set([production.name]),results=[];
 assert(typeof production.name==='string'&&production.name.length>0,'wrangler.jsonc','missing worker name');
 for(const [file,[name,main,binding,className]] of Object.entries(lab)){
  const c=readConfig(file),platform=file.startsWith('wrangler.platform-'),candidate=file==='wrangler.platform-candidate.jsonc';
  assert(exact(c,['name','main','compatibility_date','workers_dev','preview_urls','observability','durable_objects','migrations',...(candidate?['ratelimits']:[])]),file,'unexpected configuration fields (routes, env, vars and external bindings forbidden)');
  assert(c.name===name&&!names.has(c.name)&&c.main===main,file,'unexpected worker identity or entrypoint');
  assert(typeof c.compatibility_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(c.compatibility_date),file,'invalid compatibility date');
  assert(c.workers_dev===false&&c.preview_urls===false,file,'public or preview endpoint enabled');
  assert(exact(c.observability,['enabled'])&&c.observability.enabled===false,file,'observability must stay disabled');
  const b=c.durable_objects?.bindings;
  assert(exact(c.durable_objects,['bindings'])&&Array.isArray(b)&&b.length===(platform?2:1)&&exact(b[0],['name','class_name'])&&b[0].name===binding&&b[0].class_name===className&&(!platform||exact(b[1],['name','class_name'])&&b[1].name==='INGRESS'&&b[1].class_name==='PlatformIngress'),file,'unexpected Durable Object binding');
  const m=c.migrations;
  const migrations=platform?(candidate?[{tag:'v1',new_sqlite_classes:[className,'PlatformIngress']}]:[{tag:'v1',new_sqlite_classes:[className]},{tag:'v2',new_sqlite_classes:['PlatformIngress']}]):[{tag:'v1',new_sqlite_classes:[className]}];
  assert(Array.isArray(m)&&m.length===migrations.length&&m.every((x,i)=>exact(x,['tag','new_sqlite_classes'])&&x.tag===migrations[i].tag&&Array.isArray(x.new_sqlite_classes)&&x.new_sqlite_classes.join('|')===migrations[i].new_sqlite_classes.join('|')),file,'unexpected migration; review required');
  if(candidate){const a=c.ratelimits;assert(Array.isArray(a)&&a.length===1&&exact(a[0],['name','namespace_id','simple'])&&a[0].name==='EDGE_LIMIT'&&a[0].namespace_id==='80000601'&&exact(a[0].simple,['limit','period'])&&a[0].simple.limit===120&&a[0].simple.period===60,file,'unexpected edge binding');}
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
