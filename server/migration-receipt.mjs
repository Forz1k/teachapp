/* Server-only, domain-separated ECDSA receipt for an irreversible synthetic rollback seal.
 * No private key is accepted from a client or included in a receipt. */
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const coord=/^[A-Za-z0-9_-]{43}$/,uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const algorithm={name:'ECDSA',namedCurve:'P-256'},signAlgorithm={name:'ECDSA',hash:'SHA-256'},encoder=new TextEncoder();
export const validAnchorCommitment=v=>typeof v==='string'&&/^(single|multipart):[a-f0-9]{64}$/.test(v);
export function normalizeReceiptKey(jwk,privateKey=false){
 if(!jwk||typeof jwk!=='object'||jwk.kty!=='EC'||jwk.crv!=='P-256'||typeof jwk.x!=='string'||!coord.test(jwk.x)||typeof jwk.y!=='string'||!coord.test(jwk.y)||privateKey&&(typeof jwk.d!=='string'||!coord.test(jwk.d))||!privateKey&&Object.hasOwn(jwk,'d'))return null;
 return {kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y,...(privateKey?{d:jwk.d}:{})};
}
export function normalizeReceiptKeys(input,privateKey=false){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['school','coach'].includes(k)))return null;
 const result={},seen=new Set();
 for(const [area,key] of Object.entries(input)){const normalized=normalizeReceiptKey(key,privateKey);if(!normalized)return null;const identity=normalized.x+':'+normalized.y;if(seen.has(identity))return null;seen.add(identity);result[area]=normalized;}
 return result;
}
export async function importReceiptKey(jwk,privateKey=false){
 const key=normalizeReceiptKey(jwk,privateKey);if(!key)throw Error('Invalid receipt key');
 return crypto.subtle.importKey('jwk',key,algorithm,false,[privateKey?'sign':'verify']);
}
function payload({area,migrationId,anchorCommitment}){
 if(!['school','coach'].includes(area)||typeof migrationId!=='string'||!uuid.test(migrationId)||!validAnchorCommitment(anchorCommitment))throw Error('Invalid receipt fields');
 return {app:'teachapp-delta-rollback-receipt',version:1,area,migrationId,revision:1,anchorCommitment};
}
function encode(bytes){return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');}
function decode(value){return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'=='),c=>c.charCodeAt(0));}
export async function signRollbackReceipt(fields,jwk){
 const body=payload(fields),key=await importReceiptKey(jwk,true),signature=await crypto.subtle.sign(signAlgorithm,key,encoder.encode(JSON.stringify(body)));
 return {...body,signature:encode(signature)};
}
export async function verifyRollbackReceipt(receipt,expected,jwk){
 try{
  const body=payload(expected);
  if(!exact(receipt,[...Object.keys(body),'signature'])||Object.keys(body).some(k=>receipt[k]!==body[k])||typeof receipt.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(receipt.signature))return false;
  const signature=decode(receipt.signature);if(signature.length!==64||encode(signature)!==receipt.signature)return false;
  const key=await importReceiptKey(jwk);
  return await crypto.subtle.verify(signAlgorithm,key,signature,encoder.encode(JSON.stringify(body)));
 }catch{return false;}
}
