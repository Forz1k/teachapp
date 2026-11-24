import {replayDetailed,reasons} from './match-protocol.js';
export function videoMarkers(detail,firstAt=0,{kind='',side='',playerId='',duration=Infinity}={}){
 if(!Number.isFinite(firstAt)||firstAt<0)throw Error('Введите время первого записанного события в видео, в секундах');
 const all=replayDetailed(detail).timeline.filter(e=>e.type==='rally'),anchor=Date.parse(all[0]?.at);
 const names=new Map([...detail.ourPlayers,...detail.awayPlayers].map(p=>[p.id,p.name]));
 return all.map((e,i)=>({index:i+1,set:e.set,score:e.score,seconds:firstAt+(Date.parse(e.at)-anchor)/1000,kind:e.kind,side:e.side,playerId:e.player,label:reasons[e.kind],player:names.get(e.player)||'—'})).filter(e=>(!kind||e.kind===kind)&&(!side||e.side===side)&&(!playerId||e.playerId===playerId)&&e.seconds>=0&&e.seconds<=duration);
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
 const {kind='',side='',playerId='',duration=Infinity}=filters;return all.map(m=>({...m,seconds:time(m.seconds)})).filter(m=>(!kind||m.kind===kind)&&(!side||m.side===side)&&(!playerId||m.playerId===playerId)&&m.seconds>=0&&m.seconds<=duration);
}
