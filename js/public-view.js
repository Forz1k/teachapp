import {portalAddress,readPortal,portalState,countdown} from './public-portal.js';
import {reasons,boardPalette} from './match-protocol.js';
const root=document.getElementById('portal'),connection=document.getElementById('connection');
const el=(tag,cls,text,...children)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);n.append(...children.filter(Boolean));return n;};
const p=(t,c='muted')=>el('p',c,t),card=(...children)=>el('section','card',null,...children);
const date=t=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'long',timeStyle:'short'}).format(t)+' · местное время';
let data=null,connected=false,received=false,problem='',lastMode='',lastStale=false;
function teams(team,opponent,match){
 const item=(name,side)=>{const icon=el('div','team-icon',name.slice(0,1).toUpperCase());if(match)icon.style.background=boardPalette[match.colors[side]].end;return el('div','team',null,icon,el('span','',name),match?el('strong','team-score',match.status==='finished'?match.setsWon[side]:match.score[side]):null,match&&match.status==='live'?p(match.serve===side?'● Подача':'Приём'):null);};
 return el('div','teams',null,item(team,'ours'),el('span','vs',match?':':'VS'),item(opponent,'theirs'));
}
function sets(m){return el('div','sets',null,...m.sets.map((x,i)=>el('span','',(i+1)+' · '+x.ours+':'+x.theirs)),m.status==='live'?el('span','',m.set+' · '+m.score.ours+':'+m.score.theirs):null);}
function statTable(rows,side,team){const a=rows.filter(x=>x.side===side);if(!a.length)return null;const table=el('table','',null,el('thead','',null,el('tr','',null,...['№','Очки','Атаки','Скидки','Эйсы','Блоки'].map(x=>el('th','',x)))),el('tbody','',null,...a.sort((a,b)=>b.points-a.points).map(x=>el('tr','',null,...[x.number,x.points,x.attack,x.tip,x.ace,x.block].map(v=>el('td','',v))))));return card(el('h2','',team),el('div','table-wrap',null,table));}
function draw(){
 const now=Date.now(),state=portalState(data,now),stale=!!data&&['live','break'].includes(state.mode)&&now-data.updatedAt>90000;lastMode=state.mode;lastStale=stale;
 connection.textContent=connected?'● Подключено':received?'Нет связи · последний счёт':'Подключение…';
 if(!data){root.replaceChildren(card(el('h1','',received?'Страница пока не опубликована':'TeachApp Volleyball'),p(problem||(received?'Попросите тренера опубликовать расписание.':'Ожидание данных…'))));return;}
 const hero=el('section','card hero');const m=state.match;
 if(state.next){hero.append(el('h1','',state.mode==='waiting'?'Ожидаем начала матча':'Следующий матч'),teams(data.team,state.next.opponent),p(date(state.next.startAt)));
 if(state.mode==='upcoming'){const labels=['дней','часов','мин','сек'];hero.append(el('div','clock',null,...countdown(state.remaining).map((n,i)=>el('div','',null,el('strong','',String(n).padStart(2,'0')),el('span','',labels[i])))));}else hero.append(p('Счёт появится после фактического запуска тренером.'));
 }else if(m){hero.append(el('h1',m.status==='live'?'live':'',m.status==='finished'?'Матч завершён':m.status==='break'?'Перерыв · партия '+m.set:'● LIVE · партия '+m.set),teams(data.team,m.opponent,m),p('Партии '+m.setsWon.ours+':'+m.setsWon.theirs),sets(m));}
 else hero.append(el('h1','',data.team),p('Предстоящих матчей пока нет.'));
 const parts=[hero];if(stale||!connected)parts.unshift(el('div','notice',stale?'Данные давно не обновлялись. Последний полученный счёт.':'Соединение восстанавливается. Показаны последние данные.'));
 if(m?.events.length){parts.push(card(el('h2','','Последние события'),...m.events.slice().reverse().map(e=>el('div','event',null,el('strong','',e.score),el('div','',null,el('span','',reasons[e.kind]),el('small','',(e.actor==='ours'?data.team:m.opponent)+(e.number==null?'':' · №'+e.number)+' · партия '+e.set))))));}
 if(m?.stats.length){parts.push(el('div','details-grid',null,...[statTable(m.stats,'ours',data.team),statTable(m.stats,'theirs',m.opponent)].filter(Boolean)));}
 const upcoming=data.schedule.filter(x=>x.id!==data.match?.scheduledId);if(upcoming.length)parts.push(card(el('h2','','Расписание'),...upcoming.map(x=>el('div','fixture',null,el('div','',null,el('strong','',data.team+' — '+x.opponent),el('small','',date(x.startAt)))))));
 const past=[...(state.last?[state.last]:[]),...data.archive.filter(x=>x.id!==state.last?.id&&x.id!==m?.id)];if(past.length)parts.push(card(el('h2','','Последние результаты'),...past.map(x=>el('div','fixture',null,el('div','',null,el('strong','',data.team+' — '+x.opponent),el('small','',date(x.startedAt))),el('strong','',x.setsWon.ours+':'+x.setsWon.theirs)))));
 root.replaceChildren(...parts);
}
try{
 const q=new URLSearchParams(location.search),url=portalAddress(q.get('db'),q.get('owner'),q.get('team'));
 const stream=new EventSource(url);
 stream.onopen=()=>{connected=true;problem='';draw();};
 stream.addEventListener('put',e=>{try{const payload=JSON.parse(e.data);if(payload.path!=='/')throw Error('partial');data=readPortal(payload.data);received=true;connected=true;draw();}catch{void reload(url);}});
 stream.addEventListener('patch',()=>void reload(url));
 stream.onerror=()=>{connected=false;problem='Не удалось подключиться. Проверьте ссылку или интернет.';draw();};
 stream.addEventListener('cancel',()=>{stream.close();connected=false;data=null;received=true;problem='Страница недоступна';draw();});
 stream.addEventListener('auth_revoked',()=>{stream.close();connected=false;data=null;received=true;problem='Доступ отозван';draw();});
 let fetching=false;async function reload(url){if(fetching)return;fetching=true;try{const r=await fetch(url,{cache:'no-store',referrerPolicy:'no-referrer'});if(!r.ok)throw Error();data=readPortal(await r.json());received=true;draw();}catch{}finally{fetching=false;}}
 window.addEventListener('pagehide',()=>stream.close(),{once:true});
 setInterval(()=>{if(!data)return;const state=portalState(data),stale=['live','break'].includes(state.mode)&&Date.now()-data.updatedAt>90000;if(state.mode!==lastMode||stale!==lastStale){draw();return;}if(state.mode==='upcoming')root.querySelectorAll('.clock strong').forEach((n,i)=>n.textContent=String(countdown(state.remaining)[i]).padStart(2,'0'));},1000);
}catch{received=true;problem='Откройте постоянную ссылку, которую отправил тренер.';draw();}
