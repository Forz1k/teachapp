/* Encrypted transport of a separately provisioned device credential. No network or persistence. */
import {normalizeEndpoint,syncAreas} from './sync.js';
import {encryptBackup,decryptBackup} from './privacy.js';

const PREFIX='TA1.';
const MAX=8192;
function profile({endpoint,area,token}={}){
 const url=normalizeEndpoint(endpoint);
 if(!url.startsWith('https://')||url.length>512)throw Error('Код подключения требует HTTPS-адрес не длиннее 512 символов');
 if(!Object.hasOwn(syncAreas,area))throw Error('Неизвестная рабочая область');
 if(typeof token!=='string'||!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw Error('Введите отдельный ключ нового устройства');
 return {endpoint:url,area,token};
}
function encode(value){return btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function decode(value){
 if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw Error('Некорректный код подключения');
 const raw=atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length/4)*4,'='));
 return JSON.parse(raw);
}
export async function createPairingCode(options,password){
 const payload={app:'teachapp-pairing',version:1,...profile(options)};
 return PREFIX+encode(await encryptBackup(payload,password));
}
export async function readPairingCode(value,password){
 const code=typeof value==='string'?value.trim():'';
 if(code.length>MAX||!code.startsWith(PREFIX))throw Error('Некорректный или неподдерживаемый код подключения');
 let envelope;
 try{envelope=decode(code.slice(PREFIX.length));}catch{throw Error('Некорректный код подключения');}
 const payload=await decryptBackup(envelope,password);
 if(!payload||Object.keys(payload).sort().join(',')!=='app,area,endpoint,token,version'||payload.app!=='teachapp-pairing'||payload.version!==1)throw Error('Это не код подключения TeachApp');
 return profile(payload);
}
