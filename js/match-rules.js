/* User-configured competition rules; no official federation claim. Existing
 * matches without a snapshot retain their historical scoring and behavior. */
import * as db from './db.js';
import {uid} from './model.js';
export const legacyRegulation=Object.freeze({name:'Прежний регламент',winBy:2,pointCap:null,liberoInterval:'manual',ends:'manual',deciderSwitchAt:8});
export const defaultRegulation=Object.freeze({...legacyRegulation,name:'Пользовательский регламент'});
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const text=(v,max=100)=>typeof v==='string'&&v===v.trim()&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys.slice().sort().join(',');
const check=(v,msg)=>{if(!v)throw Error(msg);};
export function validRegulation(r,format){
 return !!(exact(r,['name','winBy','pointCap','liberoInterval','ends','deciderSwitchAt'])&&text(r.name)&&[1,2].includes(r.winBy)&&(r.pointCap===null||integer(r.pointCap,Math.max(format.target,format.bestOf===1?format.target:format.decider),999))&&['manual','oneRally'].includes(r.liberoInterval)&&['manual','betweenSets','betweenSetsDecider'].includes(r.ends)&&integer(r.deciderSwitchAt,1,98)&&(r.ends!=='betweenSetsDecider'||format.bestOf>1&&r.deciderSwitchAt<format.decider));
}
export function validMatchFormat(d){
 if(d.regulation===undefined)return [3,5].includes(d.bestOf)&&[15,21,25].includes(d.target)&&[15,21,25].includes(d.decider);
 return [1,3,5].includes(d.bestOf)&&integer(d.target,1,99)&&integer(d.decider,1,99)&&validRegulation(d.regulation,d);
}
export const regulationOf=d=>d.regulation??legacyRegulation;
export function targetForSet(d,index){return d.bestOf>1&&index===d.bestOf-1?d.decider:d.target;}
export function isSetWon(d,index,score){
 const r=regulationOf(d),high=Math.max(score.ours,score.theirs),low=Math.min(score.ours,score.theirs);
 return high>=targetForSet(d,index)&&high>low&&(high-low>=r.winBy||r.pointCap!==null&&high>=r.pointCap);
}
export function validateMatchRegulation(r){
 check(exact(r,['id','kind','bestOf','target','decider','substitutionMode','limits','regulation'])&&r.kind==='matchRegulation'&&text(r.id,200)&&r.regulation!==undefined&&validMatchFormat(r)&&['simple','paired'].includes(r.substitutionMode)&&exact(r.limits,['substitutions','timeouts'])&&integer(r.limits.substitutions,0,20)&&integer(r.limits.timeouts,0,5),'Проверьте пользовательский регламент');return r;
}
export async function saveMatchRegulation(input){
 const r=validateMatchRegulation({id:uid('rules'),kind:'matchRegulation',bestOf:input.bestOf,target:input.target,decider:input.decider,substitutionMode:input.substitutionMode,limits:structuredClone(input.limits),regulation:structuredClone(input.regulation)});
 return db.transaction(['workRecords'],'readwrite',async s=>{const rows=await s.workRecords.index('kind').getAll('matchRegulation');check(rows.length<100,'Не более 100 регламентов');check(!rows.some(x=>x.regulation.name.toLocaleLowerCase('ru')===r.regulation.name.toLocaleLowerCase('ru')),'Регламент с таким названием уже существует');await s.workRecords.add(r);return r;});
}
