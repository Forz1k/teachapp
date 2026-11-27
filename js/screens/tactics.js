import * as C from '../coach.js';
import * as W from '../workbench.js';
import {testDefinitions} from '../coach-season.js';
import {opponentHistory} from '../match-tactics.js';
import {todayIso,uid} from '../model.js';
import {initialMarkers,saveBoard,lineupOptions,lineupRoles,roleNames} from '../tactics.js';
import {el,openSheet,closeSheet,toast,confirmDialog} from '../ui.js';
const p=text=>el('p',{text}),btn=(text,onclick,kind='')=>el('button',{type:'button',class:'btn wide '+kind,text,onclick});
const inp=(value='',type='text',props={})=>el('input',{value,type,...props});
const field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]);
const select=(rows,value)=>{const n=el('select',{},rows.map(([value,text])=>el('option',{value,text})));n.value=value??rows[0]?.[0]??'';return n;};
const card=(title,children)=>el('section',{class:'card-block coach-card'},[el('h3',{text:title}),...children]);
const stack=children=>el('div',{class:'coach-form'},children);
const ns='http://www.w3.org/2000/svg';
const svgNode=(tag,attrs={})=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
let markerCounter=0;
export function boardGraphic(board,{selected='',pending=null,onPoint=null}={}){
 const svg=svgNode('svg',{viewBox:'0 0 300 600',class:'tactic-board',role:'img','aria-label':board.name||'Тактическая схема'});
 svg.append(svgNode('rect',{x:0,y:0,width:300,height:600,rx:10,fill:'#D0A171'}),svgNode('rect',{x:8,y:8,width:284,height:584,rx:3,fill:'none',stroke:'#fff','stroke-width':3}));
 for(const y of [200,300,400])svg.append(svgNode('line',{x1:8,x2:292,y1:y,y2:y,stroke:y===300?'#244052':'#fff','stroke-width':y===300?8:3}));
 const defs=svgNode('defs'),id='tactic-arrow-'+(++markerCounter);
 for(const [style,color] of [['move','#123D80'],['ball','#8D2E24']]){const m=svgNode('marker',{id:id+'-'+style,markerWidth:7,markerHeight:7,refX:6,refY:3.5,orient:'auto'});m.append(svgNode('path',{d:'M0 0L7 3.5L0 7z',fill:color}));defs.append(m);}svg.append(defs);
 for(const a of board.arrows){const c=a.style==='ball'?'#8D2E24':'#123D80';svg.append(svgNode('line',{x1:a.from.x,y1:a.from.y,x2:a.to.x,y2:a.to.y,stroke:c,'stroke-width':3.5,'stroke-dasharray':a.style==='ball'?'5 4':'none','marker-end':'url(#'+id+'-'+a.style+')'}));}
 for(const m of board.markers){
  svg.append(svgNode('circle',{cx:m.x,cy:m.y,r:17,fill:m.side==='ours'?'#194F91':'#9A3D54',stroke:m.id===selected?'#FFF2A0':'#fff','stroke-width':m.id===selected?4:2}));
  const t=svgNode('text',{x:m.x,y:m.y+5,'text-anchor':'middle','font-size':m.label.length>4?9:13,'font-weight':750,fill:'white','pointer-events':'none'});t.textContent=m.label;svg.append(t);
 }
 if(pending)svg.append(svgNode('circle',{cx:pending.x,cy:pending.y,r:8,fill:'none',stroke:'#123D80','stroke-width':3}));
 if(onPoint)svg.addEventListener('click',e=>{const r=svg.getBoundingClientRect();if(!r.width||!r.height)return;const x=Math.max(15,Math.min(285,Math.round((e.clientX-r.left)*300/r.width))),y=Math.max(15,Math.min(585,Math.round((e.clientY-r.top)*600/r.height)));onPoint({x,y});});
 return svg;
}
export function openBoardView(board,back=closeSheet){openSheet(stack([el('h2',{text:board.name}),boardGraphic(board),p(board.note),btn('Назад',back)]));}
function boardForm(team,existing,back){
 const b=existing||{},name=inp(b.name||''),note=el('textarea',{rows:3,maxlength:2000},[b.note||'']),draft={markers:structuredClone(b.markers||initialMarkers()),arrows:structuredClone(b.arrows||[])},undo=[],holder=el('div',{class:'tactic-board-holder'}),markers=select([]),label=inp(''),side=select([['ours','Наши'],['theirs','Соперник']]),mode=select([['place','Переместить фишку'],['move','Стрелка перемещения'],['ball','Траектория мяча']]),status=p('');
 let pending=null,selected=draft.markers[0]?.id||'';
 function checkpoint(){undo.push(structuredClone(draft));if(undo.length>50)undo.shift();}
 function draw(){
  markers.replaceChildren(...draft.markers.map(m=>el('option',{value:m.id,text:(m.side==='ours'?'Наши · ':'Соперник · ')+m.label})));
  if(!draft.markers.some(m=>m.id===selected))selected=draft.markers[0]?.id||'';markers.value=selected;
  const m=draft.markers.find(m=>m.id===selected);label.value=m?.label||'';side.value=m?.side||'ours';
  status.textContent=mode.value==='place'?'Выберите фишку и коснитесь точки на площадке.':pending?'Коснитесь конца стрелки.':'Коснитесь начала стрелки.';
  holder.replaceChildren(boardGraphic({...draft,name:name.value},{selected,pending,onPoint:point=>{if(mode.value==='place'){const m=draft.markers.find(m=>m.id===selected);if(m){checkpoint();Object.assign(m,point);}}else if(!pending)pending=point;else{if(draft.arrows.length>=100)return toast('Максимум 100 стрелок');if(point.x!==pending.x||point.y!==pending.y){checkpoint();draft.arrows.push({id:uid('arrow'),style:mode.value,from:pending,to:point});}pending=null;}draw();}}));
 }
 markers.onchange=()=>{selected=markers.value;draw();};mode.onchange=()=>{pending=null;draw();};draw();
 const save=btn('Сохранить схему',async()=>{save.disabled=true;try{await saveBoard({id:b.id,kind:'tacticBoard',teamId:team.id,name:name.value.trim(),note:note.value.trim(),markers:draft.markers,arrows:draft.arrows,revision:b.revision??0});await back();}catch(e){toast(e.message);}finally{save.disabled=false;}},'primary');
 openSheet(stack([el('h2',{text:'Тактическая доска'}),field('Название',name),field('Режим',mode),status,holder,field('Фишка',markers),el('div',{class:'coach-columns'},[field('Подпись (номер / роль)',label),field('Сторона',side)]),btn('Изменить фишку',()=>{const m=draft.markers.find(m=>m.id===selected);if(m&&label.value.trim()&&label.value.length<=12){checkpoint();m.label=label.value.trim();m.side=side.value;draw();}}),btn('+ Фишка',()=>{if(draft.markers.length<24){checkpoint();selected=uid('marker');draft.markers.push({id:selected,label:String(draft.markers.length+1),side:side.value,x:150,y:side.value==='ours'?500:100});draw();}}),btn('Убрать выбранную фишку',()=>{if(selected){checkpoint();draft.markers=draft.markers.filter(m=>m.id!==selected);draw();}}),btn('Убрать последнюю стрелку',()=>{if(draft.arrows.length){checkpoint();draft.arrows.pop();pending=null;draw();}}),btn('Отменить изменение',()=>{const prev=undo.pop();if(prev){Object.assign(draft,prev);pending=null;draw();}}),field('Методические заметки',note),save,btn('Назад',back)]),{fullHeight:true});
}
export async function openTacticBoards(team){
 async function draw(){try{const rows=(await W.listWork('tacticBoard')).filter(b=>b.teamId===team.id);openSheet(stack([el('h2',{text:'Тактические схемы · '+team.name}),p('Фишки, перемещения и траектория мяча. Схемы можно прикрепить к конспекту тренировки.'),team.archived?null:btn('+ Схема',()=>boardForm(team,null,draw),'primary'),...rows.map(b=>card(b.name,[boardGraphic(b),p(b.note),btn('Открыть / редактировать',()=>boardForm(team,b,draw)),btn('Копировать',()=>boardForm(team,{...b,id:undefined,name:b.name+' (копия)'},draw)),btn('Удалить',async()=>{if(!await confirmDialog({title:'Удалить схему?',text:'Снимки в конспектах останутся.',ok:'Удалить',danger:true}))return;try{await W.deleteWork(b.id,'tacticBoard');await draw();}catch(e){toast(e.message);}})])),btn('Закрыть',closeSheet)]));}catch(e){toast(e.message);}}
 await draw();
}
const labelPlayer=p=>p?(p.number==null?'':'№'+p.number+' ')+p.name:'—';
export function openLineupAssistant(team,view,back=closeSheet){
 const scheme=select([['5-1','5–1'],['4-2','4–2']],'5-1'),date=inp(todayIso(),'date'),from=inp('','date'),to=inp(todayIso(),'date'),defs=testDefinitions(view.tests).filter(([,d])=>d.kind==='skill'),methods=Object.fromEntries(['setter','outside','middle','opposite'].map(role=>[role,select([['','Только амплуа'],...defs.map(([k,d])=>[k,d.name+' · '+d.protocol])])])),body=el('div',{class:'coach-stack'}),players=view.players.filter(p=>!p.archived);
 const opponent=select([['','Все соперники'],...opponentHistory(view.matches).map(o=>[o.key,o.name])]);
 const checks=players.map(player=>{const n=el('input',{type:'checkbox'});n.checked=true;return {player,n};}),picked=el('details',{},[el('summary',{text:'Участники (подтвердите вручную)'}),...checks.map(({player,n})=>field(labelPlayer(player),n))]);
 const clear=()=>body.replaceChildren(p('Нажмите «Предложить варианты» после изменения параметров.'));
 for(const n of [scheme,date,from,to,opponent,...Object.values(methods),...checks.map(x=>x.n)])n.onchange=clear;
 const gen=async()=>{
  try{
   const {data}=await C.loadCoachTeamScope(team.id,'dossier'),fresh=C.teamView(data,team.id),opts={scheme:scheme.value,date:date.value,from:from.value,to:to.value,opponent:opponent.value,methods:Object.fromEntries(Object.entries(methods).map(([k,n])=>[k,n.value])),selected:checks.filter(x=>x.n.checked).map(x=>x.player.id)};
   const a=lineupOptions(fresh,opts),byId=new Map(fresh.players.map(p=>[p.id,p]));
   body.replaceChildren(p('Доступны для рассмотрения: '+a.available+' · не предложены по внесённым ограничениям: '+a.excluded.length+'. Это не медицинский допуск.'));
   body.append(p('Совместная игра: подробных матчей '+a.matchEvidence.detailed+' из '+a.matchEvidence.total+(opts.opponent?' против выбранного соперника':' по всем соперникам')+'. Тесты не фильтруются по сопернику.'));
   if(!a.options.length)body.append(p('Не найден состав из шести разных игроков с заданными амплуа. Измените выбор вручную.'));
   for(const [i,o] of a.options.entries()){
    const name=inp('Вариант '+(i+1)+' · '+scheme.value),libero=select([['','Без либеро'],...a.liberos.map(id=>[id,labelPlayer(byId.get(id))])]);
    body.append(card('Вариант '+(i+1),[p('Точных амплуа: '+o.exact+'/6 · сопоставимых показателей: '+o.known+'/6 · пары с историей: '+o.paired),...o.ids.map((id,j)=>p('P'+(j+1)+' · '+roleNames[o.roles[j]]+' · '+labelPlayer(byId.get(id))+(o.evidence[j]?' · '+Math.round(o.evidence[j].value*10)/10+'% ('+o.evidence[j].attempts+' попыток)':' · без сравнимой выборки'))),field('Либеро',libero),field('Название шаблона',name),btn('Сохранить расстановку',async()=>{try{
      if(!await confirmDialog({title:'Сохранить предложенный шаблон?',text:'Проверьте состав, позиции и актуальные ограничения. Матч не запускается.',ok:'Сохранить'}))return;
      const latest=C.teamView((await C.loadCoachTeamScope(team.id,'dossier')).data,team.id),recheck=lineupOptions(latest,opts);
      if(!recheck.options.some(x=>JSON.stringify(x.ids)===JSON.stringify(o.ids))||libero.value&&!recheck.liberos.includes(libero.value))throw Error('Состав или данные изменились. Сформируйте варианты заново');
      await C.saveLineup({teamId:team.id,name:name.value,scheme:opts.scheme,lineup:o.ids,roster:[...o.ids,...(libero.value?[libero.value]:[])],libero:libero.value||null});toast('Шаблон сохранён');back();
     }catch(e){toast(e.message);}},'primary')]));
   }
  }catch(e){body.replaceChildren(p(e.message));}
 };
 clear();openSheet(stack([el('h2',{text:'Помощник стартового состава'}),p('Предложения эвристические: амплуа, достаточность выбранных сопоставимых тестов, наблюдаемая совместная игра. Универсальные игроки могут закрыть позицию. Не гарантирует оптимум и не заменяет решение тренера.'),field('Схема',scheme),field('Дата матча / проверки',date),el('div',{class:'coach-columns'},[field('Статистика с',from),field('По',to)]),field('Соперник для истории сочетаний',opponent),...Object.entries(methods).map(([role,n])=>field('Методика · '+roleNames[role],n)),picked,btn('Предложить варианты',gen,'primary'),body,btn('Назад',back)]));
}
