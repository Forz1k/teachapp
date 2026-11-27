/* Synthetic-only adapter for the current TeachApp schema.
 * No connection to db.open(), live IndexedDB, device checkpoints or sync.
 * Whole-snapshot CAS is intentionally a correctness baseline, not production storage. */
import {SCHEMA} from '../../js/db.js';
import {splitDeviceSnapshot,joinDeviceSnapshot} from '../../js/device-checkpoint-migration.js';
import {BACKUP_VERSION,validateBackup} from '../../js/backup.js';
import {stageVaultLab,readVaultLab,replaceVaultLab} from './local-vault.mjs';
import {checkedData,prepareSchemaSnapshotTransaction as prepareSchemaSnapshotTransactionLab} from '../../js/vault-snapshot-transaction.js';
export {prepareSchemaSnapshotTransactionLab};
const scope='workspace',check=(v,msg)=>{if(!v)throw Error(msg);},copy=v=>structuredClone(v);
export async function stageSchemaVault(db,{backup,password}){
 check(backup?.version===BACKUP_VERSION&&!backup.scope&&backup.app==='teachapp','Нужна полная копия текущего формата');
 const data=checkedData(copy(backup.data));
 return stageVaultLab(db,{scope,data,password});
}
/** Uses the same store/index names and Promise API as js/db.js. Callback must
 * await its requests; no raw IDB transaction, cursor, arbitrary key type or
 * production adapter is promised. Conflicts never retry user callbacks. */
export function schemaVaultAdapter(db,{password,keySession,assertActive=()=>{}}){
 check(!keySession||(password===undefined&&keySession.scope===scope),'Некорректный ключевой сеанс LAB');
 let closed=false,key=password;
 const guard=()=>{check(!closed,'Хранилище LAB закрыто');assertActive();};
 async function transaction(storeNames,mode,fn){
  guard();const pass=key,opened=await (keySession?keySession.read(db,{assertActive:guard}):readVaultLab(db,{scope,password:pass}));guard();
  const {result,data}=await prepareSchemaSnapshotTransactionLab(opened.data,storeNames,mode,fn,{guard,isOpen:()=>{try{guard();return true;}catch{return false;}}});
  if(mode==='readwrite'){
   const options={expectedRevision:opened.revision,data,assertActive:guard};
   if(keySession)await keySession.replace(db,options);else await replaceVaultLab(db,{scope,password:pass,...options});
  }
  guard();return result;
 }
 return {transaction,async snapshot(){guard();const result=await (keySession?keySession.read(db,{assertActive:guard}):readVaultLab(db,{scope,password:key}));guard();return checkedData(result.data);},close(){closed=true;key='';}};
}
