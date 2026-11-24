import {el,openSheet,closeSheet,toast} from '../ui.js';
import {searchWorkspace} from '../search.js';
export function openWorkspaceSearch(area,data,onChoose){
 const input=el('input',{type:'search',placeholder:'Имя, название, дата…','aria-label':'Поиск в рабочем пространстве'}),results=el('div',{class:'coach-stack','aria-live':'polite'});
 function draw(){const rows=searchWorkspace(area,data,input.value);results.replaceChildren(...rows.map(r=>el('button',{type:'button',class:'btn wide',text:r.title+' · '+r.detail,onclick:()=>{try{onChoose(r);}catch(e){toast(e.message);}}})));if(!rows.length)results.append(el('p',{text:input.value.trim()?'Ничего не найдено':'Введите поисковый запрос.'}));}
 input.oninput=draw;draw();openSheet(el('div',{class:'coach-form'},[el('h2',{text:'Поиск · '+(area==='coach'?'Тренер':'Учитель')}),input,results,el('button',{type:'button',class:'btn wide',text:'Закрыть',onclick:closeSheet})]));
}
