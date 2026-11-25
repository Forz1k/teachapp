import * as db from './db.js';
import {uid} from './model.js';
import {validPeriod} from './health.js';
import {only,txt,opt,require} from './workbench.js';
export const systems={league:'Круговой турнир',knockout:'На выбывание',groups:'Две группы + плей-офф'};
export const formats={volleyball:'Волейбол (по партиям)',score:'Игровой счёт'};
const integer=(n,max=999)=>Number.isInteger(n)&&n>=0&&n<=max;
const timeOK=t=>t===''||typeof t==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
function pairList(teams,system){
 if(system==='league'){
  const ring=teams.map(t=>t.id);if(ring.length%2)ring.push(null);
  const list=[];
  for(let r=1;r<ring.length;r++){
   for(let i=0;i<ring.length/2;i++){const a=ring[i],b=ring[ring.length-1-i];if(a&&b)list.push({id:'r'+r+'m'+(i+1),round:r,a,b});}
   ring.splice(1,0,ring.pop());
  }return list;
 }
 let size=2;while(size<teams.length)size*=2;
 let seed=[1,2];while(seed.length<size){const n=seed.length*2+1;seed=seed.flatMap(x=>[x,n-x]);}
 const slots=seed.map(n=>teams[n-1]?.id??null),list=[];let previous=[];
 for(let r=1,n=size/2;n>=1;r++,n/=2){
  const current=[];
  for(let i=0;i<n;i++){const id='r'+r+'m'+(i+1);current.push(id);list.push(r===1?{id,round:r,a:slots[i*2],b:slots[i*2+1]}:{id,round:r,fromA:previous[i*2],fromB:previous[i*2+1]});}
  previous=current;
 }return list;
}
const groupTeams=(t,n)=>t.teams.filter((_,i)=>i%2===n);
function groupFixtures(t,n){return pairList(groupTeams(t,n),'league').map(g=>({...g,id:'g'+(n+1)+'-'+g.id,group:n+1}));}
function fixtures(t){
 if(t.system!=='groups')return pairList(t.teams,t.system);
 const groups=[...groupFixtures(t,0),...groupFixtures(t,1)],round=Math.max(...groups.map(g=>g.round));
 return [...groups,{id:'semi1',round:round+1,playoff:true},{id:'semi2',round:round+1,playoff:true},{id:'final',round:round+2,playoff:true}];
}
export function validateResult(t,a,b,r){
 require(only(r,['aId','bId','a','b','sets'])&&r.aId===a&&r.bId===b&&integer(r.a)&&integer(r.b)&&Array.isArray(r.sets),'Результат не соответствует участникам');
 if(t.format==='score'){require(!r.sets.length&&(t.system==='league'||r.a!==r.b),'Ничья в матче на выбывание недопустима');return r;}
 const needed=(t.bestOf+1)/2;let x=0,y=0;
 require(r.sets.length>=needed&&r.sets.length<=t.bestOf,'Проверьте количество партий');
 for(const [i,s] of r.sets.entries()){
  const target=i===t.bestOf-1&&t.bestOf>1?t.decider:t.target;
  require(only(s,['a','b'])&&integer(s.a)&&integer(s.b)&&Math.max(s.a,s.b)>=target&&Math.abs(s.a-s.b)>=2&&Math.max(s.a,s.b)===Math.max(target,Math.min(s.a,s.b)+2)&&x<needed&&y<needed,'Некорректный счёт партии или матч уже завершён');
  x+=Number(s.a>s.b);y+=Number(s.b>s.a);
 }
 require((x===needed||y===needed)&&r.a===x&&r.b===y,'Матч не завершён или итог не совпадает с партиями');return r;
}
export function gamesOf(t){
 if(t.system==='groups')return groupedGames(t);
 const list=pairList(t.teams,t.system),winners=new Map(),result=[];
 for(const f of list){
  const prevA=f.fromA?winners.get(f.fromA):null,prevB=f.fromB?winners.get(f.fromB):null;
  const ready=!f.fromA||!!prevA?.ready&&!!prevB?.ready,a=f.fromA?prevA?.id??null:f.a,b=f.fromB?prevB?.id??null:f.b;
  const g=t.games[f.id]||{},bye=ready&&(!a||!b);
  let winner={ready:false,id:null};
  if(bye)winner={ready:true,id:a||b};
  if(g.result){require(ready&&!bye,'Матч ещё не имеет двух участников');validateResult(t,a,b,g.result);if(g.result.a!==g.result.b)winner={ready:true,id:g.result.a>g.result.b?a:b};}
  winners.set(f.id,winner);
  result.push({...f,a,b,ready,bye,winner:winner.id,date:g.date||'',time:g.time||'',venue:g.venue||'',referee:g.referee||'',result:g.result||null});
 }return result;
}
export function validateTournament(t){
 require(only(t,['id','kind','name','system','format','bestOf','target','decider','teams','games','revision','groupSeeds'])&&txt(t.id)&&t.kind==='tournament'&&txt(t.name)&&Object.hasOwn(systems,t.system)&&Object.hasOwn(formats,t.format)&&[1,3,5].includes(t.bestOf)&&Number.isInteger(t.target)&&t.target>=2&&t.target<=99&&Number.isInteger(t.decider)&&t.decider>=2&&t.decider<=99&&integer(t.revision,1000000)&&Array.isArray(t.teams)&&t.teams.length>=2&&t.teams.length<=32,'Проверьте параметры турнира');
 require(t.teams.every(x=>only(x,['id','name'])&&txt(x.id)&&txt(x.name))&&new Set(t.teams.map(x=>x.id)).size===t.teams.length&&new Set(t.teams.map(x=>x.name.toLowerCase())).size===t.teams.length,'Названия участников должны быть уникальны');
 require(t.system==='groups'?t.teams.length>=4:!Object.hasOwn(t,'groupSeeds'),'Групповой этап требует не менее четырёх участников');
 if(t.groupSeeds!==undefined){require(t.system==='groups'&&only(t.groupSeeds,['1','2'])&&Object.values(t.groupSeeds).every(ids=>Array.isArray(ids)&&ids.length===2&&new Set(ids).size===2&&ids.every(id=>t.teams.some(x=>x.id===id))),'Проверьте подтверждённые места групп');}
 const ids=fixtures(t).map(f=>f.id);
 require(only(t.games,ids)&&Object.keys(t.games).length===ids.length,'Повреждена сетка турнира');
 for(const g of Object.values(t.games))require(only(g,['date','time','venue','referee','result'])&&typeof g.date==='string'&&(!g.date||validPeriod(g.date,null))&&timeOK(g.time)&&(!g.time||g.date)&&opt(g.venue,200)&&(!Object.hasOwn(g,'referee')||opt(g.referee,200))&&Object.hasOwn(g,'result')&&(g.result===null||typeof g.result==='object'),'Проверьте расписание игр');
 gamesOf(t);return t;
}
export function makeTournament(input){
 require(Array.isArray(input.names)&&input.names.length>=2&&input.names.length<=32&&Object.hasOwn(systems,input.system),'Добавьте от 2 до 32 участников');
 const t={id:uid('tournament'),kind:'tournament',name:String(input.name||'').trim(),system:input.system,format:input.format,bestOf:input.bestOf,target:input.target,decider:input.decider,teams:input.names.map(name=>({id:uid('entry'),name:String(name).trim()})),games:{},revision:0};
 for(const f of fixtures(t))t.games[f.id]={date:'',time:'',venue:'',result:null};
 return validateTournament(t);
}
export async function createTournament(input){const t=makeTournament(input);await db.transaction(['workRecords'],'readwrite',s=>s.workRecords.add(t));return t;}
export function applyGame(t,id,patch){
 const next=structuredClone(t),g=gamesOf(next).find(g=>g.id===id);
 require(g&&Object.hasOwn(next.games,id)&&!g.bye,'Игра недоступна');
 const original=next.games[id],result=Object.hasOwn(patch,'result')?patch.result:original.result;
 if(result&&Object.hasOwn(patch,'result'))require(g.ready&&g.a&&g.b&&result.aId===g.a&&result.bId===g.b,'Участники игры изменились');
 next.games[id]={date:patch.date??original.date,time:patch.time??original.time,venue:patch.venue??original.venue,referee:patch.referee??original.referee??'',result};
 if(next.system==='groups'&&g.group&&Object.hasOwn(patch,'result')&&JSON.stringify(result)!==JSON.stringify(original.result)&&next.groupSeeds)delete next.groupSeeds[g.group];
 next.revision++;return validateTournament(next);
}
export async function saveGame(tournamentId,revision,gameId,patch){
 return db.transaction(['workRecords'],'readwrite',async s=>{
  const t=await s.workRecords.get(tournamentId);require(t?.kind==='tournament'&&t.revision===revision,'Турнир изменился. Откройте его заново');
  const next=applyGame(t,gameId,patch);await s.workRecords.put(next);return next;
 });
}
export function resultOf(t,g,values){
 require(g.ready&&!g.bye,'Участники ещё не определены');
 if(t.format==='score')return validateResult(g.group?{...t,system:'league'}:t,g.a,g.b,{aId:g.a,bId:g.b,a:values.a,b:values.b,sets:[]});
 const sets=values.sets.map(s=>({a:s.a,b:s.b}));
 return validateResult(t,g.a,g.b,{aId:g.a,bId:g.b,a:sets.filter(s=>s.a>s.b).length,b:sets.filter(s=>s.b>s.a).length,sets});
}
function rankRows(t,teams,games){
 const rows=new Map(teams.map(p=>[p.id,{...p,played:0,won:0,lost:0,draw:0,points:0,for:0,against:0,rallyFor:0,rallyAgainst:0}]));
 for(const g of games){if(!g.result)continue;const a=rows.get(g.a),b=rows.get(g.b),r=g.result;a.played++;b.played++;
  a.for+=r.a;a.against+=r.b;b.for+=r.b;b.against+=r.a;
  for(const s of r.sets){a.rallyFor+=s.a;a.rallyAgainst+=s.b;b.rallyFor+=s.b;b.rallyAgainst+=s.a;}
  if(r.a===r.b){a.draw++;b.draw++;a.points++;b.points++;continue;}
  const w=r.a>r.b?a:b,l=r.a>r.b?b:a;w.won++;l.lost++;
  if(t.format==='volleyball'&&t.bestOf>1&&Math.min(r.a,r.b)===(t.bestOf-1)/2){w.points+=2;l.points++;}
  else w.points+=3;
 }
 const sorted=[...rows.values()].sort((a,b)=>b.points-a.points||b.won-a.won||(b.for-b.against)-(a.for-a.against)||(b.rallyFor-b.rallyAgainst)-(a.rallyFor-a.rallyAgainst)||a.name.localeCompare(b.name,'ru'));
 const key=r=>[r.points,r.won,r.for-r.against,r.rallyFor-r.rallyAgainst].join('/');
 let previous='',place=0;return sorted.map((r,i)=>{if(key(r)!==previous){place=i+1;previous=key(r);}return {...r,place};});
}
function groupGames(t,n){
 const list=groupFixtures(t,n),v={...t,system:'league'};
 return list.map(g=>{const saved=t.games[g.id]||{};if(saved.result)validateResult(v,g.a,g.b,saved.result);return {...g,ready:true,bye:false,winner:saved.result?(saved.result.a>saved.result.b?g.a:saved.result.a<saved.result.b?g.b:null):null,date:saved.date||'',time:saved.time||'',venue:saved.venue||'',referee:saved.referee||'',result:saved.result||null};});
}
export function groupStandings(t){
 if(t.system!=='groups')return [];
 return [0,1].map(n=>{const games=groupGames(t,n),rows=rankRows(t,groupTeams(t,n),games),complete=games.every(g=>g.result!==null);
 const tied=rows.length>2&&rows[1].place===rows[2].place||rows[0].place===rows[1].place;
 const selected=t.groupSeeds?.[n+1];
 let seeds=null;
 if(complete&&selected){require(selected.every((id,i)=>rows.find(x=>x.id===id)?.place===rows[i].place),'Подтверждённые места не соответствуют результатам группы');seeds=selected;}
 else if(complete&&!tied)seeds=rows.slice(0,2).map(x=>x.id);
 return {group:n+1,games,rows,complete,tied,seeds};
 });
}
function groupedGames(t){
 const groups=groupStandings(t),[a,b]=groups.map(g=>g.seeds),list=fixtures(t).filter(g=>g.playoff),result=groups.flatMap(g=>g.games);
 result.sort((x,y)=>x.round-y.round||x.group-y.group||x.id.localeCompare(y.id));
 const playoff=(f,x,y)=>{const saved=t.games[f.id]||{},ready=!!x&&!!y;if(saved.result){require(ready,'Сначала определите участников плей-офф');validateResult(t,x,y,saved.result);}
 return {...f,a:x||null,b:y||null,ready,bye:false,winner:saved.result?(saved.result.a>saved.result.b?x:y):null,date:saved.date||'',time:saved.time||'',venue:saved.venue||'',referee:saved.referee||'',result:saved.result||null};};
 const s1=playoff(list[0],a?.[0],b?.[1]),s2=playoff(list[1],b?.[0],a?.[1]);return [...result,s1,s2,playoff(list[2],s1.winner,s2.winner)];
}
export function standings(t){return t.system==='groups'?groupStandings(t).flatMap(g=>g.rows.map(r=>({...r,group:g.group}))):rankRows(t,t.teams,gamesOf(t));}
export function applyGroupSeeds(t,group,ids){
 require(t.system==='groups'&&[1,2].includes(group)&&Array.isArray(ids)&&ids.length===2&&new Set(ids).size===2,'Выберите двух участников группы');
 const g=groupStandings(t).find(x=>x.group===group);require(g.complete,'Сначала завершите игры группы');
 const next=structuredClone(t);next.groupSeeds={...next.groupSeeds,[group]:ids};next.revision++;return validateTournament(next);
}
export async function saveGroupSeeds(id,revision,group,ids){return db.transaction(['workRecords'],'readwrite',async s=>{const t=await s.workRecords.get(id);require(t?.revision===revision,'Турнир изменился. Откройте его заново');const next=applyGroupSeeds(t,group,ids);await s.workRecords.put(next);return next;});}
export function tournamentChampion(t){if(!['knockout','groups'].includes(t.system))return null;const final=gamesOf(t).at(-1);return final?.winner?t.teams.find(p=>p.id===final.winner)||null:null;}
function csv(value){let s=String(value??'');if(/^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function tournamentCsv(t,type='games'){
 const name=id=>t.teams.find(p=>p.id===id)?.name||'';
 const rows=type==='standings'?[['Группа','Место','Команда','Игры','Победы','Ничьи','Поражения','Очки','За','Против'],...standings(t).map(r=>[r.group||'',r.place,r.name,r.played,r.won,r.draw,r.lost,r.points,r.for,r.against])]:[['Раунд','Дата','Время','Место','Судья','Команда А','Команда Б','Счёт А','Счёт Б','Партии'],...gamesOf(t).filter(g=>!g.bye).map(g=>[g.round,g.date,g.time,g.venue,g.referee,name(g.a),name(g.b),g.result?.a,g.result?.b,g.result?.sets.map(s=>s.a+':'+s.b).join(' / ')])];
 return '\uFEFF'+rows.map(r=>r.map(csv).join(';')).join('\r\n');
}
export function tournamentCalendar(tournaments,from,to){
 return tournaments.flatMap(t=>gamesOf(t).filter(g=>!g.bye&&g.date&&g.date>=from&&g.date<=to).map(g=>{
  const name=id=>t.teams.find(p=>p.id===id)?.name||'Участник определится';
  return {id:t.id+'-'+g.id,source:'tournament',date:g.date,time:g.time,minutes:0,title:t.name+' · '+name(g.a)+' — '+name(g.b)+(g.venue?' · '+g.venue:''),exportTitle:'Турнирная игра',done:!!g.result,remind:30};
 }));
}

/** Shuffle only before creating a tournament. Rejection sampling avoids modulo bias. */
export function drawTournamentNames(names,random=()=>crypto.getRandomValues(new Uint32Array(1))[0]){
 require(Array.isArray(names)&&names.length>=2&&names.length<=32,'Добавьте от 2 до 32 участников');const a=[...names];
 for(let i=a.length-1;i>0;i--){const n=i+1,limit=Math.floor(2**32/n)*n;let r,tries=0;do{r=random();require(Number.isInteger(r)&&r>=0&&r<2**32&&++tries<=100,'Ошибка случайной жеребьёвки');}while(r>=limit);const j=r%n;[a[i],a[j]]=[a[j],a[i]];}
 return a;
}
/** Only equal start times can be checked, because fixture duration is not stored. */
export function tournamentScheduleConflicts(t){const rows=gamesOf(t).filter(g=>!g.bye&&g.date&&g.time),result=[];const normalize=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];if(a.date!==b.date||a.time!==b.time)continue;const reasons=[];if(normalize(a.venue)&&normalize(a.venue)===normalize(b.venue))reasons.push('Площадка');if(normalize(a.referee)&&normalize(a.referee)===normalize(b.referee))reasons.push('Судья');if([a.a,a.b].filter(Boolean).some(x=>[b.a,b.b].includes(x)))reasons.push('Команда');if(reasons.length)result.push({a:a.id,b:b.id,date:a.date,time:a.time,reasons});}return result;}
