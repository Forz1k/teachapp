/* Separate local-only candidate; no production route or personal sync binding. */
import {DurableObject} from 'cloudflare:workers';
import {digestToken} from './cloudflare-protocol.mjs';
import {dispatchWorkspace,BODY_LIMIT} from './platform-api.mjs';
const H={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8'};
const json=(status,body,cors={})=>new Response(JSON.stringify(body),{status,headers:{...H,...cors}});
function config(env){try{const origin=new URL(env.TEACHAPP_PLATFORM_ORIGIN);if(env.TEACHAPP_PLATFORM_SYNTHETIC!=='true'||!(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname))||origin.origin!==env.TEACHAPP_PLATFORM_ORIGIN||!/^[a-f0-9]{64}$/.test(env.TEACHAPP_PLATFORM_ROOT_HASH))return null;return {origin:origin.origin,rootHash:env.TEACHAPP_PLATFORM_ROOT_HASH};}catch{return null;}}
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
async function bodyOf(request){
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))return {error:415};
 const len=request.headers.get('content-length');if(len!==null&&(!/^\d+$/.test(len)||Number(len)>BODY_LIMIT))return {error:413};
 if(!request.body)return {error:400};const reader=request.body.getReader();let count=0,chunks=[];
 try{for(;;){const p=await reader.read();if(p.done)break;count+=p.value.byteLength;if(count>BODY_LIMIT){await reader.cancel();return {error:413};}chunks.push(p.value);}}finally{reader.releaseLock();}
 try{const raw=new Uint8Array(count);let offset=0;for(const c of chunks){raw.set(c,offset);offset+=c.byteLength;}return {body:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};}catch{return {error:400};}
}
export default {async fetch(request,env){
 const settings=config(env),u=new URL(request.url);if(u.pathname==='/healthz'&&request.method==='GET')return json(settings?200:503,{status:settings?'synthetic-ready':'disabled'});
 if(!settings)return json(503,{error:'disabled'});
 const r=/^\/v1\/workspaces\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_/-]{1,200})$/.exec(u.pathname);if(!r||u.search||u.hash)return json(404,{error:'route'});
 const origin=request.headers.get('Origin'),cors=origin===settings.origin?{'Access-Control-Allow-Origin':origin,'Vary':'Origin'}:{};if(origin&&origin!==settings.origin)return json(403,{error:'origin'});
 if(request.method==='OPTIONS')return origin===settings.origin?new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'}}):json(403,{error:'origin'});
 if(!['GET','POST','PUT'].includes(request.method))return json(405,{error:'method'},cors);
 const token=/^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization')||'');if(!token)return json(401,{error:'unauthorized'},cors);
 try{
  const auth=await digestToken(token[1]),packet=request.method==='GET'?{body:null}:await bodyOf(request);if(packet.error)return json(packet.error,{error:'packet'},cors);
  const issuedSecret=secret(),issued={id:crypto.randomUUID(),hash:await digestToken(issuedSecret),secret:issuedSecret};
  const stub=env.WORKSPACES.get(env.WORKSPACES.idFromName(r[1]));
  const response=await stub.fetch(new Request('https://internal/dispatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspaceId:r[1],path:r[2],method:request.method,auth,rootHash:settings.rootHash,body:packet.body,issued})}));
  return new Response(response.body,{status:response.status,headers:{...H,...cors}});
 }catch{return json(503,{error:'unavailable'},cors);}
}};
export class PlatformWorkspace extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.storage=ctx.storage;this.sql=ctx.storage.sql;this.sql.exec('CREATE TABLE IF NOT EXISTS workspace_state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');}
 async fetch(request){
  if(request.method!=='POST'||new URL(request.url).pathname!=='/dispatch')return json(404,{error:'route'});
  try{const input=await request.json();const out=this.storage.transactionSync(()=>{
   const row=this.sql.exec('SELECT body FROM workspace_state WHERE id=1').toArray()[0],result=dispatchWorkspace(row?JSON.parse(row.body):null,{...input,now:Date.now()});
   if(result.changed)this.sql.exec('INSERT INTO workspace_state(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',JSON.stringify(result.state));return result;
  });return json(out.status,out.body);}catch{return json(503,{error:'storage'});}
 }
}
