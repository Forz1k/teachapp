import * as M from '../model.js';
import {el,openSheet,closeSheet,icon} from '../ui.js';
import {taskLabels,orderTasks,filterTasks} from '../attention.js';
const icons={lesson:'journal',review:'shield',training:'calendar',goal:'chart',match:'trophy',custom:'check',backup:'shield'};
function taskRow(task,onOpen){return el('button',{type:'button',class:'attention-row priority-'+task.priority,onclick:()=>onOpen(task)},[el('span',{class:'metric-icon'},[icon(icons[task.kind]||'check')]),el('span',{class:'attention-text'},[el('strong',{text:task.title}),el('small',{text:M.fmtFull(task.date)+' · '+task.detail})]),icon('chevron')]);}
export function attentionPanel(tasks,onOpen){
 const sorted=orderTasks(tasks),box=el('section',{class:'card-block attention-panel'});
 function openAll(){
  const body=el('div',{class:'coach-stack'}),filter=el('select',{'aria-label':'Тип рабочей задачи'},[el('option',{value:'all',text:'Все задачи'}),...Object.entries(taskLabels).filter(([id])=>sorted.some(t=>t.kind===id)).map(([value,text])=>el('option',{value,text}))]);
  const urgency=el('select',{'aria-label':'Срочность'},[el('option',{value:'all',text:'Любая срочность'}),el('option',{value:'3',text:'Приоритетные'}),el('option',{value:'4',text:'Очень срочные'})]);
  const search=el('input',{type:'search',placeholder:'Поиск по задачам','aria-label':'Поиск по задачам'});
  const count=el('p',{class:'profile-note','aria-live':'polite'}),more=el('button',{class:'btn wide',type:'button',text:'Показать ещё'});
  let limit=30;
  function draw(){
   const rows=filterTasks(sorted,{kind:filter.value,priority:urgency.value,query:search.value});
   body.replaceChildren(...rows.slice(0,limit).map(t=>taskRow(t,onOpen)));
   if(!rows.length)body.append(el('p',{text:'Нет задач по выбранным условиям.'}));
   count.textContent='Показано '+Math.min(rows.length,limit)+' из '+rows.length;
   more.hidden=rows.length<=limit;
   if(more.hidden)more.style.display='none';else more.style.removeProperty('display');
  }
  function reset(){limit=30;draw();}
  filter.onchange=reset;urgency.onchange=reset;search.oninput=reset;
  more.onclick=()=>{limit+=30;draw();};
  draw();openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Центр управления'}),el('p',{text:'Уроки и тренировки за последние 30 дней, сроки на ближайшую неделю и незавершённые задачи. Подсказки не изменяют оценки и допуски.'}),search,filter,urgency,count,body,more,el('button',{class:'btn wide',type:'button',text:'Закрыть',onclick:closeSheet})]));
 }
 box.append(el('div',{class:'attention-heading'},[el('h2',{text:'Требуют внимания'}),el('span',{class:'attention-count',text:String(sorted.length)})]));
 if(!sorted.length)box.append(el('p',{class:'profile-note',text:'По проверенным записям срочных задач нет.'}));
 else{box.append(...sorted.slice(0,3).map(t=>taskRow(t,onOpen)),el('button',{class:'btn wide',type:'button',text:'Все задачи · '+sorted.length,onclick:openAll}));}
 return box;
}
