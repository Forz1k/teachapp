/* Private, optional rally observations; independent of the authoritative point log. */
export const captureModes={quick:'Быстрый',standard:'Стандартный',pro:'Профессиональный'};
export const touchActions={serve:'Подача',receive:'Приём',set:'Передача',attack:'Атака',block:'Блок',defense:'Защита'};
export const touchQuality={unknown:'Не оценено',positive:'Положительно',perfect:'Идеально',negative:'Отрицательно'};
export const touchResults={continue:'Мяч в игре',point:'Очко',error:'Ошибка',unknown:'Не указано'};
export function validateCapture(event,before,actor){
 const fail=(ok,msg)=>{if(!ok)throw Error(msg)};
 fail(event.captureMode===undefined||Object.hasOwn(captureModes,event.captureMode),'Неизвестный режим регистрации');
 fail(event.captureComplete===undefined||typeof event.captureComplete==='boolean','Некорректная отметка полноты');
 const touches=event.touches??[];
 fail(Array.isArray(touches)&&touches.length<=60,'Не более 60 действий в розыгрыше');
 for(const [i,t] of touches.entries()){
  fail(t&&Object.keys(t).every(k=>['side','player','action','quality','result','zone'].includes(k))&&['ours','theirs'].includes(t.side)&&typeof t.player==='string'&&before.lineups[t.side].includes(t.player)&&Object.hasOwn(touchActions,t.action)&&Object.hasOwn(touchQuality,t.quality)&&Object.hasOwn(touchResults,t.result)&&(t.zone===null||Number.isInteger(t.zone)&&t.zone>=1&&t.zone<=6),'Проверьте действие и игрока до розыгрыша');
  fail(i===touches.length-1||!['point','error'].includes(t.result),'Завершение может быть только последним действием');
  if(t.result==='point')fail(t.side===event.side,'Команда завершающего действия не соответствует счёту');
  if(t.result==='error')fail(t.side!==event.side,'Ошибка не соответствует счёту');
 }
 if(event.captureComplete){
  const first=touches[0],last=touches.at(-1);
  fail(touches.length>0&&first.action==='serve'&&first.side===before.serve&&first.player===before.lineups[before.serve][0]&&['point','error'].includes(last.result)&&touches.every(t=>t.result!=='unknown'),'Полная запись должна начинаться фактической подачей и завершаться очком или ошибкой; неизвестных результатов быть не должно');
 }
 return touches;
}
const rate=(n,total)=>total?100*n/total:null;
const metric=(n,total)=>({n,total,value:rate(n,total)});
/** Only explicit, complete touch records contribute to action percentages. */
export function captureSummary(timeline,{set=0,side='ours',player=null}={}){
 const rallies=timeline.filter(e=>e.type==='rally'&&(!set||e.set===set));
 const selected=rallies.filter(e=>!player||e.before.lineups[side].includes(player));
 const modes={quick:0,standard:0,pro:0,legacy:0};let reasons=0,authors=0,touchRallies=0,complete=0;
 const counts=Object.fromEntries(Object.keys(touchActions).map(k=>[k,{total:0,point:0,error:0,positive:0,perfect:0,qualityKnown:0,resultKnown:0}]));
 let defenseTotal=0,defenseWon=0;
 for(const e of selected){
  modes[e.captureMode??'legacy']++;if(e.kind!=='point')reasons++;if(e.player)authors++;if(e.touches?.length)touchRallies++;
  if(!e.captureComplete)continue;complete++;
  const own=e.touches.filter(t=>t.side===side&&(!player||t.player===player));
  for(const t of own){
   const r=counts[t.action];r.total++;if(t.result!=='unknown')r.resultKnown++;if(t.result==='point')r.point++;if(t.result==='error')r.error++;
   if(t.quality!=='unknown')r.qualityKnown++;
   if(t.quality==='positive'||t.quality==='perfect')r.positive++;if(t.quality==='perfect')r.perfect++;
  }
  if(own.some(t=>t.action==='defense'&&t.result==='continue')){defenseTotal++;if(e.side===side)defenseWon++}
 }
 const a=counts.attack,s=counts.serve,r=counts.receive;
 const efficiency=x=>x.total&&x.resultKnown===x.total?{n:x.point-x.error,total:x.total,value:100*(x.point-x.error)/x.total}:{n:null,total:x.total,value:null};
 return {rallies:selected.length,modes,reasons,authors,touchRallies,complete,counts,
  attackEfficiency:efficiency(a),serveEfficiency:efficiency(s),positiveReceive:r.total&&r.qualityKnown===r.total?metric(r.positive,r.total):{n:null,total:r.total,value:null},
  perfectReceive:r.total&&r.qualityKnown===r.total?metric(r.perfect,r.total):{n:null,total:r.total,value:null},defenseConversion:metric(defenseWon,defenseTotal)};
}
export function captureZoneSummary(timeline,{side='ours',action='serve',set=0,player=null,rotation=null}={}){
 if(!Object.hasOwn(touchActions,action))throw Error('Выберите действие');
 const zones=Array.from({length:6},(_,i)=>({zone:i+1,count:0,point:0,error:0}));let total=0,known=0;
 for(const e of timeline){if(e.type!=='rally'||set&&e.set!==set||rotation!==null&&e.rotation[side]!==rotation)continue;for(const t of e.touches||[]){
  if(t.side!==side||t.action!==action||player&&t.player!==player)continue;total++;if(t.zone==null)continue;known++;const z=zones[t.zone-1];z.count++;if(t.result==='point')z.point++;if(t.result==='error')z.error++;
 }}
 return {zones,total,known,unknown:total-known};
}

// Across matches, sum counts rather than averaging percentages. IDs on the
// opponent side are match-local; only our stable player IDs can be combined.
export function seasonCapture(timelines,{side='ours',action='serve',player=null,rotation=null,set=0}={}){
 if(side!=='ours'&&side!=='theirs'||side==='theirs'&&player)throw Error('Выберите игрока своей команды');
 const all=timelines.flatMap(t=>t.filter(e=>e.type==='rally'&&(!set||e.set===set)&&(rotation===null||e.rotation?.[side]===rotation)));
 const summary=captureSummary(all,{side,player}),zones=captureZoneSummary(all,{side,action,player});
 return {matches:timelines.length,recordedMatches:timelines.filter(t=>t.some(e=>e.type==='rally'&&(!set||e.set===set)&&(rotation===null||e.rotation?.[side]===rotation)&&e.touches?.some(x=>x.side===side&&(!player||x.player===player)&&x.action===action))).length,summary,zones};
}
