// Portable templates are deliberately detached from class/team identifiers.
import * as db from './db.js';
import {uid} from './model.js';
import {catalog} from './health.js';
import {validateBoard,saveBoard} from './tactics.js';
import {documentTypes} from './documents.js';
import {normalizePreset,savePreset} from './document-presets.js';
export const materialKinds=['ktpMaterial','tacticMaterial','documentMaterial'];
const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
const check=(v,msg)=>{if(!v)throw Error(msg);};
const text=(v,n=200)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
export function validateMaterial(r){
 check(text(r?.id)&&text(r.name)&&materialKinds.includes(r.kind)&&r.version===1,'Некорректный материал');
 if(r.kind==='ktpMaterial'){
  check(only(r,['id','kind','name','version','topics'])&&Array.isArray(r.topics)&&r.topics.length<=2000,'Проверьте структуру КТП');
  check(r.topics.every(t=>only(t,['name','activityIds'])&&text(t.name,500)&&Array.isArray(t.activityIds)&&t.activityIds.length<=catalog.length&&new Set(t.activityIds).size===t.activityIds.length&&t.activityIds.every(id=>catalog.some(a=>a.id===id))),'Проверьте темы и виды нагрузки');
 }else if(r.kind==='tacticMaterial'){
  check(only(r,['id','kind','name','version','note','markers','arrows']),'Проверьте структуру схемы');
  validateBoard({id:r.id,kind:'tacticBoard',teamId:'template',name:r.name,note:r.note,markers:r.markers,arrows:r.arrows,revision:0});
 }else{
  check(only(r,['id','kind','name','version','type','preset'])&&Object.hasOwn(documentTypes,r.type)&&only(r.preset,['title','organization','venue','signatures','signatureLabel']),'Проверьте шаблон документа');
  const p=normalizePreset(r.preset);check(Object.keys(p).every(k=>p[k]===r.preset[k]),'Некорректные реквизиты шаблона');
 }
 return r;
}
export function ktpMaterial(k,topics,name=k.name){
 const r={id:uid('ktpMaterial'),kind:'ktpMaterial',name,version:1,topics:topics.filter(t=>t.ktpId===k.id).slice().sort((a,b)=>(a.ktpOrder||0)-(b.ktpOrder||0)).map(t=>({name:t.name,activityIds:[...new Set((t.activityIds||[]).filter(id=>catalog.some(a=>a.id===id)))]}))};
 return validateMaterial(r);
}
export function tacticMaterial(board){
 // Copy geometry only. Replace potentially identifying marker labels with ordinal numbers.
 const r={id:uid('tacticMaterial'),kind:'tacticMaterial',name:board.name,version:1,note:'',markers:board.markers.map((m,i)=>({id:'p'+(i+1),label:String(i+1),side:m.side,x:m.x,y:m.y})),arrows:board.arrows.map((a,i)=>({id:'a'+(i+1),style:a.style,from:{...a.from},to:{...a.to}}))};
 return validateMaterial(r);
}
export function documentMaterial(type,preset){
 return validateMaterial({id:uid('documentMaterial'),kind:'documentMaterial',name:documentTypes[type],version:1,type,preset:normalizePreset(preset)});
}
export async function saveMaterial(r){return writeMaterial(db,r);}
export async function writeMaterial(access,r){validateMaterial(r);await access.transaction(['workRecords'],'readwrite',s=>s.workRecords.add(r));return r;}
export async function instantiateMaterial(r,{name=r.name,teamId,confirmed=false,storage}={}){
 check(confirmed,'Сначала подтвердите применение материала');validateMaterial(r);check(text(name),'Введите название');
 if(r.kind==='ktpMaterial'){
  const k={id:uid('ktp'),name,classIds:[],createdAt:new Date().toISOString()};
  const topics=r.topics.map((t,i)=>({id:uid('top'),name:t.name,ktpId:k.id,ktpOrder:i+1,activityIds:[...t.activityIds],activitiesConfirmed:false}));
  await db.transaction(['ktp','topics'],'readwrite',async s=>{await s.ktp.add(k);for(const t of topics)await s.topics.add(t);});return k;
 }
 if(r.kind==='tacticMaterial')return saveBoard({teamId,name,note:r.note,markers:structuredClone(r.markers),arrows:structuredClone(r.arrows)});
 return savePreset(r.type,r.preset,storage);
}
