/* Single-use invitation, secret stays in the client; only ciphertext and a verifier reach the relay. */
import {parsePersonalCode,personalCredentials} from './personal-sync.js';
import {normalizeEndpoint} from './sync.js';
import {encryptBackup,decryptBackup,isEncryptedBackup} from './privacy.js';
export const DEFAULT_INVITE_ENDPOINT='https://teachapp-sync-beta.forzik.workers.dev';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const b64=b=>btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function unb64(s){
 if(!/^[A-Za-z0-9_-]+$/.test(s)||s.length%4===1)throw Error('Неверный код подключения');
 const b=Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
 if(b64(b)!==s)throw Error('Неверный код подключения');return b;
}
function endpointOf(s){const u=normalizeEndpoint(s);if(!u.startsWith('https://')||u.length>512)throw Error('Нужен HTTPS-сервер');return u;}
export function parseInvite(code){
 if(typeof code!=='string'||code.length>800)throw Error('Неверный код подключения');
 const parts=code.trim().split('.');
 if(parts[0]!=='TAC1'||![2,3].includes(parts.length))throw Error('Введите код TAC1');
 const secret=parts.at(-1);
 if(secret.length!==22||unb64(secret).length!==16)throw Error('Неверный код подключения');
 return {endpoint:parts.length===2?DEFAULT_INVITE_ENDPOINT:endpointOf(decoder.decode(unb64(parts[1]))),secret};
}
async function proof(secret){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode('teachapp/invite/v1/redeem/'+secret))));}
async function hex(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s))),b=>b.toString(16).padStart(2,'0')).join('');}
async function call(endpoint,operation,token,body,fetcher){
 const res=await fetcher(endpoint+'/v1/pairing/'+operation,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(15000)});
 if(res.status===404||res.status===410)throw Error('Код истёк, уже использован или сервер ещё не обновлён. Создайте новый код на телефоне.');
 if(!res.ok)throw Error('Подключение устройства не удалось (HTTP '+res.status+')');
 const text=await res.text();if(text.length>8192)throw Error('Неверный ответ сервера');return JSON.parse(text);
}
export async function createDeviceInvite(personalCode,fetcher=globalThis.fetch){
 const {endpoint}=parsePersonalCode(personalCode);
 const secret=b64(crypto.getRandomValues(new Uint8Array(16)));
 const envelope=await encryptBackup({app:'teachapp-device-invite',version:1,personalCode},secret);
 const credentials=await personalCredentials(personalCode,'school');
 const result=await call(endpoint,'create',credentials.token,{verifier:await hex(await proof(secret)),envelope},fetcher);
 if(result.status!=='created')throw Error('Сервер не подтвердил создание кода');
 return endpoint===DEFAULT_INVITE_ENDPOINT?'TAC1.'+secret:'TAC1.'+b64(encoder.encode(endpoint))+'.'+secret;
}
export async function redeemDeviceInvite(code,fetcher=globalThis.fetch){
 const {endpoint,secret}=parseInvite(code);
 const result=await call(endpoint,'redeem',await proof(secret),{},fetcher);
 if(!isEncryptedBackup(result.envelope))throw Error('Некорректное приглашение');
 const payload=await decryptBackup(result.envelope,secret);
 if(payload.app!=='teachapp-device-invite'||payload.version!==1||parsePersonalCode(payload.personalCode).endpoint!==endpoint)throw Error('Приглашение не соответствует серверу');
 return parsePersonalCode(payload.personalCode).code;
}
