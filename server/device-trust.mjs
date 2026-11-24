/* Server-side per-contour trust registry. Never stores plaintext access tokens. */
export const validDeviceId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{16,64}$/.test(value);
export const validDeviceHash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
export function validDeviceName(value){
 return typeof value==='string'&&value===value.trim()&&value.length>=1&&value.length<=80&&!/[\u0000-\u001f\u007f]/.test(value);
}
export function validRegistration(body){
 return body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).sort().join(',')==='id,name,tokenHash'&&validDeviceId(body.id)&&validDeviceName(body.name)&&validDeviceHash(body.tokenHash);
}
export function validRevocation(body){
 return body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).join(',')==='id'&&validDeviceId(body.id);
}
const publicDevice=row=>({id:row.id,name:row.name,createdAt:row.created_at,lastSeen:row.last_seen??null,revokedAt:row.revoked_at??null});
export class DeviceRegistry{
 constructor(sql){
  this.sql=sql;
  sql.exec('CREATE TABLE IF NOT EXISTS trusted_device (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_seen INTEGER, revoked_at INTEGER)');
 }
 list(){
  return this.sql.exec('SELECT id,name,created_at,last_seen,revoked_at FROM trusted_device ORDER BY created_at,id').toArray().map(publicDevice);
 }
 register(body,now=Date.now()){
  if(!validRegistration(body))return {status:400,error:'packet'};
  const {id,name,tokenHash}=body;
  if(this.sql.exec('SELECT id FROM trusted_device WHERE id=? OR token_hash=?',id,tokenHash).toArray().length)return {status:409,error:'device-exists'};
  if(this.sql.exec('SELECT COUNT(*) AS count FROM trusted_device').toArray()[0].count>=128)return {status:409,error:'device-limit'};
  this.sql.exec('INSERT INTO trusted_device (id,name,token_hash,created_at) VALUES (?,?,?,?)',id,name,tokenHash,now);
  return {status:201,device:{id,name,createdAt:now,lastSeen:null,revokedAt:null}};
 }
 revoke(id,now=Date.now()){
  if(!validDeviceId(id))return {status:400,error:'packet'};
  const row=this.sql.exec('SELECT id,name,created_at,last_seen,revoked_at FROM trusted_device WHERE id=?',id).toArray()[0];
  if(!row)return {status:404,error:'device'};
  if(row.revoked_at==null){this.sql.exec('UPDATE trusted_device SET revoked_at=? WHERE id=?',now,id);row.revoked_at=now;}
  return {status:200,device:publicDevice(row)};
 }
 active(hash){
  if(!validDeviceHash(hash))return null;
  return this.sql.exec('SELECT id FROM trusted_device WHERE token_hash=? AND revoked_at IS NULL',hash).toArray()[0]?.id??null;
 }
 touch(id,now=Date.now(),force=false){
  // Coalesce read-only heartbeats to reduce durable storage writes on the free tier.
  this.sql.exec('UPDATE trusted_device SET last_seen=? WHERE id=? AND revoked_at IS NULL AND (last_seen IS NULL OR last_seen<=? OR ?=1)',now,id,now-300000,force?1:0);
 }
}
