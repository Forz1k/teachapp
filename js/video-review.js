import {replayDetailed,reasons} from './match-protocol.js';
export function videoMarkers(detail,firstAt=0,{kind='',side='',playerId='',duration=Infinity}={}){
 if(!Number.isFinite(firstAt)||firstAt<0)throw Error('Введите время первого записанного события в видео, в секундах');
 const all=replayDetailed(detail).timeline.filter(e=>e.type==='rally'),anchor=Date.parse(all[0]?.at);
 const names=new Map([...detail.ourPlayers,...detail.awayPlayers].map(p=>[p.id,p.name]));
 return all.map((e,i)=>({index:i+1,set:e.set,score:e.score,seconds:firstAt+(Date.parse(e.at)-anchor)/1000,kind:e.kind,side:e.side,playerId:e.player,label:reasons[e.kind],player:names.get(e.player)||'—'})).filter(e=>(!kind||e.kind===kind)&&(!side||e.side===side)&&(!playerId||e.playerId===playerId)&&e.seconds>=0&&e.seconds<=duration);
}
