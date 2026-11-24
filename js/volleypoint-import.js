const fail=msg=>{throw Error('VolleyPoint: '+msg);};
const check=(ok,msg)=>{if(!ok)fail(msg);};
const norm=s=>String(s).toLowerCase().replace(/ё/g,'е').trim().split(/\s+/).sort().join(' ');
const kinds={'Атака':'attackKills','Блок':'blocks','Эйс':'aces','Ошибка подачи':'serveErrors','Ошибка атаки':'attackErrors','Ошибка приёма':'receiveErrors','Другая ошибка':'otherErrors','Другое':'unknown'};
const errorKeys=['serveErrors','attackErrors','receiveErrors','otherErrors'];
const count=x=>Number.isInteger(x)&&x>=0&&x<=9999;
const only=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
export function parseVolleyRows(rows){
 const lines=rows.map(x=>x.trim().replace(/\s+/g,' ')).filter(x=>x&&!/^VolleyPoint Протокол матча$|^Страница \d+ из \d+$/.test(x));
 const dateLine=lines.find(x=>x.includes('Дата:'))||'',d=/Дата:\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(dateLine),hash=/Отпечаток SHA-256:\s*([a-f\d]{64})\b/i.exec(lines.join('\n'));
 check(d&&hash,'не найдены дата или отпечаток');const date=d[3]+'-'+d[2]+'-'+d[1];check(Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date,'некорректная дата');
 const competition=(lines.find(x=>x.includes('Турнир:'))||'').split('Турнир:')[1]?.trim()||'';
 const sets=[];let mode='',team=null;const teams=[],rallies=[];
 for(const line of lines){let m;
  if(line==='Результаты сетов'){mode='sets';continue;}if(line==='Расстановки'){mode='';continue;}
  if((m=/^(.+?) Выиграно очков:\s*(\d+)$/.exec(line))){team={name:m[1],points:+m[2],players:[],series:[],totals:null};teams.push(team);mode='players';continue;}
  if(line==='Серии подач'){mode='series';continue;}if(line==='Детали очка'){mode='rallies';continue;}if(line==='Подписи'){mode='';continue;}
  if(mode==='sets'&&(m=/^(\d) (\d+) (\d+) \d+:\d+:\d+$/.exec(line))){check(+m[1]===sets.length+1&&+m[2]!==+m[3],'некорректная партия');sets.push([+m[2],+m[3]]);}
  if(mode==='players'&&team){if((m=/^Итого по команде (\d+) (\d+) (\d+) (\d+)$/.exec(line)))team.totals=m.slice(1).map(Number);
   if((m=/^(?:\(C\) )?#(\d+) (.+?) - .+? (\d+) (\d+) (\d+) (\d+)$/.exec(line)))team.players.push({number:+m[1],name:m[2],attackKills:+m[3],blocks:+m[4],aces:+m[5],errors:+m[6]});
   if(line.startsWith('Очки на ошибках соперника'))mode='';}
  if(mode==='series'&&team&&(m=/^(\d) #(\d+) (.+?) (\d+) (\d+) (\d+)$/.exec(line)))team.series.push({set:+m[1],number:+m[2],name:m[3],wins:+m[4],aces:+m[5],errors:+m[6]});
  if(mode==='rallies'&&/^\d+ /.test(line)){m=/^(\d) (\d+)\s*:\s*(\d+) (.+?) (Ошибка подачи|Ошибка атаки|Ошибка приёма|Другая ошибка|Атака|Блок|Эйс|Другое) (?:(?:\(C\) )?#(\d+) (.+)|Без автора)$/.exec(line);check(m,'не распознана строка розыгрыша');const winner=teams.findIndex(t=>t.name===m[4]);check(winner>=0,'неизвестная команда');rallies.push({set:+m[1],score:[+m[2],+m[3]],winner,kind:kinds[m[5]],number:m[6]==null?null:+m[6],name:m[7]||''});}
 }
 check(sets.length>=1&&sets.length<=5&&teams.length===2&&teams[0].name!==teams[1].name,'неполные партии или команды');
 for(const [i,t] of teams.entries()){check(t.players.length&&new Set(t.players.map(p=>p.number)).size===t.players.length&&t.totals,'неполный состав');check(t.points===sets.reduce((a,s)=>a+s[i],0),'итог очков не совпадает');for(const [j,k] of ['attackKills','blocks','aces','errors'].entries())check(t.players.reduce((a,p)=>a+p[k],0)===t.totals[j],'сумма статистики не совпадает');for(const s of t.series)check(s.set>=1&&s.set<=sets.length&&s.aces<=s.wins&&t.players.some(p=>p.number===s.number&&norm(p.name)===norm(s.name)),'некорректная серия');}
 const progress=sets.map(()=>[0,0]);let previous=1;
 for(const r of rallies){check(r.set>=previous&&r.set<=previous+1&&r.set<=sets.length,'порядок партий');previous=r.set;const score=progress[r.set-1];score[r.winner]++;check(score.every((n,i)=>n===r.score[i]),'пропущен или повторён розыгрыш');const side=r.kind.endsWith('Errors')?1-r.winner:r.winner;if(r.number!=null)check(teams[side].players.some(p=>p.number===r.number&&norm(p.name)===norm(r.name)),'автор не найден в составе');}
 check(progress.every((s,i)=>s.every((n,j)=>n===sets[i][j])),'журнал очков неполный');
 return {date,competition,hash:hash[1].toLowerCase(),sets,teams,rallies};
}
export function suggestPlayer(source,players){const names=players.filter(p=>norm(p.name)===norm(source.name));return names.length===1&&names[0].number===source.number?names[0].id:'';}
export function buildVolleyImport(report,side,mapping){
 check(side===0||side===1,'выберите команду');const team=report.teams[side];const roster=team.players.map(p=>mapping[p.number]);check(roster.every(x=>typeof x==='string'&&x)&&new Set(roster).size===roster.length,'сопоставьте всех игроков без повторов');
 const stats=Object.fromEntries(team.players.map(p=>[mapping[p.number],{attackKills:p.attackKills,blocks:p.blocks,aces:p.aces,points:p.attackKills+p.blocks+p.aces}]));
 const players=Object.fromEntries(team.players.map(p=>[mapping[p.number],{errors:p.errors,serveErrors:0,attackErrors:0,receiveErrors:0,otherErrors:0,serviceSeries:[]}]));
 for(const s of team.series)players[mapping[s.number]].serviceSeries.push({set:s.set,wins:s.wins,aces:s.aces,errors:s.errors});
 const rallies=report.rallies.map(r=>{const actorSide=r.kind.endsWith('Errors')?1-r.winner:r.winner;const playerId=r.number!=null&&actorSide===side?mapping[r.number]:null;if(playerId&&r.kind.endsWith('Errors'))players[playerId][r.kind]++;return {set:r.set,ours:r.score[side],theirs:r.score[1-side],winner:r.winner===side?'ours':'theirs',kind:r.kind,playerId};});
 return {date:report.date,opponent:report.teams[1-side].name,competition:report.competition,sets:report.sets.map(s=>({ours:s[side],theirs:s[1-side]})),roster,stats,imported:{source:'volleypoint',hash:report.hash,players,rallies}};
}
export function validateVolleyImport(m){
 const v=m.imported;
 check(!m.detail&&only(v,['source','hash','players','rallies'])&&v.source==='volleypoint'&&/^[a-f\d]{64}$/.test(v.hash)&&only(v.players,m.roster)&&Object.keys(v.players).length===m.roster.length&&Array.isArray(v.rallies)&&v.rallies.length<=10000,'некорректный импорт');
 const progress=m.sets.map(()=>({ours:0,theirs:0}));let previous=1;
 const errors=new Map(m.roster.map(id=>[id,Object.fromEntries(errorKeys.map(k=>[k,0]))]));
 for(const r of v.rallies){
  check(only(r,['set','ours','theirs','winner','kind','playerId'])&&Number.isInteger(r.set)&&r.set>=previous&&r.set<=previous+1&&r.set<=m.sets.length&&['ours','theirs'].includes(r.winner)&&Object.values(kinds).includes(r.kind),'некорректный розыгрыш');
  previous=r.set;const s=progress[r.set-1];s[r.winner]++;check(s.ours===r.ours&&s.theirs===r.theirs,'некорректная последовательность счёта');
  if(r.playerId!==null){check(errors.has(r.playerId)&&(errorKeys.includes(r.kind)?r.winner==='theirs':r.winner==='ours'),'неверный автор');if(errorKeys.includes(r.kind))errors.get(r.playerId)[r.kind]++;}
 }
 check(progress.every((s,i)=>s.ours===m.sets[i].ours&&s.theirs===m.sets[i].theirs),'журнал не соответствует счёту');
 for(const id of m.roster){const p=v.players[id],stats=m.stats[id];
  check(only(stats,['attackKills','blocks','aces','points'])&&['attackKills','blocks','aces','points'].every(k=>count(stats[k]))&&stats.points===stats.attackKills+stats.blocks+stats.aces,'некорректные результативные действия');
  check(only(p,['errors',...errorKeys,'serviceSeries'])&&count(p.errors)&&errorKeys.every(k=>count(p[k])&&p[k]===errors.get(id)[k])&&errorKeys.reduce((n,k)=>n+p[k],0)<=p.errors&&Array.isArray(p.serviceSeries)&&p.serviceSeries.length<=10000,'некорректные ошибки игрока');
  check(p.serviceSeries.every(s=>only(s,['set','wins','aces','errors'])&&Number.isInteger(s.set)&&s.set>=1&&s.set<=m.sets.length&&count(s.wins)&&count(s.aces)&&count(s.errors)&&s.aces<=s.wins),'некорректная серия');
 }
 return m;
}
export function duplicateVolleyMatch(matches,m){
 const clean=s=>String(s).trim().toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ');
 return matches.some(x=>x.teamId===m.teamId&&(x.imported?.hash===m.imported.hash||(x.date===m.date&&clean(x.opponent)===clean(m.opponent)&&JSON.stringify(x.sets)===JSON.stringify(m.sets))));
}
