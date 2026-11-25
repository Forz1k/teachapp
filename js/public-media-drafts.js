/* Private-side projection and draft helpers; never imported by public viewer. */
import {gamesOf,standings,validateTournament} from './tournaments.js';
import {uid,todayIso} from './model.js';
import {newsProjection,readPublicTournament} from './public-media.js';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
export function validateNewsDraft(r){
 if(r.kind!=='publicNewsDraft'||!id(r.id)||!id(r.teamId)||!Object.keys(r).every(k=>['kind','id','teamId','publicId','type','title','body','date'].includes(k)))throw Error('Некорректный черновик');
 newsProjection(r);return r;
}
export function newNewsDraft(teamId,input,old=null){return validateNewsDraft({kind:'publicNewsDraft',id:old?.id||uid('news'),teamId,publicId:old?.publicId||crypto.randomUUID(),type:input.type,title:input.title.trim(),body:input.body.trim(),date:input.date||todayIso()});}
export function tournamentProjection(t){
 validateTournament(t);const label=id=>t.teams.find(x=>x.id===id)?.name||'Участник определится';
 const games=gamesOf(t).filter(g=>!g.bye);if(games.length>500)throw Error('Турнир слишком большой для публикации');
 return readPublicTournament({name:t.name,system:t.system,format:t.format,rows:standings(t).map(r=>({name:r.name,place:r.place,group:r.group||0,played:r.played,won:r.won,draw:r.draw,lost:r.lost,points:r.points})),games:games.map(g=>({round:g.round,group:g.group||0,a:label(g.a),b:label(g.b),date:g.date||'',time:g.time||'',venue:g.venue||'',status:g.result?'finished':g.ready?'scheduled':'waiting',...(g.result?{score:g.result.a+':'+g.result.b}:{})}))});
}
