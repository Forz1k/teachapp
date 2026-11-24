import * as db from './db.js';
import {uid} from './model.js';
import {validateWorkRecord,listWork} from './workbench.js';
const check=(v,m)=>{if(!v)throw Error(m)};
const kinds=['exercise','plan','gymBoard'];
export const LIBRARY_VERSION=1,MAX_LIBRARY_BYTES=2*1024*1024;
export function portableRecord(record){
 check(record&&kinds.includes(record.kind),'Неподдерживаемый материал');const r=structuredClone(record);validateWorkRecord(r);
 if(r.kind==='plan'){delete r.resources;delete r.tactics;r.audience='';}
 return r;
}
export function libraryBundle(records){
 check(Array.isArray(records)&&records.length<=500,'Не более 500 материалов за один файл');
 const bundle={format:'teachapp-library',version:LIBRARY_VERSION,records:records.map(portableRecord)};
 check(new TextEncoder().encode(JSON.stringify(bundle)).length<=MAX_LIBRARY_BYTES,'Файл материалов больше 2 МБ');return bundle;
}
export function parseLibrary(input){
 check(typeof input==='string'&&new TextEncoder().encode(input).length<=MAX_LIBRARY_BYTES,'Файл материалов больше 2 МБ');let b;try{b=JSON.parse(input);}catch{throw Error('Некорректный JSON');}
 check(b&&typeof b==='object'&&Object.keys(b).every(k=>['format','version','records'].includes(k))&&b.format==='teachapp-library'&&b.version===LIBRARY_VERSION&&Array.isArray(b.records),'Неподдерживаемый формат библиотеки');
 const clean=libraryBundle(b.records);check(new Set(clean.records.map(r=>r.id)).size===clean.records.length,'Повтор идентификатора в файле');return clean;
}
export async function exportLocalLibrary(){return libraryBundle((await Promise.all(kinds.map(listWork))).flat());}
export async function importLocalLibrary(input,confirmed=false){
 check(confirmed,'Сначала подтвердите предпросмотр');const bundle=parseLibrary(input);
 // Independent snapshots; fresh IDs prevent overwriting even when importing repeatedly.
 const records=bundle.records.map(r=>({...r,id:uid(r.kind==='gymBoard'?'gym':r.kind)}));
 for(const r of records)validateWorkRecord(r);
 await db.transaction(['workRecords'],'readwrite',async s=>{for(const r of records)await s.workRecords.add(r);});
 return {count:records.length,records};
}
