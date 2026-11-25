import {platformClient,isLocalPlatformPage} from '../js/platform-client.js';
const root=document.querySelector('#app'),roles={owner:'Владелец',coach:'Тренер',assistant:'Помощник',athlete:'Спортсменка'};
const e=(tag,text='',attrs={},children=[])=>{const n=document.createElement(tag);n.textContent=text;for(const [k,v] of Object.entries(attrs)){if(k==='class')n.className=v;else if(k==='type')n.type=v;else n.setAttribute(k,String(v));}for(const child of children)if(child)n.append(child);return n;};
const p=(text,cls='muted')=>e('p',text,{class:cls});
const box=(title,...children)=>e('section','',{class:'card'},[e('h2',title),...children]);
const field=(label,node)=>e('label',label,{},[node]);
const input=(name,value='',type='text')=>{const n=e('input','',{type,'aria-label':name,autocomplete:'off'});n.value=value;return n;};
const select=(name,options)=>e('select','',{'aria-label':name},options.map(([value,label])=>e('option',label,{value})));
const area=(name,value='')=>{const n=e('textarea','',{'aria-label':name});n.value=value;return n;};
const row=(...children)=>e('div','',{class:'row'},children);
const button=(title,fn,primary=false)=>{const b=e('button',title,{type:'button',class:primary?'primary':''});b.onclick=fn;return b;};
const json=v=>JSON.stringify(v,null,2);
let api=null,member=null,serial=0,busy=false,scoreTimer=null,active=null,pending=null;
const stopTimer=()=>{if(scoreTimer)clearInterval(scoreTimer);scoreTimer=null;};
function close(){serial++;stopTimer();api?.close();api=null;member=null;active=null;pending=null;busy=false;login();}
function status(text,error=false){const n=root.querySelector('#status');if(n){n.textContent=text;n.className=error?'status error':'status';}}
async function run(fn){if(busy)return;busy=true;const epoch=serial;try{await fn(epoch);if(epoch===serial)status('Готово');}catch(err){if(epoch===serial){status(err.message,true);if(err.status===401&&api){close();status('Сессия недействительна или отозвана. Войдите заново.',true);}}}finally{if(epoch===serial)busy=false;}}
function login(){
 if(!isLocalPlatformPage()){root.replaceChildren(box('Недоступно',p('Кабинеты LAB запускаются только локально. Рабочие данные не принимаются.')));return;}
 const endpoint=input('Адрес тестового Worker','http://127.0.0.1:8788'),workspace=input('ID пространства','demo'),secret=input('Секретный код','','password'),name=input('Название пространства','Синтетическая команда');
 const form=box('Подключение',p('Секрет хранится только до выхода или перезагрузки вкладки. Не вводите реальные ключи и персональные данные.'),e('div','',{class:'fields'},[field('Worker',endpoint),field('Пространство',workspace),field('Секрет / приглашение',secret),field('Название (для первого запуска)',name),button('Войти',()=>connect('login'),true),button('Активировать приглашение',()=>connect('redeem')),button('Создать тестовое пространство',()=>connect('bootstrap'))]));
 root.replaceChildren(form,e('p','',{id:'status',role:'status',class:'status'}));
 async function connect(mode){await run(async(epoch)=>{const temp=platformClient(endpoint.value,workspace.value,secret.value);let result,issued=null;try{
  if(mode==='login'){result=await temp.request('me');if(epoch!==serial){temp.close();return;}api=temp;}
  else{issued=await temp.request(mode,'POST',mode==='bootstrap'?{name:name.value.trim()}:{});temp.close();if(epoch!==serial)return;api=platformClient(endpoint.value,workspace.value,issued.token);result=await api.request('me');}
  if(epoch!==serial)return;member=result.member;secret.value='';await render(result.name,issued?.token);
 }catch(err){temp.close();if(mode!=='login')api?.close();throw err;}});}
}
function showSecret(title,value){const n=input(title,value,'password');n.readOnly=true;n.className='secret';return box(title,p('Показывается только сейчас. Храните тестовый код отдельно; не отправляйте его через общие каналы.'),n,row(button('Показать / скрыть',()=>{n.type=n.type==='password'?'text':'password';}),button('Скрыть код',()=>{n.value='';n.closest('.card').remove();}))); }
async function render(name,issued){
 stopTimer();root.replaceChildren(box(name,p(roles[member.role]||member.role),button('Выйти',close)),e('p','',{id:'status',role:'status',class:'status'}));
 if(issued)root.append(showSecret('Код новой сессии',issued));
 if(member.role==='athlete'){const section=box('Мой кабинет',p('Доступ только к собственным заданиям и расписанию.'));root.append(section);await athlete(section);return;}
 const grid=e('div','',{class:'grid'});root.append(grid);
 if(member.role==='owner'){grid.append(ownerTeams(),ownerInvites());}
 if(['owner','coach'].includes(member.role))grid.append(coachProfile(),newMatch());
 if(['owner','coach','assistant'].includes(member.role))grid.append(rosterCard(),liveCard());
}
function ownerTeams(){
 const tid=input('ID команды'),name=input('Название команды'),players=area('Игроки: id;номер;имя','p1;1;Тестовая спортсменка\np2;2;Тестовая спортсменка 2'),result=e('div');
 return box('Создать команду',e('div','',{class:'fields'},[field('ID',tid),field('Название',name),field('Состав: ID;номер;имя',players),button('Создать команду',()=>run(async()=>{const parsed=players.value.split(/\r?\n/).filter(x=>x.trim()).map(line=>{const [id,number,...rest]=line.split(';');return {id:id.trim(),number:Number(number),name:rest.join(';').trim()};});const res=await api.request('teams','POST',{id:tid.value.trim(),name:name.value.trim(),players:parsed});result.replaceChildren(p('Создана: '+res.team.name));}),true),result]));
}
function ownerInvites(){
 const role=select('Роль приглашения',[['coach','Тренер'],['assistant','Помощник'],['athlete','Спортсменка']]),team=input('ID команды приглашения'),ath=input('ID спортсменки'),match=input('ID матча приглашения'),out=e('div'),members=e('div'),invites=e('div'),audit=e('div');
 const refreshInvites=async()=>{const res=await api.request('invites');invites.replaceChildren(...res.invites.map(i=>e('div','',{class:'entry'},[p((roles[i.role]||i.role)+' · '+i.teamId+' · до '+new Date(i.expiresAt).toLocaleTimeString('ru-RU')),button('Отменить приглашение',()=>run(async()=>{if(!confirm('Отменить неиспользованное приглашение?'))return;await api.request('invites/cancel','POST',{inviteId:i.id});out.replaceChildren();await refreshInvites();}))])),...(!res.invites.length?[p('Нет активных приглашений')]:[]));};
 const refresh=async()=>{const res=await api.request('members');members.replaceChildren(...res.members.map(m=>e('div','',{class:'entry'},[p((roles[m.role]||m.role)+' · '+m.id+' · '+(m.revokedAt!==null?'Отозван':'Активен')),m.role==='owner'||m.revokedAt!==null?null:button('Отозвать '+m.id,()=>run(async()=>{if(!confirm('Отозвать тестовый доступ?'))return;await api.request('revoke','POST',{memberId:m.id});await refresh();}))])));};
 return box('Приглашения и доступ',e('div','',{class:'fields'},[field('Роль',role),field('Команда',team),field('Спортсменка (для личного кабинета)',ath),field('Матч (для помощника)',match),button('Создать приглашение',()=>run(async()=>{const res=await api.request('invite','POST',{role:role.value,teamId:team.value.trim(),athleteId:role.value==='athlete'?ath.value.trim():null,matchId:role.value==='assistant'?match.value.trim():null});out.replaceChildren(showSecret('Одноразовое приглашение',res.invite));await refreshInvites();}),true),out,button('Активные приглашения',()=>run(refreshInvites)),invites,button('Участники',()=>run(refresh)),members,button('Журнал доступа',()=>run(async()=>{const res=await api.request('audit');audit.replaceChildren(...res.events.slice(0,20).map(x=>p(new Date(x.at).toLocaleTimeString('ru-RU')+' · '+x.action+' · '+x.target)));})),audit]));
}
function rosterCard(){
 const team=input('Команда для просмотра',member.teamId||''),list=e('div'),teams=e('div');return box('Состав команды',field('ID команды',team),button('Мои команды',()=>run(async()=>{const res=await api.request('teams');teams.replaceChildren(...res.teams.map(t=>button(t.name,()=>{team.value=t.id;})));})),teams,button('Получить состав',()=>run(async()=>{const res=await api.request('teams/'+team.value.trim()+'/roster');list.replaceChildren(e('h3',res.team.name),...res.team.players.map(x=>p('№'+x.number+' · '+x.name+' · '+x.id)));})),list);
}
function coachProfile(){
 const team=input('Команда профиля',member.teamId||''),ath=input('Спортсменка профиля'),data=e('div'),goals=area('Цели JSON','[]'),assignments=area('Задания JSON','[]'),schedule=area('Расписание JSON','[]');let revision=null,path='';
 const getPath=()=> 'teams/'+team.value.trim()+'/athletes/'+ath.value.trim();
 const load=async()=>{path=getPath();const res=await api.request(path);revision=res.revision;goals.value=json(res.record.goals);assignments.value=json(res.record.assignments);schedule.value=json(res.record.schedule);data.replaceChildren(p('Ревизия '+revision),...res.responses.map(r=>p(r.assignmentId+' · '+r.response)));};
 return box('Профиль спортсменки',p('Только синтетические цели, задания и расписание. Загрузите текущую ревизию перед изменением.'),e('div','',{class:'fields'},[field('Команда',team),field('ID спортсменки',ath),button('Получить профиль',()=>run(load)),field('Цели (JSON)',goals),field('Задания (JSON)',assignments),field('Расписание (JSON)',schedule),button('Сохранить профиль',()=>run(async()=>{if(revision===null||path!==getPath())throw Error('Сначала получите профиль');const body={expectedRevision:revision,goals:JSON.parse(goals.value),assignments:JSON.parse(assignments.value),schedule:JSON.parse(schedule.value)};await api.request(path,'PUT',body);await load();}),true),data]));
}
async function athlete(section){
 const epoch=serial,path='teams/'+member.teamId+'/athletes/'+member.athleteId,res=await api.request(path);if(epoch!==serial)return;
 const labels={seen:'Ознакомилась',ready:'Готово к проверке',question:'Нужен вопрос тренеру'},status={active:'В работе',done:'Выполнено',paused:'Пауза',open:'Открыто',review:'На проверке'};
 section.replaceChildren(e('h2','Мой кабинет'),button('Обновить',()=>run(()=>athlete(section))),e('h3','Расписание'),...res.record.schedule.map(s=>p(s.date+' · '+s.time+' · '+s.title)),...(!res.record.schedule.length?[p('Нет занятий')]:[]),e('h3','Цели'),...res.record.goals.map(g=>e('div','',{class:'entry'},[e('strong',g.name),p(status[g.status]+' · до '+g.to)])),...(!res.record.goals.length?[p('Нет целей')]:[]),e('h3','Задания'),...res.record.assignments.map(a=>{const reply=res.responses.find(r=>r.assignmentId===a.id);return e('div','',{class:'entry'},[e('strong',a.name),p(status[a.status]+' · до '+a.due),reply?p('Мой ответ: '+labels[reply.response]):null,a.status==='open'?row(...Object.entries(labels).map(([response,label])=>button(label,()=>run(async()=>{await api.request(path+'/respond','POST',{assignmentId:a.id,response,expectedRevision:res.revision});await athlete(section);})))):null]);}),...(!res.record.assignments.length?[p('Нет заданий')]:[]));
}
function newMatch(){
 const id=input('ID нового матча'),team=input('Команда нового матча',member.teamId||''),opponent=input('Соперник'),best=select('Формат матча',[[3,'До 2 побед'],[5,'До 3 побед']]),target=select('Очков в партии',[[25,'25'],[21,'21'],[15,'15']]),decider=select('Решающая партия',[[15,'15'],[21,'21'],[25,'25']]);
 return box('Создать серверный матч',e('div','',{class:'fields'},[field('ID',id),field('Команда',team),field('Соперник',opponent),field('Формат',best),field('Партия',target),field('Решающая',decider),button('Создать матч',()=>run(()=>api.request('matches','POST',{id:id.value.trim(),teamId:team.value.trim(),opponent:opponent.value.trim(),bestOf:Number(best.value),target:Number(target.value),decider:Number(decider.value)})),true)]));
}
function liveCard(){
 const selector=input('ID матча LIVE',member.matchIds?.[0]||''),matches=e('div'),body=e('div');
 const path=()=> 'matches/'+selector.value.trim(),same=()=>active?.id===selector.value.trim();
 const load=async()=>{stopTimer();const requested=selector.value.trim();const res=await api.request(path());if(requested!==selector.value.trim())return;active=res.match;draw();};
 selector.oninput=()=>{stopTimer();active=null;body.replaceChildren(p('Откройте выбранный матч.'));};
 const modify=async(op,packet)=>{if(!same())throw Error('Сначала откройте матч');const res=await api.request(path()+'/'+op,'POST',packet);active=res.match;draw();};
 const op=async(action,side)=>{if(!same()||active.lease?.holderId!==member.id)throw Error('Сначала получите право управления');if(pending)throw Error('Сначала повторите или отмените неподтверждённый запрос');pending={matchId:active.id,action,body:{generation:active.generation,expectedRevision:active.revision,opId:crypto.randomUUID(),...(side?{side}:{})}};await retry();};
 async function retry(){if(!pending||pending.matchId!==selector.value.trim())throw Error('Нет запроса для этого матча');try{await modify(pending.action,pending.body);pending=null;draw();}catch(err){if(err.status>=400&&err.status<500)pending=null;draw();throw err;}}
 function draw(){
  stopTimer();if(!active)return;const own=active.lease?.holderId===member.id&&active.lease.until>Date.now()&&active.status==='live';
  body.replaceChildren(e('h3',active.opponent),e('div',active.score.ours+' : '+active.score.theirs,{class:'score','aria-label':'Счёт'}),p('Партия '+active.set+' · ревизия '+active.revision+' · '+(active.status==='finished'?'Завершён':active.lease&&active.lease.until>Date.now()?own?'Управление у вас':'Другой участник управляет':'Свободно')),row(button('Обновить счёт',()=>run(load)),button('Получить управление',()=>run(()=>modify('acquire',{expectedRevision:active.revision})),true)),own?row(button('+ Наши',()=>run(()=>op('score','ours')),true),button('+ Соперник',()=>run(()=>op('score','theirs')),true)):null,own?row(button('Следующая партия',()=>run(()=>op('next'))),member.role!=='assistant'?button('Завершить матч',()=>run(()=>op('finish'))):null,button('Передать управление',()=>run(async()=>{if(pending)throw Error('Сначала подтвердите результат предыдущей операции');await modify('release',{generation:active.generation});}))):null,pending?row(button('Повторить последний запрос',()=>run(retry)),button('Отменить повтор',()=>{pending=null;void run(load);})):null);
  // Lease lives only in the foreground. Revocation or network failure ends renewals.
  if(own)scoreTimer=setInterval(()=>{if(document.visibilityState!=='visible'||busy||!same()||pending)return;void run(()=>modify('renew',{generation:active.generation}));},15000);
 }
 return box('Серверный LIVE · тест',p('Право вести счёт выдаётся на 45 секунд. Не связано с опубликованной страницей Firebase.'),field('ID матча',selector),button('Доступные матчи',()=>run(async()=>{const res=await api.request('matches');matches.replaceChildren(...res.matches.map(m=>button(m.opponent+' · '+m.id,()=>{selector.value=m.id;void run(load);})));})),matches,button('Открыть LIVE',()=>run(load)),body);
}
login();
