/* The synthetic server is deliberately not a public staging service.
 * Host validation is defense-in-depth, not authentication or a firewall. */
const loopback=new Set(['127.0.0.1','localhost','[::1]']);
const local=u=>['http:','https:'].includes(u.protocol)&&loopback.has(u.hostname)&&!u.username&&!u.password;
export function syntheticPlatformConfig(env,requestURL){
 try{
  const origin=new URL(env.TEACHAPP_PLATFORM_ORIGIN),request=new URL(requestURL);
  if(env.TEACHAPP_PLATFORM_SYNTHETIC!=='true'||!local(origin)||!local(request)||origin.origin!==env.TEACHAPP_PLATFORM_ORIGIN||
   typeof env.TEACHAPP_PLATFORM_ROOT_HASH!=='string'||!/^[a-f0-9]{64}$/.test(env.TEACHAPP_PLATFORM_ROOT_HASH))return null;
  return {origin:origin.origin,rootHash:env.TEACHAPP_PLATFORM_ROOT_HASH};
 }catch{return null;}
}
