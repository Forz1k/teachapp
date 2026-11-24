import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firebaseSignIn,firebasePublisher} from '../js/firebase-portal.js';
import * as P from '../js/public-publisher.js';
import {localDay} from '../js/public-portal.js';
const origin='https://demo-default-rtdb.europe-west1.firebasedatabase.app',apiKey='public_api_key_demo';
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
const calls=[];let server=null;
const fake=async (url,options={})=>{
 calls.push({url,method:options.method||'GET',body:options.body});
 if(url.includes('identitytoolkit.googleapis.com'))return json({localId:'owner1',idToken:'PRIVATE_TOKEN',refreshToken:'PRIVATE_REFRESH',expiresIn:'3600'});
 if(url.includes('securetoken.googleapis.com'))return json({user_id:'owner1',id_token:'NEW_PRIVATE',refresh_token:'NEW_REFRESH',expires_in:'3600'});
 if(options.method==='PUT'){server=JSON.parse(options.body);return new Response(null,{status:204});}
 if(options.method==='PATCH'){for(const [k,v] of Object.entries(JSON.parse(options.body))){if(v===null)delete server[k];else server[k]=v;}return new Response(null,{status:204});}
 if(options.method==='DELETE'){server=null;return json(null);}
 return json(server);
};
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('Не дождались синхронизации');};
test('REST: auth защищает запись, зрительское чтение не содержит токен, 204 допустим',async()=>{
 const s=await firebaseSignIn(apiKey,'trainer@example.org','privatePassword',fake),pub=firebasePublisher(origin,'demo',s,fake);
 await pub.write({schema:1,team:'Команда',updatedAt:1});assert.deepEqual(server.updatedAt,{'.sv':'timestamp'});assert.match(calls.at(-1).url,/auth=PRIVATE_TOKEN/);assert.equal(calls.at(-1).body.includes('PRIVATE_TOKEN'),false);
 await pub.read();assert.equal(calls.at(-1).url.includes('auth='),false);await pub.remove();assert.equal(server,null);s.close();await assert.rejects(()=>pub.write({}),/Войдите/);
});
test('Публикация выключена до явного согласия; расписание, live, отмена, завершение и отзыв',async()=>{
 const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const id='team_portal_test',start=new Date('2026-11-24T12:00:00Z').getTime(),day=localDay(start);
 P.saveFixture(id,{id:'fixture1',opponent:'Гости',startAt:start});
 const before=calls.length;await P.connectPortal(id,{origin,apiKey,email:'trainer@example.org',password:'privatePassword',slug:'public_team',team:'Команда'},fake);
 assert.equal(calls.slice(before).some(x=>x.method==='PUT'),false);
 assert.equal(P.portalInfo(id).data.enabled,false);P.setPortalEnabled(id,true,'Команда');await wait(()=>server?.team==='Команда');
 const players=Array.from({length:6},(_,i)=>({id:'a'+i,number:i+1,name:'PRIVATE '+i}));
 let d={id:'match1',teamId:id,date:day,mode:'dual',teamName:'Команда',opponent:'Гости',competition:'',venue:'',startedAt:new Date(start).toISOString(),ourPlayers:players,awayPlayers:[],roster:players.map(p=>p.id),lineup:players.map(p=>p.id),awayLineup:[],libero:null,scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'ours',events:[]};
 assert.equal(P.syncPortalMatch(d),true);await wait(()=>server?.match?.id==='match_'+start);
 const {detailEvent}=await import('../js/match-protocol.js');d=detailEvent(d,{type:'rally',side:'ours',kind:'kill',player:'a2'});P.syncPortalMatch(d);await wait(()=>server?.match?.score?.ours===1);
 assert.equal(server.match.events[0].number,undefined);assert.equal(JSON.stringify(server).includes('PRIVATE'),false);
 P.setPortalSettings(id,{numbers:true});P.syncPortalMatch(d);await wait(()=>server?.match?.events?.[0]?.number===3);
 d=detailEvent(d,null);P.syncPortalMatch(d);await wait(()=>server?.match?.score?.ours===0);
 // The same page must never serialize credentials to storage.
 assert.equal([...map.values()].join('').includes('privatePassword'),false);assert.equal([...map.values()].join('').includes('PRIVATE_TOKEN'),false);assert.equal([...map.values()].join('').includes('PRIVATE_REFRESH'),false);
 assert.ok(P.portalLink(id,'https://example.com/teachapp/').includes('/teachapp/live/'));
 P.syncPortalMatch(d,{discard:true});await wait(()=>!server?.match);P.setPortalEnabled(id,false,'Команда');await wait(()=>server===null);P.disconnectPortal(id);
});
test('Правила закрывают корень и требуют разрешённого владельца',()=>{
 const {rules}=JSON.parse(readFileSync(new URL('../firebase-portal.rules.json',import.meta.url),'utf8'));
 const r=rules.publicTeams.$uid.$slug;assert.equal(rules['.read'],false);assert.equal(rules['.write'],false);assert.equal(r['.read'],true);assert.match(r['.write'],/auth.uid === \$uid/);assert.match(r['.write'],/publishers/);assert.equal(r.$other['.validate'],false);assert.equal(r.match.$other['.validate'],false);assert.equal(r.match.events.$i.$other['.validate'],false);
});
