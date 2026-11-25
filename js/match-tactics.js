import {replayDetailed,scoutSummary,reasons,isError} from './match-protocol.js';
const pct=(won,n)=>n?100*won/n:null;
const blank=()=>({rallies:0,won:0,lost:0,serve:0,serveWon:0,receive:0,receiveWon:0});
const record=(r,e)=>{r.rallies++;r.won+=Number(e.side==='ours');r.lost+=Number(e.side==='theirs');const k=e.before.serve==='ours'?'serve':'receive';r[k]++;r[k+'Won']+=Number(e.side==='ours');};
const finish=r=>({...r,rate:pct(r.won,r.rallies),serveRate:pct(r.serveWon,r.serve),receiveRate:pct(r.receiveWon,r.receive),plusMinus:r.won-r.lost});
const add=(a,b)=>{for(const k of Object.keys(blank()))a[k]+=b[k];};
const pairKey=(a,b)=>JSON.stringify([a,b].sort());
const sortedRows=(map,min)=>[...map.values()].map(r=>({...finish(r),eligible:r.rallies>=min})).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(b.rate??-1)-(a.rate??-1)||b.rallies-a.rallies);
const nameKey=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru');
/** Momentum uses actual consecutive rally scores, not inferred scores from summaries. */
export function scoreMomentum(score,target){
 let ties=0,leadChanges=0,leader=0,oursRun=0,theirsRun=0,maxOurRun=0,maxTheirRun=0,closeWon=0,closeTotal=0;
 for(let i=1;i<score.length;i++){
  const before=score[i-1],after=score[i],a=after.ours-before.ours,b=after.theirs-before.theirs;
  if(!((a===1&&b===0)||(a===0&&b===1)))throw Error('Некорректная последовательность счёта');
  if(a){oursRun++;theirsRun=0;maxOurRun=Math.max(maxOurRun,oursRun);}
  else{theirsRun++;oursRun=0;maxTheirRun=Math.max(maxTheirRun,theirsRun);}
  const sign=Math.sign(after.ours-after.theirs);
  if(!sign)ties++;
  else{if(leader&&leader!==sign)leadChanges++;leader=sign;}
  if(Math.max(before.ours,before.theirs)>=target-5&&Math.abs(before.ours-before.theirs)<=2){closeTotal++;closeWon+=a;}
 }
 return {ties,leadChanges,maxOurRun,maxTheirRun,closeWon,closeTotal,closeRate:pct(closeWon,closeTotal)};
}
/** Phase-specific rotation counts, computed before the rally changes serve or lineup.
 * A relative cycle is not a court zone or a particular starting six. */
export function rotationPerformance(timeline,{set=0,min=10}={}){
 if(!Number.isInteger(set)||set<0||!Number.isInteger(min)||min<1||min>500)throw Error('Проверьте фильтры расстановки');
 const rows=Object.fromEntries(['ours','theirs'].map(side=>[side,Array.from({length:6},(_,i)=>({...blank(),position:i+1}))]));
 for(const e of timeline){
  if(e.type!=='rally'||set&&e.set!==set)continue;
  for(const side of ['ours','theirs']){
   const row=rows[side][e.rotation[side]],won=Number(e.side===side),phase=e.before.serve===side?'serve':'receive';
   row.rallies++;row.won+=won;row.lost+=1-won;row[phase]++;row[phase+'Won']+=won;
  }
 }
 const result={};
 for(const side of ['ours','theirs']){
  const stats=rows[side].map(r=>({...finish(r),serveEligible:r.serve>=min,receiveEligible:r.receive>=min,eligible:r.rallies>=min}));
  const comparisons=['serve','receive'].flatMap(phase=>{
   const sorted=stats.filter(r=>r[phase+'Eligible']).sort((a,b)=>a[phase+'Rate']-b[phase+'Rate']||a.position-b.position);
   if(sorted.length<2||sorted.at(-1)[phase+'Rate']-sorted[0][phase+'Rate']<20)return [];
   const low=sorted[0][phase+'Rate'],high=sorted.at(-1)[phase+'Rate'];
   return [{phase,low:sorted.filter(r=>r[phase+'Rate']===low).map(r=>r.position),high:sorted.filter(r=>r[phase+'Rate']===high).map(r=>r.position),gap:high-low}];
  });
  result[side]={rows:stats,comparisons};
 }
 return result;
}
/** Adjacent recorded set -> attack by different teammates, only in complete
 * recorded rallies. No assumed assists or inference from terminal points. */
export function recordedConnections(timelines,{side='ours',set=0,min=5}={}){
 if(!['ours','theirs'].includes(side)||side==='theirs'&&timelines.length>1||!Number.isInteger(set)||set<0||!Number.isInteger(min)||min<1||min>500)throw Error('Проверьте выборку связок');
 const pairs=new Map();let rallies=0,complete=0,linkedRallies=0;
 for(const timeline of timelines)for(const e of timeline){
  if(e.type!=='rally'||set&&e.set!==set)continue;rallies++;
  if(!e.captureComplete)continue;complete++;
  let linked=false;
  for(let i=1;i<(e.touches||[]).length;i++){
   const a=e.touches[i-1],b=e.touches[i];
   if(a.side!==side||b.side!==side||a.action!=='set'||a.result!=='continue'||b.action!=='attack'||a.player===b.player||!['continue','point','error'].includes(b.result))continue;
   const key=JSON.stringify([a.player,b.player]);
   if(!pairs.has(key))pairs.set(key,{setter:a.player,attacker:b.player,attempts:0,points:0,errors:0,continued:0});
   const r=pairs.get(key);r.attempts++;r.points+=Number(b.result==='point');r.errors+=Number(b.result==='error');r.continued+=Number(b.result==='continue');linked=true;
  }
  if(linked)linkedRallies++;
 }
 const rows=[...pairs.values()].map(r=>({...r,eligible:r.attempts>=min,efficiency:100*(r.points-r.errors)/r.attempts})).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.attempts-a.attempts||a.setter.localeCompare(b.setter)||a.attacker.localeCompare(b.attacker));
 return {rallies,complete,linkedRallies,rows};
}
/** Local before/after windows, never cross a party. Several substitutions can
 * share the same window; this measures association, not an effect. */
export function substitutionWindows(timeline,{set=0,window=5}={}){
 if(!Number.isInteger(set)||set<0||!Number.isInteger(window)||window<1||window>10)throw Error('Проверьте окно замен');
 const bySet=new Map();
 for(const e of timeline){if(set&&e.set!==set)continue;if(!bySet.has(e.set))bySet.set(e.set,[]);bySet.get(e.set).push(e);}
 const rows=[];
 for(const [party,events] of bySet){
  const rallies=events.filter(e=>e.type==='rally');let index=0;
  for(const e of events){
   if(e.type==='rally'){index++;continue;}if(e.type!=='sub')continue;
   const before=rallies.slice(Math.max(0,index-window),index),after=rallies.slice(index,index+window);
   const count=items=>{const won=items.filter(r=>r.side===e.side).length;return {won,total:items.length,rate:pct(won,items.length)};};
   const a=count(before),b=count(after);
   rows.push({set:party,side:e.side,score:e.score,out:e.out,in:e.in,zone:e.zone,before:a,after:b,delta:a.total===window&&b.total===window?b.rate-a.rate:null});
  }
 }
 return rows;
}
export function matchTactics(d,windowSize=5,{set:onlySet=0,min=30}={}){
 if(!Number.isInteger(windowSize)||windowSize<1||windowSize>10)throw Error('Проверьте окно анализа');
 if(!Number.isInteger(onlySet)||onlySet<0||onlySet>d.bestOf||!Number.isInteger(min)||min<1||min>500)throw Error('Проверьте фильтр анализа');
 const s=replayDetailed(d),bySet=new Map(),rotations=Array.from({length:6},(_,i)=>({...blank(),position:i+1})),pairs=new Map(),six=new Map(),all=blank(),timeouts=[];
 for(const e of s.timeline){
  if(onlySet&&e.set!==onlySet)continue;
  if(!bySet.has(e.set))bySet.set(e.set,{set:e.set,events:[],rallyEvents:[],score:[{rally:0,ours:0,theirs:0}],...blank(),maxLead:0,maxDeficit:0,maxRun:0,run:0});
  const set=bySet.get(e.set);set.events.push(e);
  if(e.type!=='rally')continue;
  record(all,e);record(set,e);record(rotations[e.rotation.ours],e);
  const ids=[...new Set(e.before.lineups.ours.filter(Boolean))].sort();
  if(ids.length===6){
   const key=JSON.stringify(ids);if(!six.has(key))six.set(key,{key,players:ids,...blank()});record(six.get(key),e);
   for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
    const key=pairKey(ids[i],ids[j]);if(!pairs.has(key))pairs.set(key,{key,players:[ids[i],ids[j]],...blank()});record(pairs.get(key),e);
   }
  }
  const prev=set.score.at(-1),ours=prev.ours+Number(e.side==='ours'),theirs=prev.theirs+Number(e.side==='theirs');
  set.rallyEvents.push(e);set.score.push({rally:set.rallyEvents.length,ours,theirs});
  set.maxLead=Math.max(set.maxLead,ours-theirs);set.maxDeficit=Math.max(set.maxDeficit,theirs-ours);set.run=e.side==='ours'?set.run+1:0;set.maxRun=Math.max(set.maxRun,set.run);
 }
 const sets=[...bySet.values()].map(set=>{
  let index=0;
  for(const e of set.events){
   if(e.type==='rally'){index++;continue;}
   if(e.type!=='timeout')continue;
   const before=set.rallyEvents.slice(Math.max(0,index-windowSize),index),after=set.rallyEvents.slice(index,index+windowSize);
   const result=a=>({won:a.filter(x=>x.side==='ours').length,total:a.length,rate:pct(a.filter(x=>x.side==='ours').length,a.length)});
   const a=result(before),b=result(after);
   timeouts.push({set:set.set,side:e.side,score:e.score,before:a,after:b,delta:a.total===windowSize&&b.total===windowSize?b.rate-a.rate:null});
  }
  const {events,rallyEvents,run,...summary}=set;
  return {...finish(summary),momentum:scoreMomentum(summary.score,summary.set===d.bestOf?d.decider:d.target)};
 });
 return {sets,overall:finish(all),rotations:rotations.map(finish),pairs:sortedRows(pairs,min),six:sortedRows(six,min),timeouts,substitutions:substitutionWindows(s.timeline,{set:onlySet,window:windowSize})};
}
export function opponentHistory(matches){
 const groups=new Map();
 for(const m of matches){const key=nameKey(m.opponent);if(!key)continue;
  if(!groups.has(key))groups.set(key,{key,name:m.opponent,matches:0,wins:0,losses:0,draws:0,setsWon:0,setsLost:0,details:0});
  const g=groups.get(key),a=m.sets.filter(s=>s.ours>s.theirs).length,b=m.sets.filter(s=>s.ours<s.theirs).length;
  g.matches++;g.setsWon+=a;g.setsLost+=b;g.wins+=Number(a>b);g.losses+=Number(a<b);g.draws+=Number(a===b);g.details+=Number(!!m.detail);
 }
 return [...groups.values()].sort((a,b)=>b.matches-a.matches||a.name.localeCompare(b.name,'ru'));
}
export function teamTactics(matches,{from='',to='',opponent='',min=30}={}){
 if(!Number.isInteger(min)||min<1||min>500)throw Error('Проверьте минимальную выборку');
 const chosen=matches.filter(m=>(!from||m.date>=from)&&(!to||m.date<=to)&&(!opponent||nameKey(m.opponent)===opponent));
 const all=blank(),rotations=Array.from({length:6},(_,i)=>({...blank(),position:i+1})),pairs=new Map(),six=new Map(),timeouts=[];let detailed=0;
 for(const m of chosen){if(!m.detail)continue;
  const a=matchTactics(m.detail);detailed++;add(all,a.overall);for(const r of a.rotations)add(rotations[r.position-1],r);
  for(const [target,rows] of [[pairs,a.pairs],[six,a.six]])for(const r of rows){if(!target.has(r.key))target.set(r.key,{key:r.key,players:r.players,...blank(),matches:0});const g=target.get(r.key);add(g,r);g.matches++;}
  timeouts.push(...a.timeouts.map(t=>({...t,date:m.date,opponent:m.opponent})));
 }
 return {total:chosen.length,detailed,overall:finish(all),rotations:rotations.map(r=>({...finish(r),eligible:r.rallies>=min})),pairs:sortedRows(pairs,min),six:sortedRows(six,min),timeouts,opponents:opponentHistory(chosen)};
}

/** Evidence-based match debrief: no invented attempts or automatic player judgments. */
export function matchDebrief(d,{min=10}={}){
 if(!Number.isInteger(min)||min<5||min>100)throw Error('Проверьте минимальную выборку');
 const s=replayDetailed(d),a=matchTactics(d),events=s.timeline.filter(e=>e.type==='rally'),counts={ours:{},theirs:{}};
 let detailed=0;
 for(const e of events){if(e.kind!=='point')detailed++;const c=counts[e.side];c[e.kind]=(c[e.kind]||0)+1;}
 const top=(side,filter)=>Object.entries(counts[side]).filter(([k])=>filter(k)).map(([kind,count])=>({kind,label:reasons[kind],count})).sort((a,b)=>b.count-a.count||a.kind.localeCompare(b.kind));
 const observations=side=>scoutSummary(s.timeline,side,{active:[]});
 const weak=observations('ours'),target=observations('theirs');
 const notes=[],add=(kind,title,text)=>notes.push({kind,title,text});
 const o=a.overall;
 if(o.rallies<min)add('data','Малая выборка','Записано '+o.rallies+' розыгрышей; для устойчивых выводов нужно больше данных.');
 else{
  if(o.serve>=min&&o.receive>=min){
   const diff=o.serveRate-o.receiveRate;
   if(Math.abs(diff)>=15)add('focus',diff>0?'Работа на приёме':'Работа на своей подаче','Выиграно на подаче '+o.serveWon+'/'+o.serve+'; на приёме '+o.receiveWon+'/'+o.receive+'. Разница '+Math.round(Math.abs(diff))+' п.п. Проверьте видео и характер проигранных розыгрышей.');
  }
  const eligible=a.rotations.filter(r=>r.rallies>=min).sort((x,y)=>x.rate-y.rate||x.position-y.position);
  if(eligible.length>=2&&eligible.at(-1).rate-eligible[0].rate>=20){const x=eligible[0],y=eligible.at(-1);add('focus','Проверить цикл P'+x.position,'Выиграно '+x.won+'/'+x.rallies+' против '+y.won+'/'+y.rallies+' в P'+y.position+'. Сравнение относительных циклов переходов, не оценка отдельного игрока.');}
  const close=a.sets.reduce((r,x)=>({won:r.won+x.momentum.closeWon,total:r.total+x.momentum.closeTotal}),{won:0,total:0});
  if(close.total>=min&&close.won/close.total<.4)add('focus','Тренировать концовки','Выиграно '+close.won+'/'+close.total+' близких розыгрышей в концовке. Отработайте игровые ситуации при равном счёте.');
 }
 const errors=top('theirs',isError),positive=top('ours',k=>['kill','tip','ace','block'].includes(k));
 if(errors[0]?.count>=3){const max=errors[0].count,leaders=errors.filter(x=>x.count===max);add('focus','Частые отмеченные причины потери очка',leaders.map(x=>x.label+' — '+x.count).join('; ')+'. Это количество записанных ошибок, не процент от попыток.');}
 if(positive[0]?.count>=3){const max=positive[0].count;add('strength','Результативные действия',positive.filter(x=>x.count===max).map(x=>x.label+' — '+x.count).join('; ')+'. Это отмеченные выигранные очки.');}
 for(const [v,title] of [[weak,'Наша защита'],[target,'Зоны соперника']]){
  const zone=v.topZones[0];if(zone?.count>=3){const top=v.topZones.filter(x=>x.count===zone.count);add('focus',title,top.map(x=>'Зона '+x.zone+' — '+x.count).join('; ')+'. Зона отмечена в '+v.knownZones+' из '+v.total+' подходящих розыгрышей; неизвестные зоны не распределяются.');}
 }
 if(events.length&&detailed/events.length<.7)add('data','Неполная детализация','Причина отмечена в '+detailed+' из '+events.length+' розыгрышей. Не сравнивайте частоту элементов без учёта пропусков.');
 return {rallies:events.length,detailed,overall:o,errors,positive,notes,scout:{ours:weak,theirs:target}};
}

/** Suggest library exercises only for repeatedly recorded causes of lost points.
 * The text match is transparent and does not establish a player's skill or diagnosis. */
export function trainingRecommendations(debrief,exercises,{minErrors=3,minDetailed=10}={}){
 if(!Number.isInteger(minErrors)||minErrors<2||!Number.isInteger(minDetailed)||minDetailed<5)throw Error('Проверьте пороги выборки');
 if(!debrief||debrief.detailed<minDetailed)return [];
 const topics={
  serveError:{name:'Подача',pattern:/подач/iu},
  receiveError:{name:'Приём подачи',pattern:/при[её]м/iu},
  attackError:{name:'Атака',pattern:/атак|нападающ/iu},
  defenseError:{name:'Защита',pattern:/защит|страхов/iu},
  setError:{name:'Передача',pattern:/передач/iu}
 };
 return debrief.errors.filter(e=>Object.hasOwn(topics,e.kind)&&e.count>=minErrors).map(e=>{
  const topic=topics[e.kind];
  const matches=exercises.filter(x=>x.category==='volleyball'&&topic.pattern.test([x.name,x.description].join(' ')));
  return {kind:e.kind,topic:topic.name,count:e.count,detailed:debrief.detailed,rallies:debrief.rallies,exercises:matches.slice(0,5).map(x=>({id:x.id,name:x.name,minutes:x.minutes,description:x.description,equipment:x.equipment}))};
 });
}
