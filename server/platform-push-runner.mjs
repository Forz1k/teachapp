/* Background delivery candidate: bounded coordinator, exact ticket and consent
 * fence. Only a trusted adapter may resolve credentials and commit outcomes.
 * No default timer, network, or worker route. */
import {deliverGenericPushLab} from '../tools/prototypes/push-transport-lab.mjs';
const outcomes=new Set(['accepted','subscription-gone','authorization-error','payload-error','retry-later','unknown','rejected','cancelled']);
const unknown={outcome:'unknown',retryAfter:null};
export async function runPushDeliveryLab({adapter,memberId,revision,sequence,readClock=Date.now,transport,keyPair}){
 if(!adapter||!['claim','current','subscription','finish'].every(k=>typeof adapter[k]==='function')||typeof transport!=='function'||typeof memberId!=='string'||!Number.isSafeInteger(revision)||revision<0||!Number.isSafeInteger(sequence)||sequence<1)throw Error('Invalid delivery adapter');
 let claim;
 try{claim=await adapter.claim({memberId,revision,sequence});}catch{return {status:'claim-unknown'};}
 if(claim?.status!=='claimed')return {status:claim?.status??'claim-unknown'};
 const ticket=structuredClone(claim.ticket);
 const time=()=>{const n=readClock();if(!Number.isSafeInteger(n)||n<0)throw Error('clock');return n;};
 const current=async()=>{try{return time()<ticket.leaseUntil&&time()<ticket.expiresAt&&await adapter.current({memberId,ticket:structuredClone(ticket)})===true;}catch{return false;}};
 let result=unknown;
 try{
  if(ticket.revision!==revision||ticket.sequence!==sequence||!await current())result={outcome:'cancelled',retryAfter:null};
  else{
   const sub=await adapter.subscription({memberId,ticket:structuredClone(ticket)});
   if(!sub||!await current())result={outcome:'cancelled',retryAfter:null};
   else result=await deliverGenericPushLab({...sub,keyPair,now:Math.floor(time()/1000),expiresAt:Math.floor(Math.min(ticket.expiresAt,ticket.leaseUntil)/1000),readClock:()=>Math.floor(time()/1000),stillCurrent:current,transport});
  }
 }catch{result=unknown;}
 if(!outcomes.has(result?.outcome))result=unknown;
 try{
  const final=await adapter.finish({memberId,ticket:structuredClone(ticket),outcome:result.outcome,retryAfter:result.retryAfter??null});
  return {status:final?.status??'finish-unknown',outcome:result.outcome};
 }catch{
  // A possibly accepted send is never retried automatically by this runner.
  return {status:'finish-unknown',outcome:result.outcome};
 }
}
