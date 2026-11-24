/* Удаление только истёкших сведений, по явному подтверждению. Оценки и история не меняются. */
import * as db from './db.js';
import * as S from './store.js';
import {todayIso,addDays} from './model.js';
const stores=['studentHealthProfiles','activityRestrictions','coachPlayers'];
function cutoff(days,today){
  if(!Number.isInteger(days)||days<1||days>3650)throw Error('Задайте срок хранения от 1 до 3650 дней');
  return addDays(today,-days);
}
async function plan(s,limit){
  const [profiles,restrictions,players]=await Promise.all(stores.map(n=>s[n].getAll()));
  const expired=r=>r.dateTo&&r.dateTo<limit;
  const p=profiles.filter(expired),r=restrictions.filter(expired),c=players.filter(x=>x.restrictions.some(expired));
  return {p,r,c,expired,summary:{profiles:p.length,restrictions:r.length,coach:c.reduce((n,x)=>n+x.restrictions.filter(expired).length,0),cutoff:limit}};
}
export async function retentionPreview(days,today=todayIso()){
  return db.transaction(stores,'readonly',async s=>(await plan(s,cutoff(days,today))).summary);
}
export async function purgeExpired(days,confirmed=false,expected=null){
  if(!confirmed)throw Error('Подтвердите удаление');
  const result=await db.transaction(stores,'readwrite',async s=>{
    const {p,r,c,expired,summary}=await plan(s,cutoff(days,todayIso()));
    if(expected&&JSON.stringify(expected)!==JSON.stringify(summary))throw Error('Данные изменились. Повторите предварительный просмотр');
    for(const x of p)await s.studentHealthProfiles.delete(x.id);
    for(const x of r)await s.activityRestrictions.delete(x.id);
    for(const x of c)await s.coachPlayers.put({...x,restrictions:x.restrictions.filter(r=>!expired(r))});
    return summary;
  });
  await S.load();return result;
}
