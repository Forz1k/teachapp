import {replayDetailed,reasons} from './match-protocol.js';
export function videoMarkers(detail,firstAt=0,{kind='',side='',playerId='',duration=Infinity,set=0}={}){
 if(!Number.isFinite(firstAt)||firstAt<0)throw Error('Введите время первого записанного события в видео, в секундах');
 const all=replayDetailed(detail).timeline.filter(e=>e.type==='rally'),anchor=Date.parse(all[0]?.at);
 const names=new Map([...detail.ourPlayers,...detail.awayPlayers].map(p=>[p.id,p.name]));
 return all.map((e,i)=>({index:i+1,set:e.set,score:e.score,seconds:firstAt+(Date.parse(e.at)-anchor)/1000,alignment:'recorded',kind:e.kind,side:e.side,playerId:e.player,label:reasons[e.kind],player:names.get(e.player)||'—'})) .filter(e=>(!set||e.set===set)&&(!kind||e.kind===kind)&&(!side||e.side===side)&&(!playerId||e.playerId===playerId)&&e.seconds>=0&&e.seconds<=duration);
}

// Video calibration is private metadata only. A local file is never serialized.
export function validateVideoReview(r){
 if(!r||r.kind!=='videoReview'||typeof r.id!=='string'||!r.id||typeof r.matchId!=='string'||!r.matchId||Object.keys(r).some(k=>!['id','kind','matchId','anchors','notes'].includes(k))||!Array.isArray(r.anchors)||r.anchors.length>30||!Array.isArray(r.notes)||r.notes.length>500)throw Error('Некорректная запись видеоразбора');
 let last=0,seconds=-1;for(const a of r.anchors){if(!a||Object.keys(a).some(k=>!['index','seconds'].includes(k))||!Number.isInteger(a.index)||a.index<=last||!Number.isFinite(a.seconds)||a.seconds<0||a.seconds<=seconds)throw Error('Контрольные точки должны возрастать по времени и номеру розыгрыша');last=a.index;seconds=a.seconds;}
 const indices=new Set();for(const n of r.notes){if(!n||Object.keys(n).some(k=>!['index','text','favorite'].includes(k))||!Number.isInteger(n.index)||n.index<1||indices.has(n.index)||typeof n.text!=='string'||n.text.length>2000||typeof n.favorite!=='boolean')throw Error('Некорректная заметка');indices.add(n.index);}return r;
}
export function calibratedMarkers(detail,anchors=[],filters={}){
 const all=videoMarkers(detail,0,{});if(!anchors.length)return videoMarkers(detail,0,filters);validateVideoReview({id:'x',kind:'videoReview',matchId:'x',anchors,notes:[]});
 if(anchors.some(a=>a.index>all.length))throw Error('Контрольная точка отсутствует в протоколе');
 const points=anchors.map(a=>({...a,recorded:all[a.index-1].seconds}));for(let i=1;i<points.length;i++)if(points[i].recorded<=points[i-1].recorded)throw Error('Контрольные точки должны иметь различное время записи');
 const time=t=>{let a=points[0],b=points.at(-1);if(t<=a.recorded)return a.seconds+t-a.recorded;if(t>=b.recorded)return b.seconds+t-b.recorded;for(let i=1;i<points.length;i++){if(points[i].recorded>=t){a=points[i-1];b=points[i];break;}}return a.seconds+(t-a.recorded)*(b.seconds-a.seconds)/(b.recorded-a.recorded);};
 const exact=new Map(anchors.map(a=>[a.index,a.seconds]));
 const {kind='',side='',playerId='',duration=Infinity,set=0}=filters;return all.map(m=>({...m,seconds:exact.get(m.index)??time(m.seconds),alignment:exact.has(m.index)?'manual':m.index>anchors[0].index&&m.index<anchors.at(-1).index?'interpolated':'extrapolated'})).filter(m=>(!set||m.set===set)&&(!kind||m.kind===kind)&&(!side||m.side===side)&&(!playerId||m.playerId===playerId)&&m.seconds>=0&&m.seconds<=duration);
}

// Imported PDF contains a sequential score journal, but no timestamps per rally.
 // Manual anchors are the only seekable positions. Never interpolate by rally index.
const importedKinds={attackKills:'kill',blocks:'block',aces:'ace',serveErrors:'serveError',attackErrors:'attackError',receiveErrors:'receiveError',otherErrors:'otherError',unknown:'point'};
export function importedVideoMarkers(match,anchors=[],{kind='',side='',playerId='',duration=Infinity,set=0,players=[]}={}){
 if(!match?.imported||!Array.isArray(match.imported.rallies))throw Error('Выберите импортированный протокол VolleyPoint');
 validateVideoReview({id:'x',kind:'videoReview',matchId:'x',anchors,notes:[]});
 const all=match.imported.rallies;if(anchors.some(a=>a.index>all.length))throw Error('Контрольная точка отсутствует в протоколе');
 const byIndex=new Map(anchors.map(a=>[a.index,a.seconds])),names=new Map(players.map(p=>[p.id,p.name]));
 return all.map((r,i)=>{const index=i+1,seconds=byIndex.get(index)??null,k=importedKinds[r.kind];return {index,set:r.set,score:r.ours+':'+r.theirs,seconds,alignment:seconds===null?'unlinked':'manual',kind:k,side:r.winner,playerId:r.playerId,label:reasons[k]||'Другое',player:names.get(r.playerId)||'Автор не сохранён',outsideVideo:seconds!==null&&seconds>duration};}).filter(e=>(!set||e.set===set)&&(!kind||e.kind===kind)&&(!side||e.side===side)&&(!playerId||e.playerId===playerId));
}

// Local clip range only; never stores or uploads the underlying recording.
export function clipRange(start,end,duration){
 if(![start,end,duration].every(Number.isFinite)||start<0||end>duration||end-start<1||end-start>30)throw Error('Укажите отрезок от 1 до 30 секунд в пределах видео');
 return {start,end,seconds:end-start};
}
export function clipAround(seconds,duration,before=5,after=5){
 if(!Number.isFinite(seconds)||!Number.isFinite(duration)||seconds<0||seconds>duration)throw Error('Некорректное положение видео');
 return clipRange(Math.max(0,seconds-before),Math.min(duration,seconds+after),duration);
}

/** Time-based stepping, not a frame-number guarantee (video FPS may vary). */
export const videoReviewRates=[0.25,0.5,0.75,1,1.25,1.5,2];
export function videoSeekStep(current,duration,delta){
 if(![current,duration,delta].every(Number.isFinite)||duration<=0||current<0||current>duration||Math.abs(delta)>30)throw Error('Некорректное положение видео');
 return Math.min(duration,Math.max(0,current+delta));
}

/** A/B rehearsal is independent of export and never persisted or uploaded. */
export function videoLoopRange(start,end,duration){
 if(![start,end,duration].every(Number.isFinite)||duration<=0||start<0||end>duration||end-start<.5||end-start>120)throw Error('Выберите отрезок от 0,5 до 120 секунд в пределах видео');
 return {start,end};
}
export function videoLoopSeek(range,current,duration,{playing=false,ended=false}={}){
 if(!range||!Number.isFinite(current)||!Number.isFinite(duration)||duration<=0||range.end>duration||(!playing&&!ended))return null;
 return current>=range.end||current<range.start?range.start:null;
}
