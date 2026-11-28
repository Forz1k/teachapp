import {platformClient,platformIdentityClient,platformCandidateClient,platformCandidateIdentityClient,isLocalPlatformPage} from '../js/platform-client.js';
import {candidateConfig} from '../platform-candidate/config.js';
import {inspectProviderPush,enableProviderPush,disableProviderPush} from '../platform-candidate/push-client.js';
const candidatePath=/\/platform-candidate\/(?:index\.html)?$/.test(location.pathname);
const candidatePage=location.protocol==='https:'&&location.origin===candidateConfig?.origin&&candidatePath&&!location.search&&!location.hash;
const ordinaryClient=(address,workspace,secret)=>candidatePage?platformCandidateClient(candidateConfig,workspace,secret):platformClient(address,workspace,secret);
const identityClient=(address,workspace,assertion)=>candidatePage?platformCandidateIdentityClient(candidateConfig,workspace,assertion):platformIdentityClient(address,workspace,assertion);
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
let api=null,connecting=null,member=null,sessionAddress=null,sessionSpace=null,serial=0,busy=false,scoreTimer=null,active=null,pending=null;
const stopTimer=()=>{if(scoreTimer)clearInterval(scoreTimer);scoreTimer=null;};
function close(){serial++;stopTimer();connecting?.close();connecting=null;api?.close();api=null;member=null;sessionAddress=null;sessionSpace=null;active=null;pending=null;busy=false;login();}
function status(text,error=false){const n=root.querySelector('#status');if(n){n.textContent=text;n.className=error?'status error':'status';}}
async function run(fn){if(busy)return;busy=true;const epoch=serial;try{await fn(epoch);if(epoch===serial)status('Готово');}catch(err){if(epoch===serial){status(err.message,true);if(err.status===401&&api){close();status('Сессия недействительна или отозвана. Войдите заново.',true);}}}finally{if(epoch===serial)busy=false;}}
function login(){
 if(!candidatePage&&(candidatePath||!isLocalPlatformPage())){root.replaceChildren(box('Недоступно',p('Кабинеты LAB запускаются только локально. Рабочие данные не принимаются.')));return;}
 const endpoint=input('Адрес тестового Worker','http://127.0.0.1:8788'),workspace=input('ID пространства','demo'),secret=input('Секретный код','','password'),name=input('Название пространства','Синтетическая команда');
 if(candidatePage){endpoint.value=candidateConfig.apiOrigin;endpoint.readOnly=true;}
 const assertion=input(candidatePage?'Подписанный access-токен':'Подписанный access-токен LAB','','password');
 const form=candidatePage?box('Подключение',p('Отдельный HTTPS-кандидат. Для каждого успешного входа нужен новый подписанный access-токен утверждённого поставщика. После неопределённого результата не повторяйте обмен тем же токеном. До приёмки — только синтетические данные.'),field('API',endpoint),field('Пространство',workspace),field('Код приглашения / восстановления / оператора',secret),field('Название (первый запуск)',name),field('Access-токен',assertion),row(button('Войти через identity',()=>connect('identity/session'),true),button('Принять приглашение через identity',()=>connect('identity/redeem')),button('Создать пространство',()=>connect('identity/bootstrap')),button('Восстановить владельца',()=>connect('identity/recover')))):box('Подключение',p('Секрет хранится только до выхода, закрытия или приостановки страницы. Не вводите реальные ключи и персональные данные.'),e('div','',{class:'fields'},[field('Worker',endpoint),field('Пространство',workspace),field('Секрет / приглашение',secret),field('Название (для первого запуска)',name),button('Войти',()=>connect('login'),true),button('Активировать приглашение',()=>connect('redeem')),button('Восстановить владельца',()=>connect('recover')),button('Создать тестовое пространство',()=>connect('bootstrap'))]),p('Внешняя identity · только синтетический подписанный access-токен. Код приглашения или текущей сессии нужен для первой привязки.'),field('Access-токен',assertion),row(button('Войти через identity',()=>connect('identity/session')),button('Привязать текущую сессию',()=>connect('identity/bind')),button('Принять приглашение через identity',()=>connect('identity/redeem'))));
 root.replaceChildren(form,e('p','',{id:'status',role:'status',class:'status'}));
 async function connect(mode){await run(async(epoch)=>{
  const address=endpoint.value,space=workspace.value,workspaceName=name.value.trim();
  const identity=mode.startsWith('identity/'),credential=secret.value,signed=assertion.value;
  secret.value='';assertion.value='';
  const temp=identity?identityClient(address,space,signed):ordinaryClient(address,space,credential);connecting=temp;
  let result,issued=null;try{
   if(mode==='login'){result=await temp.request('me');if(epoch!==serial){temp.close();return;}api=temp;}
   else{issued=await temp.request(mode,'POST',mode==='bootstrap'?{name:workspaceName}:mode==='identity/bootstrap'?{credential,name:workspaceName}:['identity/bind','identity/redeem','identity/recover'].includes(mode)?{credential}:{});temp.close();if(epoch!==serial)return;api=ordinaryClient(address,space,issued.token);result=await api.request('me');}
   if(epoch!==serial)return;member=result.member;sessionAddress=address;sessionSpace=space;await render(result.name,candidatePage?null:issued?.token);
  }catch(err){temp.close();if(epoch===serial){api?.close();api=null;member=null;}throw err;}
  finally{if(connecting===temp)connecting=null;}
 });}
}
function showSecret(title,value){const n=input(title,value,'password');n.readOnly=true;n.className='secret';return box(title,p('Показывается только сейчас. Храните тестовый код отдельно; не отправляйте его через общие каналы.'),n,row(button('Показать / скрыть',()=>{n.type=n.type==='password'?'text':'password';}),button('Скрыть код',()=>{n.value='';n.closest('.card').remove();}))); }
async function rotateSession(epoch,name){
 if(!confirm('Сменить код сессии? Старый код и неиспользованные приглашения перестанут действовать. Управление LIVE будет освобождено, подписка отключена. Сохраните новый код отдельно.'))return;
 if(pending)throw Error('Сначала сверяйте неподтверждённую операцию LIVE.');
 const old=api,address=sessionAddress,space=sessionSpace,expected=member;
 stopTimer();
 try{
  const rotated=await old.request('session/rotate','POST',{});
  if(epoch!==serial||api!==old)return;
  if(rotated.workspaceId!==space||rotated.member?.id!==expected.id||rotated.member?.role!==expected.role||rotated.member?.expiresAt!==expected.expiresAt)throw Error('Неожиданный ответ сервера');
  const replacement=ordinaryClient(address,space,rotated.token);
  old.close();api=replacement;member=rotated.member;active=null;pending=null;
  await render(name,candidatePage?null:rotated.token);
 }catch(err){
  if(epoch!==serial||api!==old)return;
  // An ambiguous response may have committed rotation. Never replay it.
  if(err.status===409||err.status===429){active=null;pending=null;await render(name);throw err;}
  close();status('Результат смены кода неизвестен или сессия недействительна. Восстановите владельца или запросите новое приглашение.',true);
 }
}
async function render(name,issued){
 stopTimer();root.replaceChildren(box(name,p(roles[member.role]||member.role),button('Выйти',close),button('Сменить код сессии',()=>run(epoch=>rotateSession(epoch,name))),button('Отозвать эту сессию',()=>run(async()=>{if(!confirm('Отозвать код этой сессии на сервере? Для нового входа понадобится приглашение или код восстановления владельца.'))return;await api.request('session/revoke','POST',{});close();status('Сессия отозвана на сервере.');}))),e('p','',{id:'status',role:'status',class:'status'}));
 if(issued)root.append(showSecret('Код новой сессии',issued));
 if(candidatePage&&member.role==='athlete')root.append(providerPushCard());
 if(!candidatePage&&['owner','coach','athlete'].includes(member.role))root.append(notificationCard());
 if(member.role==='athlete'){const section=box('Мой кабинет',p('Доступ только к собственным заданиям и расписанию.'));root.append(inboxCard(),section);await athlete(section);return;}
 const grid=e('div','',{class:'grid'});root.append(grid);
 if(member.role==='owner'){grid.append(ownerTeams(),ownerInvites(),ownerRecovery());}
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
 const refresh=async()=>{const res=await api.request('members');members.replaceChildren(...res.members.map(m=>e('div','',{class:'entry'},[p((roles[m.role]||m.role)+' · '+m.id+' · '+(m.revokedAt!==null?'Отозван':m.expiresAt<=Date.now()?'Истёк':'Активен')),m.role==='owner'||m.revokedAt!==null?null:button('Отозвать '+m.id,()=>run(async()=>{if(!confirm('Отозвать тестовый доступ?'))return;await api.request('revoke','POST',{memberId:m.id});await refresh();}))])));};
 return box('Приглашения и доступ',e('div','',{class:'fields'},[field('Роль',role),field('Команда',team),field('Спортсменка (для личного кабинета)',ath),field('Матч (для помощника)',match),button('Создать приглашение',()=>run(async()=>{const res=await api.request('invite','POST',{role:role.value,teamId:team.value.trim(),athleteId:role.value==='athlete'?ath.value.trim():null,matchId:role.value==='assistant'?match.value.trim():null});out.replaceChildren(showSecret('Одноразовое приглашение',res.invite));await refreshInvites();}),true),out,button('Активные приглашения',()=>run(refreshInvites)),invites,button('Участники',()=>run(refresh)),members,button('Очистить неактивные сессии',()=>run(async()=>{const {members:inactive}=await api.request('members/prunable');if(!inactive.length){members.replaceChildren(p('Нет истёкших или отозванных сессий'));return;}if(!confirm('Удалить '+inactive.length+' неактивных сессий? Матчи, профили и записи аудита сохранятся.'))return;await api.request('members/prune','POST',{memberIds:inactive.map(m=>m.id)});await refresh();})),button('Журнал доступа',()=>run(async()=>{const res=await api.request('audit');audit.replaceChildren(...res.events.slice(0,20).map(x=>p(new Date(x.at).toLocaleTimeString('ru-RU')+' · '+x.action+' · '+x.target)));})),audit]));
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
 const modify=async(op,packet)=>{if(!same())throw Error('Сначала откройте матч');const requested=selector.value.trim(),epoch=serial;const res=await api.request(path()+'/'+op,'POST',packet);if(epoch!==serial||requested!==selector.value.trim())return;active=res.match;draw();};
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
// No credentials or stale cabinet survive page suspension/BFCache. Local logout
// does not revoke a server token or undo an already accepted request.
window.addEventListener('pagehide',close);
document.addEventListener('freeze',close);

function ownerRecovery(){
 const state=e('p','Код восстановления не загружен'),key=input('Новый код восстановления','','password');key.readOnly=true;const copy=button('Показать / скрыть',()=>{key.type=key.type==='password'?'text':'password';});let version=null;
 const refresh=async()=>{const res=await api.request('owner/recovery');version=res.version;state.textContent=res.configured?'Восстановление настроено · версия '+version:'Код восстановления не настроен';};
 const generate=button('Создать новый код',()=>run(async()=>{await refresh();key.value=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');key.type='text';}));
 const save=button('Активировать сохранённый код',()=>run(async(epoch)=>{const session=api;if(!/^[a-f0-9]{64}$/.test(key.value)||version===null)throw Error('Сначала создайте и сохраните новый код');if(!confirm('Вы сохранили новый код отдельно? Старый код перестанет действовать.'))return;const recoveryHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key.value))),b=>b.toString(16).padStart(2,'0')).join('');if(epoch!==serial||api!==session)return;const res=await session.request('owner/recovery','POST',{recoveryHash,expectedVersion:version});key.value='';version=res.version;state.textContent='Восстановление настроено · версия '+version;}),true);
 return box('Восстановление владельца · LAB',p('Сохраните случайный код отдельно до активации. Не отправляйте его третьим лицам. Восстановление отзывает прежние сессии владельца и неиспользованные приглашения. Не использовать рабочие данные.'),state,button('Проверить статус',()=>run(refresh)),generate,key,copy,save);
}

function providerPushCard(){
 const info=p('Проверьте состояние устройства и сервера. Разрешение не запрашивается автоматически.');
 const perform=(operation)=>run(async(epoch)=>{
  const session=api,active=()=>epoch===serial&&api===session&&info.isConnected;
  try{await operation(session,active);if(!active())return;const v=await inspectProviderPush(session);if(active())info.textContent='Сервер: '+(v.server.enabled?'включён':'выключен')+' · браузер: '+(v.subscribed?'подписан':'не подписан')+' · локальное согласие: '+(v.local?'да':'нет');}
  catch(err){if(active())info.textContent='Требуется проверка состояния. '+err.message;throw err;}
 });
 return box('Фоновые уведомления · кандидат',p('Общий сигнал без данных спортсменки. Разрешение требуется явно. Выход из кабинета не отменяет подписку; для отмены используйте кнопку ниже.'),info,button('Проверить подписку',()=>perform(async()=>{})),button('Включить push на этом устройстве',()=>{if(confirm('Разрешить общие фоновые уведомления на этом устройстве?'))void perform((session,active)=>enableProviderPush(session,{active}));}),button('Отключить push на этом устройстве',()=>{if(confirm('Отключить подписку и локальное согласие?'))void perform((session,active)=>disableProviderPush(session,{active}));}));
}
function notificationCard(){
 const info=p('Загрузите состояние подписки. Реальные уведомления не отправляются.');
 let state=null;const enable=button('Включить тестовую подписку',()=>run(()=>change(true))),disable=button('Отключить тестовую подписку',()=>run(()=>change(false)));
 const draw=()=>{enable.disabled=!state||state.enabled;disable.disabled=!state||!state.enabled;info.textContent=state?(state.enabled?'Тестовая подписка включена':'Тестовая подписка выключена')+' · ревизия '+state.revision:'Загрузите состояние подписки заново.';};
 const load=async()=>{state=await api.request('notification-lab');draw();};
 async function change(enabled){
  if(!state||state.enabled===enabled)return;
  const previous=state;state=null;draw();
  try{state=await api.request('notification-lab','PUT',{expectedRevision:previous.revision,enabled,endpoint:enabled?'https://push.example.invalid/sub/'+crypto.randomUUID():null});}
  finally{draw();}
 }
 draw();
 return box('Уведомления · LAB',p('Только синтетическая подписка этой сессии. Не запрашивает разрешение браузера, не регистрирует PushManager и не доставляет сообщения. Выход из кабинета не отзывает серверную сессию.'),info,button('Проверить подписку',()=>run(load)),row(enable,disable));
}

function inboxCard(){
 const info=e('p','Проверьте новые сигналы.',{role:'status'});
 let state=null;
 const clear=()=>{state=null;ack.disabled=true;info.textContent='Проверьте новые сигналы.';};
 const show=result=>{
  if(!result||typeof result.pending!=='boolean'||!Number.isSafeInteger(result.revision)||result.revision<0||!Number.isSafeInteger(result.sequence)||result.sequence<0||result.pending&&(result.sequence===0||!Number.isFinite(result.expiresAt)))throw Error('Неверный ответ очереди LAB');
  state=result;ack.disabled=!result.pending;
  // Never render server-provided notification text, endpoint or profile data.
  info.textContent=result.pending?'В личном кабинете есть обновления.':'Новых сигналов нет.';
 };
 const refresh=button('Проверить новые сигналы',()=>run(async(epoch)=>{
  const session=api;clear();const res=await session.request(candidatePage?'notification/provider/inbox':'notification-lab/inbox');
  if(epoch===serial&&api===session&&info.isConnected)show(res);
 }));
 const ack=button('Подтвердить просмотр сигнала',()=>run(async(epoch)=>{
  if(!state?.pending)return;
  const session=api,{revision,sequence}=state;clear();
  try{const res=await session.request(candidatePage?'notification/provider/ack':'notification-lab/ack','POST',{expectedRevision:revision,sequence});if(epoch===serial&&api===session&&info.isConnected)show(res);}
  catch(err){if(epoch===serial&&api===session&&info.isConnected&&err.status===409)info.textContent='Сигнал изменился или истёк. Проверьте снова.';throw err;}
 }));
 ack.disabled=true;
 return box(candidatePage?'Входящие сигналы':'Входящие сигналы · LAB',p(candidatePage?'Ручное подтверждение общего сигнала отдельно от доставки и выполнения задания.':'Ручная проверка и подтверждение общего сигнала. Не означает, что задания выполнены или прочитаны. Нет фоновой доставки.'),info,row(refresh,ack));
}
