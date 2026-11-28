/* Encrypted storage keeps sync secrets only for the unlocked document. */
import {isEncryptedStorage,encryptedStorageAllowed} from './db.js';
const memory=new Map();
export function clearSessionSyncCredentials(){memory.clear();}
const session=Object.freeze({
 getItem(key){return encryptedStorageAllowed()?memory.get(key)??null:null;},
 setItem(key,value){if(!encryptedStorageAllowed())throw Error('Сеанс закрыт');memory.set(key,String(value));},
 removeItem(key){memory.delete(key);}
});
export const syncCredentialStorage=()=>isEncryptedStorage()?session:globalThis.localStorage;
