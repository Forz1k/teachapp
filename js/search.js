const normalize=v=>String(v??'').normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё','е').trim();
const item=(kind,id,title,detail,extra={})=>({kind,id,title:String(title??''),detail:String(detail??''),...extra});
export function searchWorkspace(area,data,query,limit=40){
 const q=normalize(query).split(/\s+/).filter(Boolean);if(!q.length)return [];
 let rows=[];
 if(area==='school'){
 const classes=new Map((data.classes||[]).map(c=>[c.id,c.name]));
 rows=[...(data.classes||[]).map(c=>item('class',c.id,c.name,'Класс')),
 ...(data.students||[]).map(s=>item('student',s.id,s.fullName,classes.get(s.classId)||'Ученик',{classId:s.classId})),
 ...(data.norms||[]).map(n=>item('norm',n.id,n.name,'Норматив')),
 ...(data.topics||[]).map(t=>item('topic',t.id,t.name,'Тема КТП'))];
 }else if(area==='coach'){
 const teams=new Map((data.coachTeams||[]).map(t=>[t.id,t]));
 const active=id=>teams.has(id)&&!teams.get(id).archived;
 rows=[...(data.coachTeams||[]).filter(t=>!t.archived).map(t=>item('team',t.id,t.name,'Команда',{teamId:t.id})),
 ...(data.coachPlayers||[]).filter(p=>active(p.teamId)&&!p.archived).map(p=>item('player',p.id,p.name,teams.get(p.teamId).name+' · № '+(p.number??'—'),{teamId:p.teamId})),
 ...(data.coachTrainings||[]).filter(t=>active(t.teamId)).map(t=>item('training',t.id,t.title,t.date+' · '+teams.get(t.teamId).name,{teamId:t.teamId})),
 ...(data.coachMatches||[]).filter(m=>active(m.teamId)).map(m=>item('match',m.id,m.opponent,m.date+' · '+teams.get(m.teamId).name,{teamId:m.teamId}))];
 }
 return rows.filter(r=>q.every(w=>normalize(r.title+' '+r.detail).includes(w))).slice(0,Math.min(100,Math.max(1,limit)));
}
