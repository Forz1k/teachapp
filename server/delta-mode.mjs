/* Distinct, fail-closed deployment profiles. Neither enables the other. */
const local=['127.0.0.1','localhost','[::1]'];
function httpsOrigin(value){
 try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&!local.includes(u.hostname)&&!u.username&&!u.password&&!u.port?u.origin:null;}catch{return null;}
}
export function deltaMode(env){
 const synthetic=env.TEACHAPP_DELTA_SYNTHETIC==='true',candidate=env.TEACHAPP_DELTA_CANDIDATE==='true';
 if(synthetic===candidate)return null;
 if(synthetic){
  try{const u=new URL(env.TEACHAPP_DELTA_ORIGIN);if(u.protocol!=='http:'||!local.includes(u.hostname)||u.origin!==env.TEACHAPP_DELTA_ORIGIN)return null;
   if(env.TEACHAPP_DELTA_ENDPOINT!==undefined)return null;
   return {kind:'lab',origin:u.origin,pathVersion:'v1',endpoint:null};
  }catch{return null;}
 }
 const origin=httpsOrigin(env.TEACHAPP_DELTA_ORIGIN),endpoint=httpsOrigin(env.TEACHAPP_DELTA_ENDPOINT);
 if(!origin||!endpoint||origin===endpoint)return null;
 return {kind:'candidate',origin,endpoint,pathVersion:'v3'};
}
export function deltaRequestAllowed(mode,url){
 return !!mode&&(mode.kind==='lab'?url.protocol==='http:'&&local.includes(url.hostname):url.origin===mode.endpoint&&url.protocol==='https:');
}
