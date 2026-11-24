import * as C from '../coach.js';
import {testPresets,testRestrictions,testHistory,summarizeTests} from '../coach-tests.js';
import {todayIso,fmtFull} from '../model.js';
import {catalog} from '../health.js';
import {el,openSheet,closeSheet,toast,confirmDialog} from '../ui.js';
import {trendChart} from '../dashboard.js';
const p=text=>el('p',{text});
const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]);
const inp=(value='',type='text',props={})=>el('input',{value,type,...props});
const sel=(options,value)=>{const n=el('select',{},options.map(([value,text])=>el('option',{value,text})));n.value=value;return n;};
const label=p=>(p.number==null?'':'№'+p.number+' · ')+p.name+(p.archived?' (архив)':'');
const number=n=>n.value.trim()===''?null:Number(n.value);
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const percent=v=>v===null?'—':Math.round(v*10)/10+'%';
export function openTestForm(team,view,existing,refresh,playerId=null){
 const initial=existing?.definition||testPresets.serve;
 const preset=sel([['custom','Свой тест'],...Object.entries(testPresets).map(([id,d])=>[id,d.name])],existing?'custom':'serve');
 const name=inp(initial.name,'text',{maxlength:200}),protocol=inp(initial.protocol,'text',{maxlength:500}),activity=sel(catalog.map(a=>[a.id,a.name]),initial.activityId),kind=sel([['skill','Попытки / успехи'],['measure','Физический замер']],initial.kind);
 const unit=inp(initial.unit||'см','text',{maxlength:20}),direction=sel([['higher','Больше — лучше'],['lower','Меньше — лучше']],initial.direction||'higher');
 const date=inp(existing?.date||todayIso(),'date'),measureFields=el('div',{class:'coach-columns'},[field('Единица',unit),field('Направление',direction)]);
 const definition=()=>({name:name.value.trim(),protocol:protocol.value.trim(),activityId:activity.value,kind:kind.value,unit:kind.value==='measure'?unit.value.trim():'',direction:kind.value==='measure'?direction.value:''});
 const list=el('div',{class:'coach-stack'}),players=view.players.filter(p=>!p.archived||existing?.results[p.id]).filter(p=>!playerId||p.id===playerId);
 const drafts=new Map(players.map(player=>[player.id,{status:existing?.results[player.id]?.status||'',attempts:existing?.results[player.id]?.attempts??'',success:existing?.results[player.id]?.success??'',errors:existing?.results[player.id]?.errors??'',target:existing?.results[player.id]?.target??'',value:existing?.results[player.id]?.value??'',adapted:existing?.results[player.id]?.adapted||false,note:existing?.results[player.id]?.note||''}]));
 const status=el('p',{role:'status'});
 function draw(){
  measureFields.hidden=kind.value!=='measure';list.replaceChildren();
  for(const player of players){
   const d=drafts.get(player.id),limits=testRestrictions(player,definition(),date.value),blocked=limits.some(r=>r.type==='avoid'),adapt=limits.some(r=>r.type==='adapt');
   const choose=sel([['','Не вносить'],['done','Выполнено'],['restricted','Ограничение'],['skipped','Не выполнено']],d.status);choose.onchange=()=>{d.status=choose.value;draw();};
   const children=[field('Статус',choose)];
   if(limits.length)children.push(p(blocked?'Ограничение: не выполнять. Новые числовые результаты блокируются.':'Требуется адаптировать нагрузку.'));
   if(d.status==='done'){
    if(kind.value==='skill'){
     for(const [key,title] of [['attempts','Попытки'],['success','Успехи'],['errors','Ошибки'],['target','Попадания в цель (необязательно)']]){const n=inp(d[key],'number',{min:0,max:10000,step:1,inputmode:'numeric'});n.oninput=()=>{d[key]=n.value;};children.push(field(title,n));}
    }else{const n=inp(d.value,'number',{min:0,max:1000000,step:'any',inputmode:'decimal'});n.oninput=()=>{d.value=n.value;};children.push(field('Результат · '+unit.value,n));}
    const check=el('input',{type:'checkbox'});check.checked=d.adapted;check.onchange=()=>{d.adapted=check.checked;};children.push(field('Адаптированная методика (отдельно от сравнения)',check));
   }
   if(d.status){const n=inp(d.note,'text',{maxlength:500});n.oninput=()=>{d.note=n.value;};children.push(field('Примечание (без медицинских данных)',n));}
   list.append(card(label(player),children));
  }
 }
 preset.onchange=()=>{const d=testPresets[preset.value];if(d){name.value=d.name;protocol.value=d.protocol;activity.value=d.activityId;kind.value=d.kind;unit.value=d.unit||'см';direction.value=d.direction||'higher';draw();}};
 for(const n of [kind,activity,date,unit])n.onchange=draw;
 draw();
 const fill=btn('Отметить всех без записи как «выполнено»',()=>{for(const [id,d] of drafts){const player=players.find(p=>p.id===id);if(!d.status&&!testRestrictions(player,definition(),date.value).some(r=>r.type==='avoid'))d.status='done';}draw();});
 const save=btn('Сохранить результаты',async()=>{
  save.disabled=true;try{
   const def=definition(),results={};
   const val=v=>String(v).trim()===''?null:Number(v);
   for(const [id,d] of drafts){if(!d.status)continue;const done=d.status==='done',skill=def.kind==='skill';results[id]={status:d.status,attempts:done&&skill?val(d.attempts):null,success:done&&skill?val(d.success):null,errors:done&&skill?val(d.errors):null,target:done&&skill?val(d.target):null,value:done&&!skill?val(d.value):null,adapted:done&&d.adapted,note:d.note.trim()};}
   if(existing&&Object.keys(existing.results).some(id=>!Object.hasOwn(results,id))&&!await confirmDialog({title:'Удалить часть результатов?',text:'Незаполненные строки будут удалены из этого тестирования.',ok:'Удалить',danger:true}))return;
   await C.saveCoachTest({id:existing?.id,teamId:team.id,date:date.value,definition:def,results});closeSheet();toast('Тестирование сохранено');await refresh();
  }catch(e){status.textContent=e.message;toast(e.message);}finally{save.disabled=false;}
 },'primary');
 openSheet(el('div',{class:'coach-form'},[el('h2',{text:existing?'Редактировать тестирование':'Новое тестирование'}),p('Результаты тренировок не меняют матчевую статистику или школьные оценки. Выберите одинаковую методику для сравнения.'),field('Шаблон',preset),field('Название',name),field('Методика / критерий успеха',protocol),field('Нагрузка',activity),field('Тип',kind),measureFields,field('Дата',date),fill,list,status,save,btn('Закрыть',closeSheet)]));
}
export function testList(team,view,refresh){
 const nodes=[team.archived?null:btn('+ Тестирование команды',()=>openTestForm(team,view,null,refresh),'primary')];
 for(const s of view.tests){const rows=Object.entries(s.results);nodes.push(card(s.definition.name,[p(fmtFull(s.date)+' · '+s.definition.protocol),p('Записей: '+rows.length+' · выполнено '+rows.filter(([,r])=>r.status==='done').length),btn('Результаты / редактирование',()=>openTestForm(team,view,s,refresh)),btn('Удалить тестирование',async()=>{if(!await confirmDialog({title:'Удалить тестирование?',text:'Все результаты этой записи будут удалены.',ok:'Удалить',danger:true}))return;try{await C.deleteCoachTest(s.id);await refresh();}catch(e){toast(e.message);}})]));}
 if(!view.tests.length)nodes.push(p('Тестирований пока нет.'));
 return el('div',{class:'coach-stack'},nodes);
}
export function playerTestCards(view,id,range){
 return summarizeTests(testHistory(view.tests,id,range)).map(g=>card(g.definition.name,[p(g.definition.protocol),g.definition.kind==='skill'?p('Успешность: '+percent(g.pct)+' · '+g.success+'/'+g.attempts+' · ошибки '+g.errors+' · цель '+percent(g.targetPct)):p('Первый: '+(g.first??'—')+' · последний: '+(g.last??'—')+' · лучший: '+(g.best??'—')+' '+g.definition.unit),g.definition.kind==='skill'?trendChart(g.history.filter(h=>h.result.status==='done'&&!h.result.adapted).map(h=>({date:h.date,value:100*h.result.success/h.result.attempts})).slice(-20),{min:0,max:100,unit:'%',label:g.definition.name}):trendChart(g.measurements.slice(-20),{unit:g.definition.unit,label:g.definition.name}),p('Адаптированных: '+g.adapted+' · пропущено: '+g.skipped+' · ограничение: '+g.restricted),...g.history.map(h=>{const r=h.result;return p(fmtFull(h.date)+' · '+(r.status==='done'?(h.definition.kind==='skill'?r.success+'/'+r.attempts+' · ошибки '+r.errors+(r.target===null?'':' · цель '+r.target):r.value+' '+h.definition.unit)+(r.adapted?' (адаптировано)':''):r.status==='restricted'?'Ограничение':'Не выполнено'));})]));
}
