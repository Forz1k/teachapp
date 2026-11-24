/* Импорт шкал: предварительный просмотр без записи; одна строка — одна шкала. */
import {validateNorm,units} from './assessment.js';
import {uid} from './model.js';
export const headers=['Норматив','Вид нагрузки','Единица','Направление','Параллель / класс','Категория','1','2','3','4','5'];
const clean=v=>String(v??'').trim();
const key=v=>clean(v).normalize('NFC').toLowerCase();
const scopeKey=r=>JSON.stringify([r.classId??null,r.gradeLevel??null,r.group]);
const scopes=n=>n.scales??[{classId:null,gradeLevel:null,group:'all',scale:n.scale}];
function number(v){
  if(typeof v==='number'&&Number.isFinite(v))return v;
  const s=clean(v);if(!/^\d+(?:[.,]\d+)?$/.test(s))throw Error('Порог должен быть числом');
  return Number(s.replace(',','.'));
}
export function parseNormRows(matrix,activities,classes){
  if(!Array.isArray(matrix)||matrix.length>5001)throw Error('Максимум 5000 строк');
  if(headers.some((h,i)=>key(matrix[0]?.[i])!==key(h)))throw Error('Используйте заголовки шаблона');
  const result=[],errors=[];
  for(let i=1;i<matrix.length;i++){
    const row=matrix[i];if(!row.some(v=>clean(v)))continue;
    try{
      const [name,activity,unit,direction,scope,group]=row.map(clean);
      const acts=activities.filter(a=>key(a.id)===key(activity)||key(a.name)===key(activity));
      if(acts.length!==1)throw Error('Неизвестный или неоднозначный вид нагрузки');
      const dir={'min':'min','max':'max','меньше':'min','больше':'max'}[key(direction)];
      const g={'boys':'boys','girls':'girls','all':'all','мальчики':'boys','девочки':'girls','общая':'all'}[key(group)];
      let gradeLevel=null,classId=null;
      if(/^(?:[1-9]|10|11)$/.test(scope))gradeLevel=Number(scope);
      else if(key(scope)!=='все'){
        const matches=classes.filter(c=>key(c.name)===key(scope));
        if(matches.length!==1)throw Error('Укажите параллель 1–11, существующий класс или «Все»');
        classId=matches[0].id;
      }
      const norm={name,activityId:acts[0].id,unit,direction:dir,scales:[{gradeLevel,classId,group:g,scale:Array.from({length:5},(_,j)=>number(row[j+6]))}]};
      validateNorm(norm,new Set(activities.map(a=>a.id)));
      result.push({line:i+1,norm});
    }catch(e){errors.push('Строка '+(i+1)+': '+e.message);}
  }
  if(!result.length&&!errors.length)errors.push('Нет заполненных строк');
  return {rows:result,errors};
}
export function planNormImport(rows,existing,activities,{replace=false}={}){
  const map=new Map(),seen=new Set(),errors=[],changes=new Map();
  const counts={created:0,added:0,replaced:0,unchanged:0};
  for(const n of existing){const k=key(n.name);if(!map.has(k))map.set(k,[]);map.get(k).push(n);}
  for(const {line,norm} of rows){
    try{
      validateNorm(norm,new Set(activities.map(a=>a.id)));
      const k=key(norm.name),r=norm.scales[0],sk=scopeKey(r),rk=JSON.stringify([k,sk]);
      if(seen.has(rk))throw Error('Повтор шкалы в файле');
      seen.add(rk);
      const found=map.get(k)||[];
      if(found.length>1)throw Error('Несколько нормативов с таким названием в базе');
      let n=changes.get(k)||found[0];
      if(!n){n={...norm,id:uid('norm'),scales:[]};counts.created++;}
      if(n.activityId!==norm.activityId||n.unit!==norm.unit||n.direction!==norm.direction)throw Error('Название совпадает, но вид нагрузки, единица или направление отличаются');
      const old=scopes(n),previous=old.find(x=>scopeKey(x)===sk);
      if(previous&&JSON.stringify(previous.scale)===JSON.stringify(r.scale)){counts.unchanged++;continue;}
      if(previous&&!replace)throw Error('Шкала уже существует с другими порогами; разрешите замену');
      const next={id:n.id,name:n.name,activityId:n.activityId,unit:n.unit,direction:n.direction,scales:old.filter(x=>scopeKey(x)!==sk).concat(r)};
      validateNorm(next,new Set(activities.map(a=>a.id)));
      changes.set(k,next);counts[previous?'replaced':'added']++;
    }catch(e){errors.push('Строка '+line+': '+e.message);}
  }
  return {records:[...changes.values()],counts,errors};
}
