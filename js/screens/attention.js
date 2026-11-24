import * as M from '../model.js';
import {el,openSheet,closeSheet,icon} from '../ui.js';
import {taskLabels,orderTasks} from '../attention.js';
const icons={lesson:'journal',review:'shield',training:'calendar',match:'trophy',custom:'check',backup:'shield'};
function taskRow(task,onOpen){return el('button',{type:'button',class:'attention-row priority-'+task.priority,onclick:()=>onOpen(task)},[el('span',{class:'metric-icon'},[icon(icons[task.kind]||'check')]),el('span',{class:'attention-text'},[el('strong',{text:task.title}),el('small',{text:M.fmtFull(task.date)+' · '+task.detail})]),icon('chevron')]);}
export function attentionPanel(tasks,onOpen){
 const sorted=orderTasks(tasks),box=el('section',{class:'card-block attention-panel'});
 function openAll(){
  const body=el('div',{class:'coach-stack'}),filter=el('select',{'aria-label':'Тип рабочей задачи'},[el('option',{value:'all',text:'Все задачи'}),...Object.entries(taskLabels).filter(([id])=>sorted.some(t=>t.kind===id)).map(([value,text])=>el('option',{value,text}))]);
  function draw(){const rows=sorted.filter(t=>filter.value==='all'||t.kind===filter.value);body.replaceChildren(...rows.map(t=>taskRow(t,onOpen)));if(!rows.length)body.append(el('p',{text:'Нет задач.'}));}
  filter.onchange=draw;draw();openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Центр управления'}),el('p',{text:'Уроки и тренировки за последние 30 дней, сроки на ближайшую неделю и незавершённые задачи. Подсказки не изменяют оценки и допуски.'}),filter,body,el('button',{class:'btn wide',type:'button',text:'Закрыть',onclick:closeSheet})]));
 }
 box.append(el('div',{class:'attention-heading'},[el('h2',{text:'Требуют внимания'}),el('span',{class:'attention-count',text:String(sorted.length)})]));
 if(!sorted.length)box.append(el('p',{class:'profile-note',text:'По проверенным записям срочных задач нет.'}));
 else{box.append(...sorted.slice(0,3).map(t=>taskRow(t,onOpen)),el('button',{class:'btn wide',type:'button',text:'Все задачи · '+sorted.length,onclick:openAll}));}
 return box;
}
