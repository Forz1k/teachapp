/* Read-only validation and separation of device-local sync state for the
 * explicit encrypted migration rehearsal. Not a sync client or portable backup. */
import {normalizeEndpoint,isSyncCheckpoint} from './sync.js';
const areas=['school','coach'],check=(v,m)=>{if(!v)throw Error(m);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const b64=s=>typeof s==='string'&&s.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(s);
function identity(row){
 return typeof row.workspaceId==='string'&&uuid.test(row.workspaceId)&&Number.isSafeInteger(row.revision)&&row.revision>0&&typeof row.endpoint==='string'&&normalizeEndpoint(row.endpoint)===row.endpoint;
}
function envelope(e){
 return exact(e,['app','version','kdf','iterations','cipher','salt','iv','data'])&&e.app==='teachapp-encrypted'&&e.version===1&&e.kdf==='PBKDF2-SHA256'&&e.iterations===600000&&e.cipher==='AES-256-GCM'&&b64(e.salt)&&e.salt.length===24&&e.salt.endsWith('==')&&b64(e.iv)&&e.iv.length===16&&!e.iv.includes('=')&&typeof e.data==='string'&&e.data.length>=24&&e.data.length<=Math.ceil((64*1024*1024+16)/3)*4&&b64(e.data);
}
export function validateDeviceCheckpoints(rows){
 check(Array.isArray(rows)&&rows.length<=6,'Неизвестные контрольные точки устройства');
 const byId=new Map();
 for(const row of rows){
  check(row&&typeof row.id==='string'&&!byId.has(row.id),'Повтор контрольной точки устройства');
  if(row.id.startsWith('sync-checkpoint-migration-')){
   const area=areas.find(a=>row.id==='sync-checkpoint-migration-'+a),https=x=>{try{const u=new URL(x);return u.protocol==='https:'&&u.origin===x&&!u.port&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname);}catch{return false;}};
   check(area&&row.protocol==='delta-v3'&&exact(row,['id','protocol','sourceProtocolVersion','area','migrationId','sourceEndpoint','sourceWorkspaceId','sourceRevision','destinationEndpoint','destinationWorkspaceId','destinationRevision','digest'])&&row.area===area&&[1,2].includes(row.sourceProtocolVersion)&&uuid.test(row.migrationId)&&uuid.test(row.sourceWorkspaceId)&&row.migrationId!==row.sourceWorkspaceId&&row.destinationWorkspaceId===row.migrationId&&Number.isSafeInteger(row.sourceRevision)&&row.sourceRevision>0&&row.destinationRevision===1&&https(row.sourceEndpoint)&&https(row.destinationEndpoint)&&row.sourceEndpoint!==row.destinationEndpoint&&/^[a-f0-9]{64}$/.test(row.digest),'Незавершённый перенос Delta или повреждённая привязка');byId.set(row.id,row);continue;
  }
  const area=areas.find(a=>row.id==='sync-checkpoint-'+a||row.id==='sync-checkpoint-status-'+a);
  check(area,'Неизвестная контрольная точка устройства');
  check(identity(row),'Некорректная идентичность контрольной точки');
  const protocol=Object.hasOwn(row,'protocol')?['protocol']:[];
  if(protocol.length){const u=new URL(row.endpoint);check(row.protocol==='delta-v3'&&u.protocol==='https:'&&u.origin===row.endpoint&&!u.port&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname),'Неизвестный протокол контрольной точки');}
  if(row.id==='sync-checkpoint-'+area)check(exact(row,['id','endpoint','workspaceId','revision','envelope',...protocol])&&envelope(row.envelope),'Повреждённый конверт контрольной точки');
  else check(exact(row,['id','endpoint','workspaceId','revision','successfulAt',...protocol])&&typeof row.successfulAt==='string'&&Number.isFinite(Date.parse(row.successfulAt)),'Повреждённое состояние синхронизации');
  byId.set(row.id,row);
 }
 for(const area of areas){
  const status=byId.get('sync-checkpoint-status-'+area),cp=byId.get('sync-checkpoint-'+area);
  const binding=byId.get('sync-checkpoint-migration-'+area);if(binding)check(cp?.protocol==='delta-v3'&&cp.endpoint===binding.destinationEndpoint&&cp.workspaceId===binding.destinationWorkspaceId&&cp.revision===1&&!status,'Неверная контрольная точка переноса v3');
  if(status)check(cp&&['endpoint','workspaceId','revision','protocol'].every(k=>cp[k]===status[k]),'Состояние синхронизации не совпадает с контрольной точкой');
 }
 return structuredClone(rows);
}
export function splitDeviceSnapshot(data){
 check(data&&Array.isArray(data.meta),'Неполный снимок устройства');
 const device=validateDeviceCheckpoints(data.meta.filter(isSyncCheckpoint));
 return {portable:{...data,meta:data.meta.filter(r=>!isSyncCheckpoint(r))},device};
}
export function joinDeviceSnapshot(portable,device){
 check(portable&&Array.isArray(portable.meta)&&!portable.meta.some(isSyncCheckpoint),'Контрольные точки в переносимой части запрещены');
 return {...portable,meta:[...portable.meta,...validateDeviceCheckpoints(device)]};
}
