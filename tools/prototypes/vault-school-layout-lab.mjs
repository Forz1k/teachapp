/* Shared pure school-v2 layout; only this wrapper validates LAB envelopes. */
import {splitSchoolVaultLayout as splitSchoolVaultLayoutLab,joinSchoolVaultLayout as joinSchoolVaultLayoutLab,splitVaultScopes} from '../../js/vault-layout.js';
import {SCHEMA} from '../../js/db.js';
export {splitSchoolVaultLayoutLab,joinSchoolVaultLayoutLab};
const scopes=['school','coach','workspace'],check=(v,m)=>{if(!v)throw Error(m);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function blank(){const parts=splitVaultScopes(Object.fromEntries(Object.keys(SCHEMA).map(n=>[n,[]])));parts.school.meta=[];return parts;}
export function validateSchoolVaultLayoutResultLab(result,scope){
 check(scopes.includes(scope)&&result?.scope===scope,'Неизвестная область LAB');
 const {bundleMeta,...part}=result.data,meta=bundleMeta?.[0];
 check(Array.isArray(bundleMeta)&&bundleMeta.length===1&&exact(meta,['id','scope','bundleId'])&&meta.id==='bundle'&&meta.scope===scope&&typeof meta.bundleId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(meta.bundleId),'Повреждена связь областей LAB');
 joinSchoolVaultLayoutLab({...blank(),[scope]:part});
 return {bundleId:meta.bundleId,scope,revision:result.revision,data:part};
}
