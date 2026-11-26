/* Isolated encryption/migration LAB. No imports from or writes to the live TeachApp database. */
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
async function derive(password,salt){
 check(typeof password==='string'&&password.length>=12&&password.length<=1024,'Используйте отдельный пароль от 12 символов');
 const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const aad=(header,slot)=>encoder.encode(JSON.stringify(['teachapp-vault-lab',1,header.scope,header.vaultId,slot]));
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
export function openVaultLab(name){
 check(typeof name==='string'&&/^teachapp-vault-lab-[a-z0-9-]{1,80}$/.test(name),'Разрешено только отдельное имя базы LAB');
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(name,1);let blocked=false;
  req.onblocked=()=>{blocked=true;reject(Error('Закройте другие соединения LAB'));};
  req.onupgradeneeded=()=>{if(blocked)req.transaction.abort();else req.result.createObjectStore('sealed',{keyPath:'id'});};
  req.onerror=()=>reject(req.error);req.onsuccess=()=>{if(blocked)req.result.close();else{const db=req.result;db.onversionchange=()=>db.close();resolve(db);}};
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
  let conflict=false,failed=null;
  count.onsuccess=()=>{if(count.result){conflict=true;tx.abort();return;}try{for(const row of rows)store.add(row);}catch(e){failed=e;tx.abort();}};
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(conflict?Error('Хранилище LAB уже существует; перезапись запрещена'):failed||tx.error||Error('Запись отменена'));tx.onerror=()=>{};
 });
}
function assertLab(db){check(db&&/^teachapp-vault-lab-[a-z0-9-]{1,80}$/.test(db.name),'Разрешена только база LAB');}
/** Seal all rows before opening the transaction. No crypto inside an IDB transaction. */
async function sealSnapshot({scope,data,password}){
 check(validScope(scope),'Некорректная область');
 const snapshot=normalize(data),header={id:'header',version:1,scope,vaultId:hex(random(16)),iterations,salt:random(16)};
 const key=await derive(password,header.salt),ivs=new Set(),slots=new Set(),manifest=Object.create(null),rows=[header];
 for(const [name,records] of Object.entries(snapshot)){
  manifest[name]=[];
  for(const record of records){
   const slot=hex(uniqueRandom(slots,16));manifest[name].push(slot);rows.push(await encryptRow(key,header,slot,record,ivs));
  }
 }
 rows.push(await encryptRow(key,header,'manifest',manifest,ivs));
 const reopened=await decodeSnapshot(rows,{scope,password});
 check(JSON.stringify(reopened.data)===JSON.stringify(snapshot),'Проверка полноты снимка не прошла');
 return rows;
}
export async function stageVaultLab(db,{scope,data,password}){
 assertLab(db);
 const rows=await sealSnapshot({scope,data,password});
 await commitNew(db,rows);
 const reopened=await readVaultLab(db,{scope,password});
 check(reopened.revision===rows[0].vaultId,'Снимок LAB изменился после записи');
 return {scope,records:rows.length-2,verified:true};
}
/** Wrong password, altered/missing/extra records, or a foreign scope fail closed. */
async function decodeSnapshot(rows,{scope,password}){
 check(validScope(scope),'Некорректная область');
 const map=new Map(rows.map(r=>[r.id,r])),header=map.get('header');
 try{
  validateHeader(header);check(header.scope===scope,'Другая область');
  check(rows.length<=maxRecords+2&&map.size===rows.length,'Превышен лимит или повторный ключ');
  let sealedBytes=0;const ivs=new Set();for(const row of rows){if(row.id==='header')continue;check(bytes(row.iv,12)&&bytes(row.data),'Повреждён конверт');const iv=hex(row.iv);check(!ivs.has(iv),'Повторный IV');ivs.add(iv);sealedBytes+=row.data.byteLength;check(sealedBytes<=maxSealedBytes,'Превышен лимит шифротекста');}
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
  check(used.size===map.size,'Лишние записи');return {scope,revision:header.vaultId,data:normalize(snapshot)};
 }catch{throw Error('Не удалось открыть хранилище LAB: неверный пароль, область или повреждение данных');}
}

export async function readVaultLab(db,{scope,password}){
 assertLab(db);return decodeSnapshot(await readRows(db),{scope,password});
}
export async function unlockVaultLab(db,options){return (await readVaultLab(db,options)).data;}
const sameBytes=(a,b)=>bytes(a)&&bytes(b)&&a.length===b.length&&a.every((x,i)=>x===b[i]);
function sameRows(a,b){
 if(a.length!==b.length)return false;
 const map=new Map(b.map(r=>[r.id,r]));
 return a.every(row=>{
  const other=map.get(row.id);if(!other||Object.keys(row).sort().join('|')!==Object.keys(other).sort().join('|'))return false;
  return row.id==='header'?row.version===other.version&&row.scope===other.scope&&row.vaultId===other.vaultId&&row.iterations===other.iterations&&sameBytes(row.salt,other.salt):sameBytes(row.iv,other.iv)&&sameBytes(row.data,other.data);
 });
}
/** Compare every previously authenticated byte, not just an untrusted header. */
function commitReplace(db,before,after){
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('sealed','readwrite'),store=tx.objectStore('sealed'),read=store.getAll();let conflict=false,failed=null;
  read.onsuccess=()=>{try{if(!sameRows(read.result,before)){conflict=true;tx.abort();return;}store.clear();for(const row of after)store.add(row);}catch(e){failed=e;tx.abort();}};
  tx.oncomplete=()=>resolve();tx.onabort=()=>reject(conflict?Error('Снимок LAB изменился. Откройте заново'):failed||tx.error||Error('Запись отменена'));tx.onerror=()=>{};
 });
}
/** Whole-snapshot CAS, using fresh salt, vault ID and IVs on every rewrite.
 * The caller supplies the revision it actually inspected. No production adapter. */
export async function replaceVaultLab(db,{scope,password,expectedRevision,data,nextPassword=password}){
 assertLab(db);check(typeof expectedRevision==='string'&&idPattern.test(expectedRevision),'Требуется ревизия предпросмотра');
 const before=await readRows(db),old=await decodeSnapshot(before,{scope,password});
 check(old.revision===expectedRevision,'Снимок LAB изменился. Откройте заново');
 const after=await sealSnapshot({scope,data,password:nextPassword});
 await commitReplace(db,before,after);
 return {scope,revision:after[0].vaultId,records:after.length-2};
}
/** Portable ciphertext only. Recovery into an empty LAB DB is explicit and
 * requires authenticating the entire file with the original password. */
const b64=arr=>{let s='';for(let i=0;i<arr.length;i+=16384)s+=String.fromCharCode(...arr.subarray(i,i+16384));return btoa(s);};
function unb64(s,max){
 check(typeof s==='string'&&s.length<=Math.ceil(max/3)*4&&s.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(s),'Некорректная копия LAB');
 const b=Uint8Array.from(atob(s),x=>x.charCodeAt(0));check(b.length<=max&&b64(b)===s,'Некорректная копия LAB');return b;
}
const maxFileBytes=Math.ceil(maxSealedBytes/3)*4+maxRecords*256+4096;
export async function exportVaultLab(db,{scope,password}){
 assertLab(db);const rows=await readRows(db);await decodeSnapshot(rows,{scope,password});
 return JSON.stringify({app:'teachapp-vault-lab',version:1,rows:rows.map(r=>r.id==='header'?{...r,salt:b64(r.salt)}:{id:r.id,iv:b64(r.iv),data:b64(r.data)})});
}
export async function restoreVaultLab(db,{scope,password,file}){
 assertLab(db);check(typeof file==='string'&&file.length<=maxFileBytes,'Копия LAB слишком велика');
 const parsed=JSON.parse(file);check(parsed?.app==='teachapp-vault-lab'&&parsed.version===1&&Array.isArray(parsed.rows)&&parsed.rows.length<=maxRecords+2,'Некорректная копия LAB');
 let total=0;
 const rows=parsed.rows.map(r=>{
  check(plain(r)&&typeof r.id==='string','Некорректная копия LAB');
  if(r.id==='header'){
   check(Object.keys(r).sort().join('|')==='id|iterations|salt|scope|vaultId|version','Некорректный заголовок LAB');return {...r,salt:unb64(r.salt,16)};
  }
  check(Object.keys(r).sort().join('|')==='data|id|iv'&&(r.id==='manifest'||idPattern.test(r.id)),'Некорректная запись LAB');
  const data=unb64(r.data,maxSealedBytes-total);total+=data.length;return {id:r.id,iv:unb64(r.iv,12),data};
 });
 const opened=await decodeSnapshot(rows,{scope,password});
 // Generate a fresh independent revision/key derivation rather than copying
 // a revision token shared by two writable databases.
 const after=await sealSnapshot({scope,data:opened.data,password});
 await commitNew(db,after);return {scope,revision:after[0].vaultId,records:after.length-2};
}
