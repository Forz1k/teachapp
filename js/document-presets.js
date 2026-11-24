import {documentTypes} from './documents.js';
const KEY='teachapp.document.presets.v1';
const clean=(v,max=300)=>typeof v==='string'?v.trim().slice(0,max):'';
export function normalizePreset(value){
 const v=value&&typeof value==='object'?value:{};
 return {title:clean(v.title),organization:clean(v.organization),venue:clean(v.venue),signatures:v.signatures!==false,signatureLabel:clean(v.signatureLabel,100)||'Ответственный'};
}
export function readPresets(storage){
 try{const raw=JSON.parse((storage??globalThis.localStorage).getItem(KEY)||'{}');return Object.fromEntries(Object.keys(documentTypes).filter(k=>Object.hasOwn(raw??{},k)).map(k=>[k,normalizePreset(raw[k])]));}catch{return {};}
}
export function savePreset(type,value,storage){
 if(!Object.hasOwn(documentTypes,type))throw Error('Неизвестный шаблон');
 const s=storage??globalThis.localStorage,all=readPresets(s);all[type]=normalizePreset(value);s.setItem(KEY,JSON.stringify(all));return all[type];
}
export function removePreset(type,storage){
 const s=storage??globalThis.localStorage,all=readPresets(s);delete all[type];s.setItem(KEY,JSON.stringify(all));
}
