/* Public preview: leave ordinary v10 workflows available. Experimental
 * migration UI is restricted to loopback synthetic profiles. Not a server
 * authorization boundary; production rules/keys must be reviewed separately. */
export function migrationLabAllowed(location=globalThis.location){
 try{
  const u=new URL(location.href);
  return ['http:','https:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&!u.username&&!u.password;
 }catch{return false;}
}
