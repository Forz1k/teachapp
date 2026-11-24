import * as S from '../store.js';
import * as C from '../coach.js';
import * as W from '../workbench.js';
import {todayIso,fmtFull} from '../model.js';
import {conditions,movementTypes,inventoryBalance,saveInventory,inventoryMovement,equipmentStatus,achievementTypes,levels,achievementSubjects,saveAchievement} from '../resources.js';
import {metric} from '../dashboard.js';
import {el,openSheet,closeSheet,toast,confirmDialog,downloadBlob} from '../ui.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{class:'btn wide '+kind,type:'button',text,onclick});
const input=(value='',type='text',props={})=>el('input',{type,value,...props});
const field=(name,n)=>el('label',{class:'field'},[el('span',{text:name}),n]);
const select=(rows,value)=>{const n=el('select',{},rows.map(([value,text])=>el('option',{value,text})));n.value=value??rows[0]?.[0]??'';return n;};
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const stack=children=>el('div',{class:'coach-form'},children);
const number=n=>n.value.trim()===''?null:Number(n.value);
const area=(v='')=>el('textarea',{rows:3,maxlength:1000},[v]);
function inventoryForm(old,back){
 const r=old||{},name=input(r.name||''),category=input(r.category||'Спортивный инвентарь'),unit=input(r.unit||'шт.'),location=input(r.location||''),minimum=input(r.minimum??0,'number',{min:0,step:1}),initial=Object.fromEntries(Object.entries(conditions).map(([id])=>[id,input(r.initial?.[id]??0,'number',{min:0,step:1})]));
 const save=btn('Сохранить',async()=>{save.disabled=true;try{await saveInventory({id:r.id,revision:r.revision,name:name.value.trim(),category:category.value.trim(),unit:unit.value.trim(),location:location.value.trim(),minimum:number(minimum),initial:Object.fromEntries(Object.entries(initial).map(([k,n])=>[k,number(n)])),archived:r.archived||false});await back();}catch(e){toast(e.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:old?'Карточка инвентаря':'Новый инвентарь'}),field('Название',name),field('Категория',category),field('Единица (шт. / комплект)',unit),field('Место хранения',location),field('Минимум исправного инвентаря',minimum),old?p('Остаток меняется только операциями.'):el('div',{class:'coach-stack'},Object.entries(conditions).map(([id,text])=>field('Начальный остаток · '+text,initial[id]))),save,btn('Назад',back)]));
}
function moveForm(r,back){
 const type=select(Object.entries(movementTypes)),from=select(Object.entries(conditions),'good'),to=select(Object.entries(conditions),'good'),date=input(todayIso(),'date',{max:todayIso()}),quantity=input(1,'number',{min:1,step:1}),note=area(),source=field('Из состояния',from),target=field('В состояние',to),stock=inventoryBalance(r);
 function draw(){source.hidden=type.value==='add';target.hidden=type.value==='writeOff';}type.onchange=draw;draw();
 const save=btn('Подтвердить операцию',async()=>{save.disabled=true;try{
  const movement={date:date.value,type:type.value,from:type.value==='add'?null:from.value,to:type.value==='writeOff'?null:to.value,qty:number(quantity),note:note.value.trim()};
  if(!await confirmDialog({title:'Записать операцию?',text:movementTypes[movement.type]+' · '+movement.qty+' '+r.unit+'. История будет сохранена.',ok:'Записать',danger:movement.type==='writeOff'}))return;
  await inventoryMovement(r.id,r.revision,movement,true);await back();
 }catch(e){toast(e.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:r.name+' · операция'}),p(Object.entries(conditions).map(([k,label])=>label+': '+stock[k]).join(' · ')),field('Операция',type),field('Дата',date),source,target,field('Количество',quantity),field('Основание / примечание',note),save,btn('Назад',back)]));
}
const csv=v=>{let s=String(v??'');if(/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
function exportInventory(rows){
 const matrix=[['Название','Категория','Единица','Место хранения','Исправный','Ремонт','Непригодный','Всего','Минимум'],...rows.map(r=>{const s=inventoryBalance(r);return [r.name,r.category,r.unit,r.location,s.good,s.repair,s.unusable,s.total,r.minimum];})];
 downloadBlob(new Blob(['\uFEFF'+matrix.map(r=>r.map(csv).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'teachapp-inventory.csv');
}
export async function openInventory(){
 let query='',showArchived=false;
 async function draw(){try{
  const rows=await W.listWork('inventory'),search=input(query,'search',{placeholder:'Найти инвентарь'}),arch=el('input',{type:'checkbox'}),body=el('div',{class:'coach-stack'});arch.checked=showArchived;
  const active=rows.filter(r=>!r.archived),low=active.filter(r=>inventoryBalance(r).good<r.minimum).length;
  function filter(){query=search.value;showArchived=arch.checked;const q=query.trim().toLocaleLowerCase('ru');body.replaceChildren(...rows.filter(r=>(showArchived||!r.archived)&&[r.name,r.category,r.location].some(v=>v.toLocaleLowerCase('ru').includes(q))).map(r=>{const s=inventoryBalance(r);
   return card(r.name+(r.archived?' · архив':''),[p(r.category+' · '+r.location),p('Исправный: '+s.good+' · ремонт: '+s.repair+' · непригодный: '+s.unusable+' · всего: '+s.total+' '+r.unit),s.good<r.minimum?p('Меньше установленного минимума: '+r.minimum):null,r.archived?null:btn('Поступление / состояние / списание',()=>moveForm(r,draw),'primary'),btn('Редактировать карточку',()=>inventoryForm(r,draw)),el('details',{},[el('summary',{text:'История операций · '+r.movements.length}),...r.movements.slice(-100).reverse().map(m=>p(fmtFull(m.date)+' · '+movementTypes[m.type]+' · '+m.qty+' '+r.unit+' · '+m.note))]),btn(r.archived?'Восстановить':'Архивировать',async()=>{try{if(await confirmDialog({title:'Изменить статус?',text:'История операций сохранится.',ok:'Подтвердить'})){await saveInventory({...r,archived:!r.archived});await draw();}}catch(e){toast(e.message);}})]);}));if(!body.children.length)body.append(p('Инвентарь не найден.'));}
  search.oninput=arch.onchange=filter;filter();openSheet(stack([el('h2',{text:'Спортивный инвентарь'}),el('div',{class:'dashboard-metrics'},[metric('Карточек',active.length,'classes'),metric('Ниже минимума',low,'shield')]),p('Это оперативный учёт, не официальный бухгалтерский акт списания. Количество не может стать отрицательным.'),btn('+ Инвентарь',()=>inventoryForm(null,draw),'primary'),field('Поиск',search),field('Показать архив',arch),body,btn('Экспорт остатков CSV',()=>exportInventory(active)),btn('Закрыть',closeSheet)]));
 }catch(e){toast(e.message);}}
 await draw();
}
export function equipmentCard(requirements,inventory){
 const rows=equipmentStatus(requirements,inventory);
 return card('Инвентарь к занятию',rows.length?rows.map(r=>el('div',{class:'profile-result'},[el('strong',{text:r.name+' · нужно '+r.qty+' '+r.unit}),p(r.available===null?'Остаток недоступен: проверьте карточку':('Исправно '+r.available+(r.shortage?' · не хватает '+r.shortage:' · достаточно')))])):[p('Количественные требования не заданы.')]);
}
async function achievementForm(old,options,subjects,back){
 const r=old||{},allowed=options.area==='coach'?['team','player']:options.area==='school'?['class','student']:Object.keys(achievementTypes),type=select(allowed.map(k=>[k,achievementTypes[k]]),r.subjectType||options.subjectType),subject=select([]),title=input(r.title||''),date=input(r.date||todayIso(),'date',{max:todayIso()}),level=select(Object.entries(levels),r.level||'school'),result=input(r.result||''),note=area(r.note||'');
 function fill(){const list=subjects.filter(s=>s.type===type.value),id=subject.value||r.subjectId||options.subjectId;subject.replaceChildren(...list.map(s=>el('option',{value:s.id,text:s.label})));if(list.some(x=>x.id===id))subject.value=id;else if(r.subjectType===type.value&&r.subjectId){subject.append(el('option',{value:r.subjectId,text:'Участник недоступен'}));subject.value=r.subjectId;}}
 type.onchange=fill;fill();if(options.subjectId){type.disabled=true;subject.disabled=true;}
 const save=btn('Сохранить достижение',async()=>{save.disabled=true;try{await saveAchievement({id:r.id,kind:'achievement',revision:r.revision??0,subjectType:type.value,subjectId:subject.value,title:title.value.trim(),date:date.value,level:level.value,result:result.value.trim(),note:note.value.trim()});await back();}catch(e){toast(e.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:'Спортивное достижение'}),field('Тип участника',type),field('Участник',subject),field('Мероприятие / соревнование',title),field('Дата',date),field('Уровень',level),field('Результат / место',result),field('Примечание (без ФИО и медицинских данных)',note),save,btn('Назад',back)]));
}
export async function openAchievements(options={},back=closeSheet){
 const area=options.area,allowed=area==='school'?['class','student']:area==='coach'?['team','player']:Object.keys(achievementTypes);
 let filterType=options.subjectType||'all';
 async function draw(){try{
  const [data,archives,rows]=await Promise.all([C.loadCoach(),W.listWork('archive'),W.listWork('achievement')]),subjects=achievementSubjects(S.state,data,archives),byId=new Map(subjects.map(s=>[s.type+'|'+s.id,s.label]));
  const body=el('div',{class:'coach-stack'}),type=select([['all','Все участники'],...allowed.map(k=>[k,achievementTypes[k]])],filterType),search=input('','search',{placeholder:'Поиск соревнования'});
  function filter(){filterType=type.value;const q=search.value.trim().toLocaleLowerCase('ru');const selected=rows.filter(r=>allowed.includes(r.subjectType)&&(filterType==='all'||filterType===r.subjectType)&&(!options.subjectId||r.subjectId===options.subjectId&&r.subjectType===options.subjectType)&&[r.title,r.result,byId.get(r.subjectType+'|'+r.subjectId)||''].some(s=>s.toLocaleLowerCase('ru').includes(q))).sort((a,b)=>b.date.localeCompare(a.date));
   body.replaceChildren(...selected.map(r=>card(r.title,[p(fmtFull(r.date)+' · '+levels[r.level]),el('strong',{text:r.result}),p(byId.get(r.subjectType+'|'+r.subjectId)||'Участник недоступен'),p(r.note),btn('Редактировать',()=>achievementForm(r,options,subjects,draw)),btn('Удалить',async()=>{if(!await confirmDialog({title:'Удалить достижение?',text:'Оценки и матчи не изменятся.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(r.id,'achievement');await draw();}catch(e){toast(e.message);}})])));if(!selected.length)body.append(p('Достижений пока нет.'));}
  type.onchange=search.oninput=filter;filter();openSheet(stack([el('h2',{text:'Спортивные достижения'}),p('Достижения хранятся отдельно от оценок, матчей и медицинских сведений. Связь по идентификатору, не по совпадению имени.'),btn('+ Достижение',()=>achievementForm(null,options,subjects,draw),'primary'),options.subjectId?null:field('Участники',type),field('Поиск',search),body,btn('Назад',back)]));
 }catch(e){toast(e.message);}}
 await draw();
}
