import {timedMatchPlayers,timedRate,indexPlayerRecords} from './coach.js';
import {replayDetailed} from './match-protocol.js';
import {definitionKey,testHistory,summarizeTests} from './coach-tests.js';
export const sourceLabels={all:'Все матчи',live:'Подробные матчи TeachApp',imported:'VolleyPoint PDF',manual:'Ручные / прежние матчи'};
export const matchMetrics={aces:'Эйсы',points:'Личные очки',attackKills:'Результативные атаки',blocks:'Блоки',serveRate:'Успешность подачи',receiveRate:'Положительный приём',attackRate:'Результативность атаки',pointsPer10:'Личные очки за 10 минут LIVE'};
export const testMetrics={success:'Успешность',target:'Попадания в цель',errors:'Доля ошибок',stability:'Стабильность',progress:'Прогресс',latest:'Последний замер',best:'Лучший замер'};
const inRange=(d,{from='',to=''}={})=>(!from||d>=from)&&(!to||d<=to);
const count=n=>Number.isFinite(n)&&n>=0;
const percent=(s,n)=>n>0?100*s/n:null;
const sum=(a,key)=>a.reduce((n,v)=>n+v[key],0);
export function matchSource(m){return m.imported?'imported':m.detail?'live':'manual';}
export function filteredMatches(matches,filter={}){
 return matches.filter(m=>inRange(m.date,filter)&&(!filter.source||filter.source==='all'||matchSource(m)===filter.source));
}
export function testDefinitions(sessions,range={}){
 const map=new Map();
 for(const s of sessions||[])if(inRange(s.date,range))map.set(definitionKey(s.definition),s.definition);
 return [...map.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name,'ru')||a[0].localeCompare(b[0]));
}
export function eligiblePlayers(players,filter={}){
 return players.filter(p=>(filter.archived||!p.archived)&&(!filter.position||p.position===filter.position));
}
export function matchComparison(view,metric,filter={}){
 if(!Object.hasOwn(matchMetrics,metric))throw Error('Неизвестный показатель');
 const matches=filteredMatches(view.matches,filter),rosters=indexPlayerRecords(matches);
 if(metric==='pointsPer10'){
  const data=new Map(matches.filter(m=>m.detail).map(m=>[m,timedMatchPlayers(replayDetailed(m.detail))]));
  return eligiblePlayers(view.players,filter).map(player=>{
   const roster=(rosters.get(player.id)||[]),history=[],sum={ms:0,rallies:0,points:0};let recorded=0;
   for(const m of roster){const a=data.get(m)?.get(player.id);if(!a||a.ms<=0)continue;sum.ms+=a.ms;sum.rallies+=a.rallies;sum.points+=a.points;recorded+=Number(a.rallies>0);const value=timedRate(a);if(value!==null)history.push({date:m.date,label:m.opponent,value});}
   const value=timedRate(sum);
   return {player,value,recorded,total:roster.length,attempts:sum.rallies,success:sum.points,eligible:value!==null&&recorded>=2,history:history.sort((a,b)=>a.date.localeCompare(b.date)),lower:false,unit:'очк./10 мин',sample:sum.points+' очков · '+Math.round(sum.ms/60000*10)/10+' мин · '+sum.rallies+' роз. · матчей с розыгрышами '+recorded+'/'+roster.length};
  });
 }
 const pair={serveRate:['serves','serveErrors',true],receiveRate:['receptions','receptionGood',false],attackRate:['attacks','attackKills',false]}[metric];
 return eligiblePlayers(view.players,filter).map(player=>{
  const roster=(rosters.get(player.id)||[]);
  const rows=[];let attempts=0,success=0;
  for(const m of roster){
   const s=m.stats[player.id];if(!s)continue;
   if(pair){
    if(matchSource(m)!=='manual')continue;
    const [den,num,invert]=pair;if(!count(s[den])||s[den]<=0||!count(s[num])||s[num]>s[den])continue;
    const n=s[den],v=invert?n-s[num]:s[num];attempts+=n;success+=v;
    rows.push({date:m.date,label:m.opponent,value:percent(v,n),attempts:n,success:v});
   }else if(count(s[metric]))rows.push({date:m.date,label:m.opponent,value:s[metric]});
  }
  const value=pair?percent(success,attempts):rows.length?sum(rows,'value'):null;
  return {player,value,recorded:rows.length,total:roster.length,attempts,success,eligible:pair?attempts>=30&&rows.length>=2:rows.length>0&&value>0,history:rows.sort((a,b)=>a.date.localeCompare(b.date)),lower:false,unit:pair?'%':'',sample:pair?success+'/'+attempts+' · матчей '+rows.length+'/'+roster.length:'Записано матчей: '+rows.length+'/'+roster.length};
 });
}
const validHistory=h=>h.filter(x=>x.result.status==='done'&&!x.result.adapted);
export function testComparison(view,key,metric,filter={}){
 const d=testDefinitions(view.tests,filter).find(([k])=>k===key)?.[1];
 if(!d||!Object.hasOwn(testMetrics,metric))return [];
 const skill=d.kind==='skill';
 if(skill&&!['success','target','errors','stability','progress'].includes(metric)||!skill&&!['latest','best','progress'].includes(metric))return [];
 return eligiblePlayers(view.players,filter).map(player=>{
  const all=testHistory(view.tests,player.id,filter).filter(x=>definitionKey(x.definition)===key);
  const h=validHistory(all),g=summarizeTests(all)[0],rows=[];
  for(const x of h){const r=x.result;let value=null;
   if(skill){if(metric==='target'){if(r.target!==null)value=percent(r.target,r.attempts);}else value=percent(metric==='errors'?r.errors:r.success,r.attempts);}
   else value=r.value;
   if(value!==null)rows.push({date:x.date,value,attempts:r.attempts,success:r.success,label:d.name});
  }
  let value=null,eligible=false,lower=false,unit=skill?'%':d.unit;
  const attempts=rows.reduce((n,r)=>n+(r.attempts||0),0);
  if(skill){
   if(metric==='success'||metric==='errors'||metric==='target'){
    value=metric==='success'?g?.pct??null:metric==='errors'?percent(g?.errors||0,g?.attempts||0):g?.targetPct??null;
    lower=metric==='errors';eligible=attempts>=30&&rows.length>=2;
   }else if(metric==='stability'){
    const comparable=rows.filter(r=>r.attempts>=10);lower=true;unit='п.п.';
    if(comparable.length>=3){const avg=sum(comparable,'value')/comparable.length;value=Math.sqrt(comparable.reduce((n,r)=>n+(r.value-avg)**2,0)/comparable.length);eligible=true;}
   }else{
    const first=rows.slice(0,2),last=rows.slice(-2);unit='п.п.';
    if(rows.length>=4&&sum(first,'attempts')>=20&&sum(last,'attempts')>=20){value=percent(sum(last,'success'),sum(last,'attempts'))-percent(sum(first,'success'),sum(first,'attempts'));eligible=true;}
   }
  }else{
   lower=d.direction==='lower';
   if(metric==='latest'||metric==='best'){value=metric==='latest'?g?.last??null:g?.best??null;eligible=rows.length>=1;}
   else{lower=false;if(rows.length>=2){value=(d.direction==='lower'?-1:1)*(rows.at(-1).value-rows[0].value);eligible=true;}}
  }
  return {player,value,eligible:value!==null&&eligible,lower,unit,recorded:rows.length,total:all.length,attempts,history:rows,adapted:g?.adapted||0,sample:(skill?attempts+' попыток · ':'')+'Замеров '+rows.length+'/'+all.length+(g?.adapted?' · адаптировано '+g.adapted:'')};
 });
}
export function ranked(rows){
 const candidates=rows.filter(r=>r.eligible&&Number.isFinite(r.value));
 candidates.sort((a,b)=>(a.lower?a.value-b.value:b.value-a.value)||b.attempts-a.attempts||a.player.name.localeCompare(b.player.name,'ru'));
 let previous=null,place=0;
 return candidates.map((r,i)=>{if(previous===null||Math.abs(previous-r.value)>1e-8){place=i+1;previous=r.value;}return {...r,place};});
}
export function personalInsights(sessions,id,range={}){
 const h=testHistory(sessions,id,range),groups=summarizeTests(h),notes=[];
 for(const g of groups){
  const d=g.definition,rows=validHistory(g.history);
  if(d.kind==='skill'){
   if(g.attempts<30||rows.length<2)continue;
   const prefix=d.name+' · '+d.protocol+': ';
   const rate=Math.round(g.pct*10)/10;
   if(g.errors===0)notes.push({kind:'strength',text:prefix+'без ошибок в '+g.attempts+' записанных попытках ('+rows.length+' тестирования).'});
   else if(g.pct>=90)notes.push({kind:'strength',text:prefix+'высокая доля успехов '+rate+'% ('+g.success+'/'+g.attempts+').'});
   else if(g.pct<70)notes.push({kind:'focus',text:prefix+'стоит обсудить отработку элемента: '+g.errors+' ошибок из '+g.attempts+' попыток.'});
   if(rows.length>=4){
    const a=rows.slice(0,2).map(x=>x.result),b=rows.slice(-2).map(x=>x.result);
    if(sum(a,'attempts')>=20&&sum(b,'attempts')>=20){
     const delta=percent(sum(b,'success'),sum(b,'attempts'))-percent(sum(a,'success'),sum(a,'attempts'));
     if(Math.abs(delta)>=5)notes.push({kind:delta>0?'strength':'focus',text:prefix+(delta>0?'рост ':'снижение ')+Math.abs(Math.round(delta*10)/10)+' п.п. между первыми и последними двумя тестами.'});
    }
   }
  }else if(g.measurements.length>=2){
   const delta=(d.direction==='lower'?-1:1)*(g.last-g.first);
   if(delta>0)notes.push({kind:'strength',text:d.name+' · '+d.protocol+': улучшение на '+Math.round(delta*100)/100+' '+d.unit+' относительно первого замера.'});
  }
 }
 return notes;
}
