/* Experimental v2 device pairing. No automatic production migration or stored administrator key. */
import {normalizeEndpoint,syncAreas,relayClient} from './sync.js';
import {parsePersonalCode,personalCredentials} from './personal-sync.js';
import {encryptBackup,decryptBackup,isEncryptedBackup} from './privacy.js';
import {DEFAULT_INVITE_ENDPOINT} from './device-invite.js';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const tokenPattern=/^[A-Za-z0-9_-]{32,256}$/,devicePattern=/^[A-Za-z0-9_-]{16,64}$/;
const b64=b=>btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const random=n=>b64(crypto.getRandomValues(new Uint8Array(n)));
function unb64(value){
 if(typeof value!=='string'||! /^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw Error('Некорректный код устройства');
 const bytes=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
 if(b64(bytes)!==value)throw Error('Некорректный код устройства');return bytes;
}
const validName=name=>typeof name==='string'&&name===name.trim()&&name.length>=1&&name.length<=80&&!/[\u0000-\u001f\u007f]/.test(name);
const validArea=area=>Object.hasOwn(syncAreas,area);
function httpsEndpoint(value){
 const endpoint=normalizeEndpoint(value);if(!endpoint.startsWith('https://')||endpoint.length>512)throw Error('Требуется HTTPS-сервер');return endpoint;
}
async function digest(value){return new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
async function hex(value){return Array.from(await digest(value),b=>b.toString(16).padStart(2,'0')).join('');}
async function proof(secret){return b64(await digest('teachapp/invite/v2/redeem/'+secret));}
function keys(value,expected){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===expected;}
export function parseTrustedInvite(code){
 if(typeof code!=='string'||code.length>800)throw Error('Некорректное приглашение');
 const parts=code.trim().split('.');
 if(parts[0]!=='TAD2'||![2,3].includes(parts.length))throw Error('Введите приглашение TAD2');
 const secret=parts.at(-1);if(secret.length!==22||unb64(secret).length!==16)throw Error('Некорректное приглашение');
 const endpoint=parts.length===2?DEFAULT_INVITE_ENDPOINT:httpsEndpoint(decoder.decode(unb64(parts[1])));
 return {endpoint,secret};
}
export function parseTrustedProfile(value){
 if(!keys(value,'areas,deviceId,endpoint,name,version')||value.version!==2||!devicePattern.test(value.deviceId)||!validName(value.name))throw Error('Некорректный профиль устройства');
 const endpoint=httpsEndpoint(value.endpoint),areas=value.areas;
 if(!areas||typeof areas!=='object'||Array.isArray(areas)||!Object.keys(areas).length||Object.keys(areas).some(a=>!validArea(a)))throw Error('Некорректные контуры устройства');
 const clean={};
 for(const [area,credentials] of Object.entries(areas)){
  if(!keys(credentials,'password,token')||typeof credentials.token!=='string'||typeof credentials.password!=='string'||credentials.token.length!==43||credentials.password.length!==43||unb64(credentials.token).length!==32||unb64(credentials.password).length!==32||credentials.token===credentials.password)throw Error('Некорректные ключи устройства');
  clean[area]={token:credentials.token,password:credentials.password};
 }
 if(new Set(Object.values(clean).flatMap(c=>[c.token,c.password])).size!==Object.keys(clean).length*2)throw Error('Ключи устройства должны различаться');
 return {version:2,endpoint,deviceId:value.deviceId,name:value.name,areas:clean};
}
async function request(endpoint,path,token,{method='GET',body,fetcher=globalThis.fetch}={}){
 endpoint=httpsEndpoint(endpoint);if(typeof token!=='string'||!tokenPattern.test(token))throw Error('Неверный ключ устройства или владельца');
 const res=await fetcher(endpoint+path,{method,headers:{Authorization:'Bearer '+token,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
 if(!res.ok)throw Error(res.status===410?'Приглашение истекло или уже использовано':'Операция с устройством не выполнена (HTTP '+res.status+')');
 const length=Number(res.headers.get('content-length')||0);if(length>65536)throw Error('Слишком большой ответ сервера');
 let text='';
 if(res.body?.getReader){
  const reader=res.body.getReader(),decode=new TextDecoder('utf-8',{fatal:true});let size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();throw Error('Слишком большой ответ сервера');}text+=decode.decode(part.value,{stream:true});}text+=decode.decode();}finally{reader.releaseLock();}
 }else{text=await res.text();if(text.length>65536)throw Error('Слишком большой ответ сервера');}
 return JSON.parse(text);
}
function deviceMeta(value){
 if(!keys(value,'createdAt,id,lastSeen,name,revokedAt')||!devicePattern.test(value.id)||!validName(value.name)||!Number.isSafeInteger(value.createdAt)||value.createdAt<0||!['lastSeen','revokedAt'].every(k=>value[k]===null||Number.isSafeInteger(value[k])&&value[k]>=0))throw Error('Неверные сведения об устройстве');
 return {id:value.id,name:value.name,createdAt:value.createdAt,lastSeen:value.lastSeen,revokedAt:value.revokedAt};
}
export async function listTrustedDevices(endpoint,adminToken,area,fetcher=globalThis.fetch){
 if(!validArea(area))throw Error('Неизвестный контур');
 const result=await request(endpoint,'/v2/devices/'+area,adminToken,{fetcher});
 if(!keys(result,'devices')||!Array.isArray(result.devices)||result.devices.length>128)throw Error('Неверный список устройств');
 return result.devices.map(deviceMeta);
}
export async function revokeTrustedDevice(endpoint,adminToken,area,id,fetcher=globalThis.fetch){
 if(!validArea(area)||!devicePattern.test(id))throw Error('Некорректное устройство');
 const result=await request(endpoint,'/v2/devices/'+area+'/revoke',adminToken,{method:'POST',body:{id},fetcher});
 const meta=deviceMeta(result?.device);if(meta.id!==id||meta.revokedAt===null)throw Error('Сервер не подтвердил отзыв устройства');return meta;
}
export async function createTrustedInvite({personalCode,adminToken,name,areas=Object.keys(syncAreas),fetcher=globalThis.fetch}){
 const {endpoint}=parsePersonalCode(personalCode);
 if(!validName(name)||!Array.isArray(areas)||!areas.length||new Set(areas).size!==areas.length||areas.some(a=>!validArea(a)))throw Error('Проверьте имя и контуры устройства');
 const deviceId=crypto.randomUUID(),credentials={};
 for(const area of areas){const legacy=await personalCredentials(personalCode,area);credentials[area]={token:random(32),password:legacy.password};}
 const profile=parseTrustedProfile({version:2,endpoint,deviceId,name,areas:credentials});
 const attempted=[];
 try{
  for(const area of areas){
   attempted.push(area); // A lost response may still mean the server registered the token.
   const result=await request(endpoint,'/v2/devices/'+area,adminToken,{method:'POST',body:{id:deviceId,name,tokenHash:await hex(profile.areas[area].token)},fetcher});
   const meta=deviceMeta(result?.device);if(meta.id!==deviceId||meta.revokedAt!==null)throw Error('Сервер не подтвердил создание устройства');
  }
  const secret=random(16),envelope=await encryptBackup({app:'teachapp-trusted-device',version:2,profile},secret);
  const result=await request(endpoint,'/v2/pairing/create',adminToken,{method:'POST',body:{verifier:await hex(await proof(secret)),envelope},fetcher});
  if(result?.status!=='created')throw Error('Сервер не подтвердил приглашение');
  const code=endpoint===DEFAULT_INVITE_ENDPOINT?'TAD2.'+secret:'TAD2.'+b64(encoder.encode(endpoint))+'.'+secret;
  return {code,deviceId,areas:[...areas]};
 }catch{
  // Best-effort compensation across independent contour objects. Never claim full
  // rollback if a contour cannot be reached; owner can revoke by the shown ID.
  const cleanup=await Promise.allSettled(attempted.map(area=>revokeTrustedDevice(endpoint,adminToken,area,deviceId,fetcher)));
  const failed=cleanup.some(x=>x.status==='rejected');
  throw Error(failed?'Не удалось завершить создание. Проверьте и отзовите устройство '+deviceId+' во всех выбранных контурах.':'Не удалось создать приглашение. Выданные ключи отозваны.');
 }
}
export async function redeemTrustedInvite(code,fetcher=globalThis.fetch){
 const {endpoint,secret}=parseTrustedInvite(code);
 const result=await request(endpoint,'/v2/pairing/redeem',await proof(secret),{method:'POST',body:{},fetcher});
 if(!isEncryptedBackup(result?.envelope))throw Error('Некорректное приглашение');
 const payload=await decryptBackup(result.envelope,secret);
 if(payload?.app!=='teachapp-trusted-device'||payload.version!==2)throw Error('Некорректное приглашение');
 const profile=parseTrustedProfile(payload.profile);if(profile.endpoint!==endpoint)throw Error('Приглашение не соответствует серверу');return profile;
}
export function trustedCredentials(profile,area){
 const parsed=parseTrustedProfile(profile);if(!Object.hasOwn(parsed.areas,area))throw Error('Этот контур недоступен устройству');
 return {area,endpoint:parsed.endpoint,...parsed.areas[area],protocolVersion:2};
}
export function trustedRelayClient(profile,area,options={}){
 const {endpoint,token,protocolVersion}=trustedCredentials(profile,area);
 return relayClient(endpoint,area,token,{...options,protocolVersion});
}
