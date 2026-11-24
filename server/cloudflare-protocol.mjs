export const LIMIT=1024*1024;
const encoder=new TextEncoder();
export async function digestToken(token){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
}
