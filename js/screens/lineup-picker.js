/* Зона → игрок → следующая незаполненная зона. Черновик только в DOM. */
import {el} from '../ui.js';
const label=p=>(p.number==null?'':'№'+p.number+' · ')+p.name;
export function lineupPicker(players,initial=[],{excluded=[],previous=null,final=null,side='ours'}={}){
 const byId=new Map(players.map(p=>[p.id,p]));
 let blocked=new Set(excluded),slots=[],active=-1;
 const node=el('div',{class:'lineup-picker'}),progress=el('div',{class:'lineup-progress','aria-hidden':'true'}),court=el('div',{class:'lineup-court '+side}),choices=el('div',{class:'lineup-choices'}),status=el('p',{class:'lineup-status',role:'status','aria-live':'polite'});
 const btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn '+kind,text,onclick});
 function normalize(value){
  const seen=new Set();return Array.from({length:6},(_,i)=>{
   const id=value?.[i];if(!byId.has(id)||blocked.has(id)||seen.has(id))return '';
   seen.add(id);return id;
  });
 }
 function next(start=0){for(let k=0;k<6;k++){const i=(start+k)%6;if(!slots[i])return i;}return -1;}
 function set(value){slots=normalize(value);active=next();draw();}
 function draw(focus=false){
  const filled=slots.filter(Boolean).length;
  progress.replaceChildren(...slots.map((id,i)=>el('span',{class:'lineup-step'+(id?' filled':'')+(active===i?' active':''),text:String(i+1)})));
  status.textContent='Заполнено '+filled+' из 6. '+(active>=0?'Выберите игрока в зону '+(active+1):'Расстановка готова. Нажмите любую зону для изменения.');
  court.replaceChildren(el('div',{class:'lineup-net',text:'СЕТКА'}),...slots.map((id,i)=>{
   const p=byId.get(id);
   return el('button',{type:'button',class:'lineup-zone zone-'+(i+1)+(active===i?' active':''),'aria-pressed':String(active===i),'aria-label':'Зона '+(i+1)+': '+(p?label(p):'не заполнена'),onclick:()=>{active=i;draw(true);}},[
    el('small',{text:'Зона '+(i+1)}),el('strong',{text:p?.number??(p?'•':'+')}),el('span',{text:p?.name||'Выбрать'})]);
  }));
  choices.replaceChildren();
  if(active<0)return;
  const zone=active;
  choices.append(el('strong',{text:'Игрок в зону '+(zone+1)}));
  const available=players.filter(p=>!blocked.has(p.id)&&(!slots.includes(p.id)||slots[zone]===p.id));
  const list=el('div',{class:'lineup-player-list'},available.map(p=>btn(label(p),()=>{
   slots[zone]=p.id;active=next((zone+1)%6);draw(true);
  },slots[zone]===p.id?'primary':'')));
  choices.append(list);
  if(!available.length)choices.append(el('p',{text:'Нет свободных игроков. Проверьте заявку или освободите другую зону.'}));
  if(slots[zone])choices.append(btn('Освободить зону '+(zone+1),()=>{slots[zone]='';draw(true);},'wide'));
  if(focus){const first=list.querySelector('button');if(first)first.focus({preventScroll:true});}
 }
 node.append(progress,court,status,choices,el('div',{class:'lineup-tools'},[
  previous?btn('Копировать старт прошлой партии',()=>set(previous),'wide'):null,
  final?btn('Взять состав на конец партии',()=>set(final),'wide'):null,
  btn('Очистить расстановку',()=>set([]),'wide')
 ]));
 set(initial);
 return {node,get:()=>[...slots],set,setExcluded(ids){blocked=new Set(ids);set(slots);}};
}
