import test from 'node:test';
import assert from 'node:assert/strict';
import {firebaseOrigin,portalAddress,shareUrl,projectMatch,buildPortal,readPortal,portalState,countdown,matchingSchedule,archiveMatch} from '../js/public-portal.js';
import {detailEvent} from '../js/match-protocol.js';
const players=Array.from({length:6},(_,i)=>({id:'a'+i,number:i+1,name:'PRIVATE '+i}));
const away=players.map((p,i)=>({...p,id:'b'+i,name:'SECRET '+i}));
const d={id:'live_1',teamId:'private_team',date:'2026-11-24',mode:'dual',teamName:'Наши',opponent:'Гости',competition:'',venue:'PRIVATE VENUE',startedAt:'2026-11-24T12:00:00Z',ourPlayers:players,awayPlayers:away,roster:players.map(p=>p.id),lineup:players.map(p=>p.id),awayLineup:away.map(p=>p.id),libero:null,scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'ours',events:[]};
test('Публичная модель не передаёт закрытые данные, номера только по разрешению',()=>{
 const match=detailEvent(d,{type:'rally',side:'ours',kind:'tip',player:'a2',placement:4,secondary:{kind:'defenseError',player:'b2'}});
 const a=projectMatch(match),b=projectMatch(match,{numbers:true});
 assert.equal(a.score.ours,1);assert.equal(a.events[0].number,undefined);assert.equal(a.stats.length,0);assert.equal(b.events[0].number,3);assert.equal(b.stats[0].tip,1);
 const str=JSON.stringify(b);for(const value of [d.id,'PRIVATE','SECRET','private_team','placement','secondary','lineup','a2','b2'])assert.equal(str.includes(value),false,value);
 assert.equal(projectMatch(match,{events:false,numbers:false}).events.length,0);
 assert.equal(projectMatch(detailEvent(match,null)).score.ours,0);
});
test('До матча, ожидание, live и завершение выбираются по факту начала',()=>{
 const item={id:'fixture1',opponent:'Гости',startAt:100000};
 const data=buildPortal('Наши',[item],null,[],1);assert.equal(portalState(data,1).mode,'upcoming');assert.equal(portalState(data,100001).mode,'waiting');
 const live=projectMatch(d,{scheduledId:'fixture1'});assert.equal(portalState(buildPortal('Наши',[item],live,[],1),1).mode,'live');
 const finished={...live,status:'finished'};assert.equal(portalState(buildPortal('Наши',[item],finished,[],1),1).mode,'finished');
 assert.deepEqual(countdown(90061000),[1,1,1,1]);
 assert.equal(readPortal(buildPortal('Наши',[],live,[archiveMatch(finished)],1)).match.id,live.id);
});
test('Адрес Firebase проверяется, токен не входит в зрительскую ссылку',()=>{
 assert.equal(firebaseOrigin('https://demo-default-rtdb.europe-west1.firebasedatabase.app/'),'https://demo-default-rtdb.europe-west1.firebasedatabase.app');
 for(const v of ['http://demo.firebaseio.com','https://evil.com','https://demo.firebaseio.com.evil.com','https://demo.firebaseio.com/a','https://a@demo.firebaseio.com'])assert.throws(()=>firebaseOrigin(v));
 assert.throws(()=>portalAddress('https://demo.firebaseio.com','../x','a'));
 const link=shareUrl('https://example.com/teachapp/','https://demo.firebaseio.com','uid','slug');assert.equal(new URL(link).pathname,'/teachapp/live/');assert.equal(new URL(link).searchParams.get('team'),'slug');
});

test('Firebase возвращает массивы или индексированные объекты; неизвестные поля отбрасываются',()=>{
 const raw={schema:1,team:'Команда',updatedAt:10,schedule:{'1':{id:'second',opponent:'Б',startAt:20},'0':{id:'first',opponent:'А',startAt:10}},secret:'private',archive:null};
 const a=readPortal(raw);assert.deepEqual(a.schedule.map(x=>x.id),['first','second']);assert.equal(Object.hasOwn(a,'secret'),false);
 assert.equal(readPortal({...raw,schema:99}),null);
});
