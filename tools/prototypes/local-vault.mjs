/* Isolated encryption/migration LAB. No imports from or writes to the live TeachApp database. */
const iterations=600000,maxRecords=10000,maxBytes=64*1024*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validScope=v=>v==='school'||v==='coach';
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const random=n=>crypto.getRandomValues(new Uint8Array(n));
const idPattern=/^[0-9a-f]{32}$/;
const bytes=(v,n)=>v instanceof Uint8Array&&(n===undefined||v.byteLength===n);
const tableName=n=>/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(n)&&!['constructor','prototype'].includes(n);
async function derive(password,salt){
 check(typeof password==='string'&&password.length>=12&&password.length<=1024,'Используйте отдельный пароль от 12 символов');
 const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const aad=(header,slot)=>encoder.encode(JSON.stringify(['teachapp-vault-lab',1,header.scope,header.vaultId,slot]));
function validateHeader(h){
 check(plain(h)&&h.id==='header'&&h.version===1&&validScope(h.scope)&&idPattern.test(h.vaultId)&&bytes(h.salt,16)&&h.iterations===iterations,'Повреждён заголовок хранилища');
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
   const json=JSON.stringify(row);size+=encoder.encode(json).length;count++;
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
export function openVaultLab(name){
 check(typeof name==='string'&&/^teachapp-vault-lab-[a-z0-9-]{1,80}$/.test(name),'Разрешено только отдельное имя базы LAB');
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,1);let blocked=false;
  req.onblocked=()=>{blocked=true;reject(Error('Закройте другие соединения LAB'));};
  req.onupgradeneeded=()=>{if(blocked)req.transaction.abort();else req.result.createObjectStore('sealed',{keyPath:'id'});};
  req.onerror=()=>reject(req.error);req.onsuccess=()=>{if(blocked)req.result.close();else resolve(req.result);};
 });
}
function readRows(db){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('sealed','readonly'),req=tx.objectStore('sealed').getAll();
  tx.oncomplete=()=>resolve(req.result);tx.onabort=()=>reject(tx.error||Error('Чтение отменено'));tx.onerror=()=>reject(tx.error||req.error);
 });
}
function commitNew(db,rows){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('sealed','readwrite'),store=tx.objectStore('sealed'),count=store.count();
  let conflict=false;
  count.onsuccess=()=>{if(count.result){conflict=true;tx.abort();return;}for(const row of rows)store.add(row);};
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(conflict?Error('Хранилище LAB уже существует; перезапись запрещена'):tx.error||Error('Запись отменена'));tx.onerror=()=>{};
 });
}
function assertLab(db){check(db&&/^teachapp-vault-lab-[a-z0-9-]{1,80}$/.test(db.name),'Разрешена только база LAB');}
/** Seal all rows before opening the transaction. No crypto inside an IDB transaction. */
export async function stageVaultLab(db,{scope,data,password}){
 assertLab(db);check(validScope(scope),'Некорректная область');
 const snapshot=normalize(data),header={id:'header',version:1,scope,vaultId:hex(random(16)),iterations,salt:random(16)};
 const key=await derive(password,header.salt),ivs=new Set(),slots=new Set(),manifest=Object.create(null),rows=[header];
 for(const [name,records] of Object.entries(snapshot)){
  manifest[name]=[];
  for(const record of records){
   const slot=hex(uniqueRandom(slots,16));manifest[name].push(slot);rows.push(await encryptRow(key,header,slot,record,ivs));
  }
 }
 rows.push(await encryptRow(key,header,'manifest',manifest,ivs));
 await commitNew(db,rows);
 // Independently derive the key and authenticate every row before returning success.
 const reopened=await unlockVaultLab(db,{scope,password});
 check(JSON.stringify(reopened)===JSON.stringify(snapshot),'Проверка полноты снимка не прошла');
 return {scope,records:rows.length-2,verified:true};
}
/** Wrong password, altered/missing/extra records, or a foreign scope fail closed. */
export async function unlockVaultLab(db,{scope,password}){
 assertLab(db);check(validScope(scope),'Некорректная область');
 const rows=await readRows(db),map=new Map(rows.map(r=>[r.id,r])),header=map.get('header');
 try{
  validateHeader(header);check(header.scope===scope,'Другая область');
  check(rows.length<=maxRecords+2,'Превышен лимит');
  const key=await derive(password,header.salt),manifest=await decryptRow(key,header,map.get('manifest'),'manifest'),used=new Set(['header','manifest']),snapshot=Object.create(null);
  check(plain(manifest)&&Object.keys(manifest).length<=64,'Некорректный манифест');
  for(const [name,slots] of Object.entries(manifest)){
   check(tableName(name)&&Array.isArray(slots)&&slots.length<=maxRecords,'Некорректный манифест');
   snapshot[name]=[];
   for(const slot of slots){
    check(typeof slot==='string'&&idPattern.test(slot)&&!used.has(slot)&&used.size<maxRecords+2,'Некорректная ссылка');
    used.add(slot);snapshot[name].push(await decryptRow(key,header,map.get(slot),slot));
   }
  }
  check(used.size===map.size,'Лишние записи');return normalize(snapshot);
 }catch{throw Error('Не удалось открыть хранилище LAB: неверный пароль, область или повреждение данных');}
}
