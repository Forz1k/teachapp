import {animateOnce,scoreChanges,enterGroup,normalizeMotion,motionModes,motionAllowed} from './motion.js';
import {primaryPortal,portalAddress,readPortal,portalState,countdown} from './public-portal.js';
import {reasons,boardPalette} from './match-protocol.js';
const root=document.getElementById('portal'),connection=document.getElementById('connection'),nav=document.getElementById('portal-nav');
const el=(tag,cls,text,...children)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);n.append(...children.filter(Boolean));return n;};
const p=(t,c='muted')=>el('p',c,t),card=(...children)=>el('section','card',null,...children);
const format=(t,options)=>new Intl.DateTimeFormat('ru-RU',options).format(t);
const date=t=>format(t,{dateStyle:'long',timeStyle:'short'})+' · местное время';
const head=(title,detail='')=>el('div','section-head',null,el('h2','',title),detail?el('small','',detail):null);
let data=null,connected=false,received=false,problem='',lastMode='',lastStale=false,tab='overview',lastMatchId=null,lastPaintedMatch=null,lastPaintedTab=null;
const tabs=[['overview','Матч'],['schedule','Расписание'],['results','Результаты']];
function renderNav(){if(!nav)return;nav.hidden=!data;if(!data)return;if(!nav.childElementCount){for(const [key,label] of tabs){const b=el('button','',label);b.type='button';b.dataset.tab=key;b.onclick=()=>{tab=key;draw();};nav.append(b);}}for(const b of nav.children)b.setAttribute('aria-pressed',String(b.dataset.tab===tab));}
function scoreNode(match,side){const n=el('strong','team-score',match.status==='finished'?match.setsWon[side]:match.score[side]);n.dataset.scoreSide=side;return n;}
function teams(team,opponent,match,logos=match?.logos){
 const item=(name,side)=>{const icon=el('div','team-icon',name.slice(0,1).toUpperCase());if(logos?.[side]){const image=el('img');image.src=logos[side];image.alt='';image.width=96;image.height=96;icon.replaceChildren(image);}const n=el('div','team',null,icon,el('span','team-name',name),match?scoreNode(match,side):null,match&&match.status==='live'?p(match.serve===side?'● Подача':'Приём','serve-mark'+(match.serve===side?' active':'')):null);if(match)n.style.setProperty('--team-color',boardPalette[match.colors[side]].start);return n;};
 return el('div','teams',null,item(team,'ours'),el('span','vs',match?':':'VS'),item(opponent,'theirs'));
}
function sets(m){const item=(x,i,active=false)=>el('span',active?'current':'',null,el('small','',active?'Сейчас · '+i:'Партия '+i),el('strong','',x.ours+':'+x.theirs));return el('div','sets',null,...m.sets.map((x,i)=>item(x,i+1)),m.status==='live'?item(m.score,m.set,true):null);}
function statTable(rows,side,team){const a=rows.filter(x=>x.side===side);if(!a.length)return null;const table=el('table','',null,el('thead','',null,el('tr','',null,...['№','Очки','Атаки*','Скидки','Эйсы','Блоки'].map(x=>el('th','',x)))),el('tbody','',null,...a.sort((a,b)=>b.points-a.points||a.number-b.number).map(x=>el('tr','',null,...[x.number,x.points,x.attack,x.tip,x.ace,x.block].map(v=>el('td','',v))))));return card(head(team),el('div','table-wrap',null,table),p('* Результативные атаки, включая скидки. Только отмеченные действия.'));}
function scheduleRows(items){return items.map(x=>el('div','fixture',null,el('div','date-tile',null,el('strong','',format(x.startAt,{day:'numeric'})),el('small','',format(x.startAt,{month:'short'}))),el('div','',null,el('strong','',data.team+' — '+x.opponent),el('small','',date(x.startAt)))));}
function archiveRows(items){return items.map(x=>el('div','fixture',null,el('div','',null,el('strong','',data.team+' — '+x.opponent),el('small','',date(x.startedAt)),el('div','archive-sets',x.sets.map(s=>s.ours+':'+s.theirs).join(' / '))),el('strong','result-score '+(x.setsWon.ours>x.setsWon.theirs?'win':x.setsWon.ours<x.setsWon.theirs?'loss':''),x.setsWon.ours+':'+x.setsWon.theirs)));}
function eventsPanel(m){return card(head('Ход матча','Последние '+m.events.length),...m.events.slice().reverse().map(e=>el('div','event',null,el('span','point-side '+e.side),el('strong','',e.score),el('div','',null,el('span','event-name',e.kind==='point'?'Очко без детализации':reasons[e.kind]),el('small','',(e.actor==='ours'?data.team:m.opponent)+(e.number==null?'':' · №'+e.number)+' · партия '+e.set+' · очко: '+(e.side==='ours'?data.team:m.opponent))))));}
function momentum(m){const rows=m.events.filter(e=>e.set===m.set);if(rows.length<2)return null;const chart=el('div','momentum',null,...rows.map(e=>{const n=el('span',e.side);n.title=e.score+' · '+(e.side==='ours'?data.team:m.opponent);return n;}));chart.style.setProperty('--n',rows.length);chart.setAttribute('role','img');chart.setAttribute('aria-label','Последние '+rows.length+' очков текущей партии: '+rows.map(e=>e.score+' '+(e.side==='ours'?data.team:m.opponent)).join(', '));return card(head('Динамика партии','Последние '+rows.length+' очков'),chart,el('div','legend',null,el('span','',data.team),el('span','',m.opponent)),p('Слева направо: от более раннего очка к последнему.'));}
function draw(){
 const now=Date.now(),state=portalState(data,now),stale=!!data&&['live','break'].includes(state.mode)&&now-data.updatedAt>90000,modeChanged=lastMode!==state.mode;lastMode=state.mode;lastStale=stale;
 const previous=lastPaintedMatch,current=data?.match;const changes=scoreChanges(previous,current),finished=previous&&current&&previous.id===current.id&&previous.status!=='finished'&&current.status==='finished';lastPaintedMatch=current?{id:current.id,set:current.set,status:current.status,score:{...current.score}}:null;
 const tabChanged=lastPaintedTab!==tab;lastPaintedTab=tab;
 const mount=parts=>{root.replaceChildren(...parts);if(tabChanged||modeChanged)enterGroup(root.children);};
 const matchId=state.match?.id;if(matchId&&matchId!==lastMatchId&&['live','break'].includes(state.mode))tab='overview';lastMatchId=matchId;
 connection.textContent=connected?'● На связи':received?'Нет связи':'Подключение…';connection.dataset.state=connected?'online':'offline';renderNav();
 if(!data){root.replaceChildren(card(el('h1','',received?'Страница пока не опубликована':'TeachApp Volleyball'),p(problem||(received?'Попросите тренера опубликовать расписание.':'Ожидание данных…'))));return;}
 const m=state.match,upcoming=data.schedule.filter(x=>x.id!==data.match?.scheduledId),past=[...(state.last?[state.last]:[]),...data.archive.filter(x=>x.id!==state.last?.id&&x.id!==m?.id)];
 if(m?.status==='finished'&&!past.some(x=>x.id===m.id))past.unshift(m);
 const parts=[];if(stale||!connected)parts.push(el('div','notice',stale?'Данные давно не обновлялись. Последний полученный счёт.':'Соединение восстанавливается. Показаны последние данные.'));
 if(tab==='schedule'){parts.push(upcoming.length?card(head('Расписание',upcoming.length+' встреч'),...scheduleRows(upcoming)):el('section','card empty',null,el('h2','','Расписание'),p('Предстоящих матчей пока нет.')));mount(parts);return;}
 if(tab==='results'){parts.push(past.length?card(head('Результаты',past.length+' встреч'),...archiveRows(past)):el('section','card empty',null,el('h2','','Результаты'),p('Опубликованных результатов пока нет.')));mount(parts);return;}
 const hero=el('section','card hero');hero.append(el('div','eyebrow','Волейбол · '+data.team));
 if(state.next){hero.append(el('div','status-pill',state.mode==='waiting'?'ОЖИДАНИЕ':'ПРЕДСТОЯЩАЯ ВСТРЕЧА'),el('h1','',state.mode==='waiting'?'Ожидаем начала матча':'Следующий матч'),teams(data.team,state.next.opponent,null,state.next.logos),p(date(state.next.startAt)));
 if(state.mode==='upcoming'){const labels=['дней','часов','мин','сек'];hero.append(el('div','clock',null,...countdown(state.remaining).map((n,i)=>el('div','',null,el('strong','',String(n).padStart(2,'0')),el('span','',labels[i])))),p('Трансляция начнётся автоматически после старта матча.'));}else hero.append(p('Счёт появится после фактического запуска тренером.'));
 }else if(m){const finished=m.status==='finished',live=m.status==='live';hero.append(el('div','status-pill'+(live?' live':''),live?'LIVE':finished?'ФИНАЛ':'ПЕРЕРЫВ'),el('h1','',finished?'Матч завершён':live?'Партия '+m.set:'Перерыв · партия '+m.set),teams(data.team,m.opponent,m),el('p','set-wins',finished?(m.setsWon.ours>m.setsWon.theirs?'Победа команды '+data.team:'Итог встречи'):'Партии '+m.setsWon.ours+':'+m.setsWon.theirs),sets(m));}
 else hero.append(el('h1','',data.team),p('Предстоящих матчей пока нет. Загляните позже.'));
 if(finished&&current){const final=el('div','fan-final'+(current.setsWon.ours>current.setsWon.theirs?'':' neutral'),null,el('strong','',current.setsWon.ours>current.setsWon.theirs?'Победа!':'Матч завершён'),el('span','',data.team+' — '+current.opponent+' · '+current.setsWon.ours+':'+current.setsWon.theirs));if(current.setsWon.ours>current.setsWon.theirs&&document.documentElement.dataset.motion==='full'&&motionAllowed()){const sparks=el('div','fan-sparks');sparks.setAttribute('aria-hidden','true');for(let i=0;i<16;i++){const n=el('i');n.style.setProperty('--x',Math.round(Math.cos(i*Math.PI/8)*(70+(i%3)*15))+'px');n.style.setProperty('--y',Math.round(Math.sin(i*Math.PI/8)*(40+(i%3)*10))+'px');n.style.setProperty('--turn',(i%2?1:-1)*(45+i*17)+'deg');n.style.setProperty('--spark', ['#FDE68A','#86EFAC','#F8FAFC','#93C5FD'][i%4]);sparks.append(n);}final.append(sparks);}parts.push(final);final.classList.add('fan-final-enter');}
 parts.push(hero);
 if(m?.events.length){const trend=momentum(m);parts.push(trend?el('div','overview-grid',null,eventsPanel(m),trend):eventsPanel(m));}
 if(m?.stats.length)parts.push(el('div','details-grid',null,...[statTable(m.stats,'ours',data.team),statTable(m.stats,'theirs',m.opponent)].filter(Boolean)));
 if(upcoming.length)parts.push(card(head('Расписание',upcoming.length+' встреч'),...scheduleRows(upcoming)));
 if(past.length&&!(past.length===1&&m?.status==='finished'))parts.push(card(head('Последние результаты'),...archiveRows(past.slice(0,5))));
 mount(parts);
 if(!tabChanged&&m&&m.status!=='finished'){for(const [side,kind] of Object.entries(changes)){const n=root.querySelector('[data-score-side="'+side+'"]');if(n){animateOnce(n,kind,{duration:320});if(kind==='score'){animateOnce(n.parentElement,'pulse',{duration:250});animateOnce(root.querySelector('.event'),'slide',{duration:220});}}}}
}
const brand=document.querySelector('.brand');if(brand)brand.href=location.href;
const motionControl=document.getElementById('fan-motion');
function viewerMotion(value){const v=normalizeMotion(value);document.documentElement.dataset.motion=v;if(motionControl){motionControl.textContent='Анимации: '+motionModes[v];motionControl.setAttribute('aria-label','Анимации: '+motionModes[v]+'; нажмите для смены режима');}try{window.localStorage.setItem('teachapp:viewer-motion',v);}catch{}}
try{viewerMotion(window.localStorage.getItem('teachapp:viewer-motion'));}catch{viewerMotion('full');}
if(motionControl)motionControl.onclick=()=>{const modes=['full','subtle','off'];viewerMotion(modes[(modes.indexOf(document.documentElement.dataset.motion)+1)%3]);};
const theme=document.getElementById('theme');
function setTheme(value){document.documentElement.dataset.theme=value;if(theme){theme.textContent=value==='light'?'☾':'☀';theme.setAttribute('aria-label',value==='light'?'Включить тёмную тему':'Включить светлую тему');}try{window.localStorage.setItem('teachapp:viewer-theme',value);}catch{}}
try{setTheme(window.localStorage.getItem('teachapp:viewer-theme')==='light'?'light':'dark');}catch{setTheme('dark');}
if(theme)theme.onclick=()=>setTheme(document.documentElement.dataset.theme==='light'?'dark':'light');
const share=document.getElementById('share');
if(share)share.onclick=async()=>{try{if(window.navigator.share){await window.navigator.share({title:'TeachApp Volleyball',url:location.href});return;}await window.navigator.clipboard.writeText(location.href);share.textContent='✓';setTimeout(()=>{share.textContent='↗';},1500);}catch(e){if(e.name==='AbortError')return;let input=document.querySelector('.share-fallback');if(!input){input=el('input','share-fallback');input.readOnly=true;input.setAttribute('aria-label','Ссылка для копирования');root.before(input);}input.value=location.href;input.focus();input.select();}};
try{
 const q=new URLSearchParams(location.search),url=q.size?portalAddress(q.get('db'),q.get('owner'),q.get('team')):portalAddress(primaryPortal.origin,primaryPortal.owner,primaryPortal.slug);
 const stream=new EventSource(url);
 stream.onopen=()=>{connected=true;problem='';draw();};
 let current=null;
 function receive(event){
  try{
   const {path,data:value}=JSON.parse(event.data);
   if(typeof path!=='string')return;
   if(path==='/'&&event.type==='put')current=value;
   else{
    if(!current||typeof current!=='object')current=Object.create(null);
    const assign=(key,v)=>{const parts=key.split('/').filter(Boolean);if(!parts.length||parts.some(k=>['__proto__','constructor','prototype'].includes(k)))return;let parent=current;for(const k of parts.slice(0,-1)){if(!Object.hasOwn(parent,k)||!parent[k]||typeof parent[k]!=='object')parent[k]=Object.create(null);parent=parent[k];}if(v===null)delete parent[parts.at(-1)];else parent[parts.at(-1)]=v;};
    if(event.type==='put')assign(path,value);else for(const [key,v] of Object.entries(value||{}))assign(path+'/'+key,v);
   }
   const next=readPortal(current),same=JSON.stringify(data&&{...data,updatedAt:0})===JSON.stringify(next&&{...next,updatedAt:0}),wasConnected=connected;data=next;received=true;connected=true;if(!same||!wasConnected||lastStale||portalState(data).mode!==lastMode)draw();
  }catch{connected=false;problem='Не удалось прочитать обновление. Ожидаем повторного подключения.';draw();}
 }
 stream.addEventListener('put',receive);stream.addEventListener('patch',receive);
 stream.onerror=()=>{connected=false;problem='Не удалось подключиться. Проверьте ссылку или интернет.';draw();};
 stream.addEventListener('cancel',()=>{stream.close();connected=false;data=null;received=true;problem='Страница недоступна';draw();});
 stream.addEventListener('auth_revoked',()=>{stream.close();connected=false;data=null;received=true;problem='Доступ отозван';draw();});
 window.addEventListener('pagehide',()=>{stream.close();clearInterval(clock);},{once:true});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 const clock=setInterval(()=>{if(!data)return;const state=portalState(data),stale=['live','break'].includes(state.mode)&&Date.now()-data.updatedAt>90000;if(state.mode!==lastMode||stale!==lastStale){draw();return;}if(state.mode==='upcoming'&&tab==='overview')root.querySelectorAll('.clock strong').forEach((n,i)=>{const value=String(countdown(state.remaining)[i]).padStart(2,'0');if(n.textContent===value)return;n.textContent=value;if(i<3&&!document.hidden)animateOnce(n,'score',{duration:200});});},1000);
}catch{received=true;problem='Откройте постоянную ссылку, которую отправил тренер.';draw();}
