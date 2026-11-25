/* Шифрование файла, не самой IndexedDB. Пароль и ключ не сохраняются. */
const ITERATIONS=600000, LIMIT=64*1024*1024;
const header='teachapp-encrypted-backup:1:PBKDF2-SHA256:600000:AES-256-GCM';
const encoder=new TextEncoder();
const decoder=new TextDecoder('utf-8',{fatal:true});
const webCrypto=()=>{if(!globalThis.crypto?.subtle)throw Error('Шифрование доступно только в защищённом контексте HTTPS или localhost');return globalThis.crypto;};
const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};
function unb64(s,max){
  if(typeof s!=='string'||s.length>Math.ceil(max/3)*4||!s.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(s)||s.length%4!==0)throw Error('Некорректный защищённый файл');
  const raw=atob(s);if(raw.length>max)throw Error('Слишком большой защищённый файл');
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function key(password,salt){
  if(typeof password!=='string'||!password||password.length>1024)throw Error('Проверьте пароль');
  const c=webCrypto(),material=await c.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
  return c.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export const isEncryptedBackup=p=>p?.app==='teachapp-encrypted';
const envelopeFor=(salt,iv,data)=>({app:'teachapp-encrypted',version:1,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,cipher:'AES-256-GCM',salt,iv,data});
// Exact JSON byte count for this envelope: UTF-8 plaintext, GCM's 16-byte tag,
// then base64. No key derivation, encryption, storage or network is necessary.
export function encryptedEnvelopeBytes(payload){
 const size=encoder.encode(JSON.stringify(payload)).length;
 if(size>LIMIT)throw Error('Копия слишком велика для шифрования на устройстве');
 return JSON.stringify(envelopeFor('A'.repeat(22)+'==','A'.repeat(16),'')).length+4*Math.ceil((size+16)/3);
}
export async function encryptBackup(payload,password){
  if(typeof password!=='string'||password.length<12)throw Error('Используйте пароль не короче 12 символов');
  const c=webCrypto(),salt=c.getRandomValues(new Uint8Array(16)),iv=c.getRandomValues(new Uint8Array(12));
  const plaintext=encoder.encode(JSON.stringify(payload));
  if(plaintext.length>LIMIT)throw Error('Копия слишком велика для шифрования на устройстве');
  const encrypted=await c.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(header),tagLength:128},await key(password,salt),plaintext);
  return envelopeFor(b64(salt),b64(iv),b64(new Uint8Array(encrypted)));
}
export async function decryptBackup(p,password){
  if(!isEncryptedBackup(p)||p.version!==1||p.kdf!=='PBKDF2-SHA256'||p.iterations!==ITERATIONS||p.cipher!=='AES-256-GCM')throw Error('Неподдерживаемый формат защищённой копии');
  try{
    const salt=unb64(p.salt,16),iv=unb64(p.iv,12),data=unb64(p.data,LIMIT+16);
    if(salt.length!==16||iv.length!==12||data.length<16)throw Error('Invalid envelope');
    const raw=await webCrypto().subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(header),tagLength:128},await key(password,salt),data);
    return JSON.parse(decoder.decode(raw));
  }catch{throw Error('Не удалось открыть копию: неверный пароль или файл повреждён');}
}
