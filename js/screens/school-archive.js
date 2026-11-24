import * as A from '../school-archive.js';
import * as W from '../workbench.js';
import * as M from '../model.js';
import {gradeLevelOf,periodKinds} from '../assessment.js';
import {el,openSheet,closeSheet,toast,confirmDialog} from '../ui.js';
import {metric} from '../dashboard.js';
const p=text=>el('p',{text});
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]);
const inp=(value='',type='text',props={})=>el('input',{type,value,...props});
const select=(options,value)=>{const n=el('select',{},options.map(([v,text])=>el('option',{value:v,text})));n.value=value??options[0]?.[0]??'';return n;};
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const stack=children=>el('div',{class:'coach-form'},children);
function viewArchive(record,back){
 const d=record.snapshot,choose=select(d.classes.map(c=>[c.id,c.name])),body=el('div',{class:'coach-stack'});
 function draw(){
  body.replaceChildren();if(!choose.value)return;
  const data=A.archiveClass(record,choose.value);
  body.append(el('div',{class:'dashboard-metrics'},[metric('Уроков',data.lessons.length,'calendar'),metric('Учеников',data.students.length,'classes')]));
  for(const {student,marks,norms,finals,participation} of data.students){
   const details=el('details',{class:'archive-student'},[el('summary',{text:student.fullName+' · отметок '+marks.length}),p('Итоговые оценки: '+(finals.map(x=>x.periodName+' — '+x.value).join('; ')||'нет')),p('Отсутствия: '+marks.filter(x=>x.flag==='Н').length+' · записей участия: '+participation.length)]);
   for(const x of marks.sort((a,b)=>a.date.localeCompare(b.date)))details.append(p(M.fmtFull(x.date)+' · '+[x.value,x.flag,x.osv?'ОСВ':''].filter(Boolean).join(' ')));
   for(const n of norms)details.append(p(M.fmtFull(n.date)+' · '+n.definition.name+' · '+(n.value??'не выполнено')+' '+n.definition.unit+' · оценка '+(n.grade??'—')));
   body.append(details);
  }
  const topics=new Map(d.topics.map(t=>[t.id,t.name]));
  body.append(card('Темы уроков',data.lessons.map(l=>p(M.fmtFull(l.date)+' · '+(topics.get(l.topicId)||'Без темы')))));
 }
 choose.onchange=draw;draw();openSheet(stack([el('h2',{text:'Архив '+record.year.from+' — '+record.year.to}),p('Только чтение. Полная история хранится в общей резервной копии.'),field('Класс',choose),body,btn('Назад',back)]));
}
export async function openArchive(refresh=()=>{}){
 async function list(){
  try{const archives=(await W.listWork('archive')).sort((a,b)=>b.year.from.localeCompare(a.year.from));
   openSheet(stack([el('h2',{text:'Учебные годы'}),p('Архивы содержат персональные данные и историю. Используйте защищённые резервные копии; удаление архива не затрагивает текущий год.'),btn('Начать следующий учебный год',roll,'primary'),...archives.map(a=>card(a.year.from+' — '+a.year.to,[el('div',{class:'dashboard-metrics archive-metrics'},[metric('Классов',a.snapshot.classes.length,'classes'),metric('Учеников',a.snapshot.students.length,'journal'),metric('Отметок',a.snapshot.marks.length,'check')]),btn('Открыть архив',()=>viewArchive(a,list)),btn('Удалить архив',async()=>{if(!await confirmDialog({title:'Удалить архив?',text:'История этого года будет удалена с устройства. Сначала сохраните защищённую копию, если она нужна.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(a.id,'archive');await list();}catch(e){toast(e.message);}})])),!archives.length?p('Архивов пока нет.'):null,btn('Закрыть',closeSheet)]));
  }catch(e){toast(e.message);}
 }
 async function roll(){
  try{
   const data=await A.readSchool(),preview=A.archivePreview(data),year=Number(preview.year.from.slice(0,4))+1;
   const from=inp(year+'-09-01','date'),to=inp((year+1)+'-05-31','date'),kind=select(Object.entries(periodKinds),'trimester'),rows=data.classes.map(cls=>({cls,name:inp(A.suggestClassName(cls)),level:select([['','Не задана'],...Array.from({length:11},(_,i)=>[String(i+1),String(i+1)])],gradeLevelOf(cls)&&gradeLevelOf(cls)<11?String(gradeLevelOf(cls)+1):'')}));
   const save=btn('Архивировать и начать новый год',async()=>{
    const transfers=rows.map(r=>({id:r.cls.id,name:r.name.value,gradeLevel:r.level.value?Number(r.level.value):null}));
    const year={from:from.value,to:to.value};
    try{const next=A.buildNextYear(data,year,transfers,kind.value);if(!await confirmDialog({title:'Начать новый учебный год?',text:'В архив уйдут '+preview.classes+' классов и '+preview.marks+' отметок. Новый состав: '+next.classes.length+' классов, '+next.students.length+' учеников. Расписание и КТП потребуется задать заново. Создайте резервную копию перед переводом.',ok:'Перевести',danger:true}))return;save.disabled=true;await A.rollSchoolYear({year,transfers,kind:kind.value,expected:preview.token,confirmed:true});closeSheet();toast('Новый учебный год создан');await refresh();}catch(e){toast(e.message);}finally{save.disabled=false;}
   },'primary');
   openSheet(stack([el('h2',{text:'Переход на новый год'}),p('Текущий год: '+preview.year.from+' — '+preview.year.to+' · '+preview.students+' учеников. Перевод доступен после окончания года.'),el('div',{class:'archive-notice',text:'Сначала создайте защищённую копию. Закройте другие вкладки приложения. Оценки и КТП останутся в архиве, расписание и КТП нового года пустые. Общие и параллельные шкалы сохраняются; старые индивидуальные шкалы класса — только в архиве. Действующие на новый период ограничения и освобождения переносятся для проверки учителем.'}),field('Начало',from),field('Конец',to),field('Тип периодов',kind),p('Пустое название — класс остаётся только в архиве (например, выпускной).'),...rows.map(r=>card(r.cls.name,[field('Новое название',r.name),field('Новая параллель',r.level)])),save,btn('Назад',list)]));
  }catch(e){toast(e.message);}
 }
 await list();
}
