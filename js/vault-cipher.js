/* Shared ciphertext codec, isolated authenticated domains, no DB access. */
export function createVaultCipher(domain){
 if(!['teachapp-vault-lab','teachapp-vault-storage-v11'].includes(domain))throw Error('Unknown ciphertext domain');
const iterations=600000,maxRecords=10000,maxBytes=64*1024*1024;
const maxSealedBytes=maxBytes+4*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validScope=v=>v==='school'||v==='coach'||v==='workspace';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const random=n=>crypto.getRandomValues(new Uint8Array(n));
const idPattern=/^[0-9a-f]{32}$/;
const bytes=(v,n)=>v instanceof Uint8Array&&(n===undefined||v.byteLength===n);
const tableName=n=>/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(n)&&!['constructor','prototype'].includes(n);
async function importMaterial(password){
 check(typeof password==='string'&&password.length>=12&&password.length<=1024,'Используйте отдельный пароль от 12 символов');
 const encoded=encoder.encode(password);
 try{return await crypto.subtle.importKey('raw',encoded,'PBKDF2',false,['deriveKey']);}finally{encoded.fill(0);}
}
const deriveMaterial=(material,salt)=>crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
async function derive(password,salt){return deriveMaterial(await importMaterial(password),salt);}
const aad=(header,slot)=>encoder.encode(JSON.stringify([domain,1,header.scope,header.vaultId,slot]));
function validateHeader(h){
 check(plain(h)&&h.id==='header'&&h.version===1&&validScope(h.scope)&&idPattern.test(h.vaultId)&&bytes(h.salt,16)&&h.iterations===iterations,'Повреждён заголовок хранилища');
}
// Refuse lossy JSON conversion rather than claiming an incomplete migration.
function checkJson(value,stack=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)&&!Object.is(value,-0))return;
 check(typeof value==='object'&&value!==null&&!stack.has(value),'Снимок содержит неподдерживаемое значение');
 const proto=Object.getPrototypeOf(value);check(Array.isArray(value)||proto===Object.prototype||proto===null,'Снимок содержит неподдерживаемый тип');
 check(!Object.getOwnPropertySymbols(value).length,'Снимок содержит неподдерживаемый ключ');
 stack.add(value);
 if(Array.isArray(value)){
  check(Object.keys(value).length===value.length,'Снимок содержит разреженный массив');
  for(let i=0;i<value.length;i++)checkJson(value[i],stack);
 }else for(const key of Object.keys(value))checkJson(value[key],stack);
 stack.delete(value);
}
function normalize(data){
 check(plain(data)&&Object.keys(data).length<=64,'Некорректный снимок LAB');
 let count=0,size=0;
 const snapshot=Object.create(null);
 for(const [name,rows] of Object.entries(data)){
  check(tableName(name)&&Array.isArray(rows),'Некорректная таблица LAB');
  const seen=new Set();snapshot[name]=[];
  for(const row of rows){
   check(plain(row)&&typeof row.id==='string'&&row.id.length>0&&row.id.length<=1024&&!seen.has(row.id),'Повторный или отсутствующий ID');
   checkJson(row);const json=JSON.stringify(row);size+=encoder.encode(json).length;count++;
   check(count<=maxRecords&&size<=maxBytes,'Снимок LAB превышает лимит');
   seen.add(row.id);snapshot[name].push(JSON.parse(json));
  }
 }
 return snapshot;
}
function uniqueRandom(used,n){
 for(let i=0;i<20;i++){const v=random(n),s=hex(v);if(!used.has(s)){used.add(s);return v;}}
 throw Error('Не удалось создать уникальный случайный идентификатор');
}
async function encryptRow(key,header,slot,value,ivs){
 const iv=uniqueRandom(ivs,12),data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(header,slot),tagLength:128},key,encoder.encode(JSON.stringify(value))));
 return {id:slot,iv,data};
}
async function decryptRow(key,header,row,slot){
 check(row?.id===slot&&bytes(row.iv,12)&&bytes(row.data)&&row.data.byteLength>=16&&row.data.byteLength<=maxBytes+16,'Повреждён конверт');
 return JSON.parse(decoder.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:aad(header,slot),tagLength:128},key,row.data)));
}
async function sealSnapshot({scope,data,password,material}){
 check(validScope(scope),'Некорректная область');
 const snapshot=normalize(data),header={id:'header',version:1,scope,vaultId:hex(random(16)),iterations,salt:random(16)};
 const key=material?await deriveMaterial(material,header.salt):await derive(password,header.salt),ivs=new Set(),slots=new Set(),manifest=Object.create(null),rows=[header];
 for(const [name,records] of Object.entries(snapshot)){
  manifest[name]=[];
  for(const record of records){
   const slot=hex(uniqueRandom(slots,16));manifest[name].push(slot);rows.push(await encryptRow(key,header,slot,record,ivs));
  }
 }
 rows.push(await encryptRow(key,header,'manifest',manifest,ivs));
 const reopened=await decodeSnapshot(rows,{scope,key,expectedHeader:header});
 check(JSON.stringify(reopened.data)===JSON.stringify(snapshot),'Проверка полноты снимка не прошла');
 return rows;
}
async function decodeSnapshot(rows,{scope,password,material,key:sessionKey,expectedHeader}){
 check(validScope(scope),'Некорректная область');
 const map=new Map(rows.map(r=>[r.id,r])),header=map.get('header');
 try{
  validateHeader(header);check(header.scope===scope,'Другая область');
  check(rows.length<=maxRecords+2&&map.size===rows.length,'Превышен лимит или повторный ключ');
  let sealedBytes=0;const ivs=new Set();for(const row of rows){if(row.id==='header')continue;check(bytes(row.iv,12)&&bytes(row.data),'Повреждён конверт');const iv=hex(row.iv);check(!ivs.has(iv),'Повторный IV');ivs.add(iv);sealedBytes+=row.data.byteLength;check(sealedBytes<=maxSealedBytes,'Превышен лимит шифротекста');}
  if(sessionKey)check(expectedHeader&&header.vaultId===expectedHeader.vaultId&&sameBytes(header.salt,expectedHeader.salt),'Ревизия LAB изменена');
  const key=sessionKey||(material?await deriveMaterial(material,header.salt):await derive(password,header.salt)),manifest=await decryptRow(key,header,map.get('manifest'),'manifest'),used=new Set(['header','manifest']),snapshot=Object.create(null);
  check(plain(manifest)&&Object.keys(manifest).length<=64,'Некорректный манифест');
  for(const [name,slots] of Object.entries(manifest)){
   check(tableName(name)&&Array.isArray(slots)&&slots.length<=maxRecords,'Некорректный манифест');
   snapshot[name]=[];
   for(const slot of slots){
    check(typeof slot==='string'&&idPattern.test(slot)&&!used.has(slot)&&used.size<maxRecords+2,'Некорректная ссылка');
    used.add(slot);snapshot[name].push(await decryptRow(key,header,map.get(slot),slot));
   }
  }
  check(used.size===map.size,'Лишние записи');return {scope,revision:header.vaultId,data:normalize(snapshot)};
 }catch{throw Error('Не удалось открыть хранилище LAB: неверный пароль, область или повреждение данных');}
}

const sameBytes=(a,b)=>bytes(a)&&bytes(b)&&a.length===b.length&&a.every((x,i)=>x===b[i]);

function sameRows(a,b){
 if(a.length!==b.length)return false;
 const map=new Map(b.map(r=>[r.id,r]));
 return a.every(row=>{
  const other=map.get(row.id);if(!other||Object.keys(row).sort().join('|')!==Object.keys(other).sort().join('|'))return false;
  return row.id==='header'?row.version===other.version&&row.scope===other.scope&&row.vaultId===other.vaultId&&row.iterations===other.iterations&&sameBytes(row.salt,other.salt):sameBytes(row.iv,other.iv)&&sameBytes(row.data,other.data);
 });
}
function partitionIdentity(data,scope,bundleId){
 const rows=data?.bundleMeta,r=rows?.[0];
 check(['school','coach','workspace'].includes(scope)&&typeof bundleId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bundleId)&&Array.isArray(rows)&&rows.length===1&&r&&Object.keys(r).sort().join('|')==='bundleId|id|scope'&&r.id==='bundle'&&r.scope===scope&&r.bundleId===bundleId,'Другая область или набор LAB');
}
async function sealPartitionScope({scope,bundleId,password,data}){
 partitionIdentity(data,scope,bundleId);return sealSnapshot({scope,data,password});
}
function samePartitionCiphertext(a,b){return sameRows(a,b);}
async function openPartitionKeySession({scope,bundleId,password,rows,assertActive=()=>{}}){
 assertActive();let material=await importMaterial(password);password=undefined;
 const close=()=>{material=null;};
 const guard=()=>{check(material,'Сеанс LAB заблокирован');assertActive();};
 async function read(input){
  try{guard();const value=await decodeSnapshot(input,{scope,material});guard();partitionIdentity(value.data,scope,bundleId);return value;}catch(e){close();throw e;}
 }
 async function seal(data){
  try{guard();partitionIdentity(data,scope,bundleId);const value=await sealSnapshot({scope,data,material});guard();return value;}catch(e){close();throw e;}
 }
 try{await read(rows);return Object.freeze({read,seal,close,isLocked:()=>material===null});}catch(e){close();throw e;}
}

 return Object.freeze({iterations,maxRecords,maxBytes,maxSealedBytes,check,plain,validScope,hex,random,idPattern,bytes,tableName,importMaterial,deriveMaterial,derive,validateHeader,normalize,sealSnapshot,decodeSnapshot,sameBytes,sameRows,sealPartitionScope,samePartitionCiphertext,openPartitionKeySession});
}
export const storageCipher=createVaultCipher('teachapp-vault-storage-v11');
