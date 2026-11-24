import {el,toast,icon,closeSheet} from '../ui.js';
import {portalInfo,portalLink} from '../public-publisher.js';
import {competitionOverview} from '../competition-center.js';
import {openPublicPortal} from './public-portal.js';
import {openMatchCenter} from './volleyball.js';
const btn=(text,onclick,kind='')=>el('button',{class:'btn '+kind,type:'button',text,onclick});
const fmt=t=>new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'}).format(t);
const labels={withdrawal:'Снятие публикации ожидает подтверждения',disabled:'Публикация выключена',login:'Для обновления счёта нужен вход',pending:'Ожидается синхронизация',connected:'Авторизация активна'};
export function competitionCard(team,data,refresh){
 const info=portalInfo(team.id),v=competitionOverview(team.id,data.coachLive,info),link=portalLink(team.id);
 const back=()=>{closeSheet();refresh();};
 const primary=v.drafts[0],next=v.next;
 const card=el('section',{class:'card-block competition-card'},[
  el('div',{class:'competition-header'},[el('span',{class:'metric-icon'},[icon('trophy')]),el('div',{},[el('h2',{text:'Центр соревнований'}),el('small',{text:'Матчи и зрительская страница'})]),el('span',{class:'competition-state','data-mode':v.mode,text:labels[v.mode]})]),
  primary?el('div',{class:'competition-feature'},[el('small',{text:'Сохранённый матч'}),el('strong',{text:primary.opponent}),el('span',{text:primary.valid?primary.score.ours+' : '+primary.score.theirs:'Требуется проверка черновика'}),btn('Продолжить матч',()=>openMatchCenter(team,refresh,{draftId:primary.id}),'primary wide')]):null,
  next?el('div',{class:'competition-feature'},[el('small',{text:'Ближайшая встреча'}),el('strong',{text:team.name+' — '+next.opponent}),el('span',{text:fmt(next.startAt)}),btn('Подготовка и расписание',()=>openMatchCenter(team,refresh),'wide')]):null,
  !primary&&!next?el('p',{text:'Нет сохранённых матчей и ближайших встреч.'}):null,
  v.overdue.length?el('p',{class:'competition-warning',text:'Проверьте прошедшие встречи в расписании: '+v.overdue.length}):null,
  el('div',{class:'competition-actions'},[btn('Публичная страница',()=>openPublicPortal(team,back),'wide'),link?btn('Копировать ссылку',async()=>{try{await navigator.clipboard.writeText(link);toast('Ссылка скопирована');}catch{toast('Откройте публичную страницу для копирования ссылки');}},'wide'):null]),
  link?el('a',{class:'competition-link',href:link,target:'_blank',rel:'noopener noreferrer',text:'Открыть страницу зрителя ↗'}):null
 ]);
 return card;
}
