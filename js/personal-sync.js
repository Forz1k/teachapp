/* Personal workspace secret. Never log or include the code in a backup or URL. */
import {normalizeEndpoint,syncAreas} from './sync.js';
const PREFIX='TAP1',KEY='teachapp.personal-sync.v1';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
function b64(bytes){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function bytes(value){
 if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw Error('Некорректный личный код');
 const raw=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'=')),c=>c.charCodeAt(0));
 if(b64(raw)!==value)throw Error('Некорректный личный код');
 return raw;
}
function address(value){
 const url=normalizeEndpoint(value);
 if(!url.startsWith('https://')||url.length>512)throw Error('Личный код требует HTTPS-адрес');
 return url;
}
export function createPersonalCode(endpoint){
 return PREFIX+'.'+b64(encoder.encode(address(endpoint)))+'.'+b64(crypto.getRandomValues(new Uint8Array(32)));
}
export function parsePersonalCode(value){
 const code=typeof value==='string'?value.trim():'';
 if(code.length>800)throw Error('Слишком длинный личный код');
 const parts=code.split('.');
 if(parts.length!==3||parts[0]!==PREFIX||parts[2].length!==43)throw Error('Некорректный личный код TeachApp');
 const endpoint=address(decoder.decode(bytes(parts[1]))),seed=bytes(parts[2]);
 if(seed.length!==32)throw Error('Некорректный личный код');
 return {code,endpoint,seed};
}
export async function personalCredentials(code,area){
 if(!Object.hasOwn(syncAreas,area))throw Error('Неизвестный контур');
 const {endpoint,seed}=parsePersonalCode(code);
 const key=await crypto.subtle.importKey('raw',seed,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const derive=async purpose=>b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode('teachapp/personal/v1/'+area+'/'+purpose))));
 return {endpoint,area,token:await derive('access'),password:await derive('encryption')};
}
export async function personalTokenHashes(code){
 const pairs=await Promise.all(Object.keys(syncAreas).map(async area=>{
  const {token}=await personalCredentials(code,area);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(token))),n=>n.toString(16).padStart(2,'0')).join('');
  return [area,[hash]];
 }));
 return Object.fromEntries(pairs);
}
export function readPersonalCode(storage=globalThis.localStorage){
 try{const value=storage.getItem(KEY);return value?parsePersonalCode(value).code:null;}catch{return null;}
}
export function savePersonalCode(code,storage=globalThis.localStorage){
 const parsed=parsePersonalCode(code);
 const old=readPersonalCode(storage);
 if(old&&old!==parsed.code)throw Error('Сначала забудьте старый личный код');
 storage.setItem(KEY,parsed.code);
 if(readPersonalCode(storage)!==parsed.code)throw Error('Не удалось сохранить подключение');
}
export function forgetPersonalCode(storage=globalThis.localStorage){storage.removeItem(KEY);}
