import test from 'node:test';import assert from 'node:assert/strict';import {mediaProjection,newsProjection,mediaTarget} from '../js/public-media.js';import {newNewsDraft,tournamentProjection} from '../js/public-media-drafts.js';import {makeTournament} from '../js/tournaments.js';
test('draft projection strips local fields and keeps only explicit public text',()=>{const d=newNewsDraft('private_team',{type:'news',title:'Title',body:'Body',date:'2026-11-25'}),p=newsProjection(d);assert.equal(p.teamId,undefined);assert.equal(p.id,undefined);assert.equal(p.kind,undefined);assert.throws(()=>mediaProjection({news:Array(21).fill(p)}));assert.throws(()=>mediaProjection({news:[p,p]}));assert.throws(()=>newsProjection({...p,body:'x'.repeat(2001)}));});
test('tournament projection contains names and scores, not internal IDs',()=>{const t=makeTournament({name:'Cup',system:'league',format:'score',bestOf:1,target:25,decider:15,names:['A','B']});const p=tournamentProjection(t);assert.equal(p.rows.length,2);assert.equal(p.games.length,1);assert.ok(!JSON.stringify(p).includes(t.id));assert.ok(!JSON.stringify(p).includes(t.teams[0].id));assert.equal(mediaTarget('https://demo.firebaseio.com/publicTeams/u/s.json'),'https://demo.firebaseio.com/publicMedia/u/s.json');assert.throws(()=>mediaTarget('https://evil.com/publicTeams/u/s.json'));});

test('public viewer module does not import private draft or tournament modules',async()=>{const {readFileSync}=await import('node:fs');const code=readFileSync(new URL('../js/public-media.js',import.meta.url),'utf8');assert.doesNotMatch(code,/from ['"]\.\/tournaments|from ['"]\.\/db|from ['"]\.\/public-media-drafts/);assert.throws(()=>mediaTarget('https://user@demo.firebaseio.com/publicTeams/u/s.json'));});

test('public tournament excludes private referee field',async()=>{const {applyGame,gamesOf}=await import('../js/tournaments.js');let t=makeTournament({name:'Cup',system:'league',format:'score',bestOf:1,target:25,decider:15,names:['A','B']});t=applyGame(t,gamesOf(t)[0].id,{referee:'PRIVATE REFEREE'});assert.equal(tournamentProjection(t).games[0].referee,undefined);assert.ok(!JSON.stringify(tournamentProjection(t)).includes('PRIVATE REFEREE'));});

import {readMediaWire,readMediaVersion,writePublicMedia,removePublicMedia,fetchPublicMedia} from '../js/public-media.js';
const wireNews={publicId:'a',type:'news',title:'Title',body:'Body',date:'2026-11-25'};
test('media reader rejects unknown or sparse wire content before any replacement',()=>{
 assert.deepEqual(readMediaWire(null),{schema:1,news:[]});assert.deepEqual(readMediaWire({schema:1}),{schema:1,news:[]});
 assert.deepEqual(readMediaWire({schema:1,news:{0:wireNews}}),{schema:1,news:[wireNews]});
 for(const invalid of [{schema:1,private:'secret'},{schema:1,news:{1:wireNews}},{schema:1,news:[{...wireNews,private:'secret'}]},{schema:1,news:[wireNews,wireNews]},{schema:1,news:'bad'},{schema:2},{schema:1,tournament:{name:'Cup'}}])assert.throws(()=>readMediaWire(invalid));
 const t=tournamentProjection(makeTournament({name:'Cup',system:'league',format:'score',bestOf:1,target:25,decider:15,names:['A','B']}));
 assert.deepEqual(readMediaWire({schema:1,tournament:t}),{schema:1,news:[],tournament:t});
 assert.throws(()=>readMediaWire({schema:1,tournament:{...t,games:[{...t.games[0],score:'1:2'}]}}));
});
test('media write and purge verify readback, do not retry CAS or expose token to an untrusted origin',async()=>{
 const target=mediaTarget('https://demo.firebaseio.com/publicTeams/u/s.json');let state=null,etag='a',writes=0,calls=0,ignore=false;
 const fetcher=async(url,opt)=>{
  calls++;assert.equal(new URL(url).searchParams.get('auth'),'synthetic');assert.equal(opt.referrerPolicy,'no-referrer');
  if(opt.method){writes++;if(opt.headers['If-Match']!==etag)return new Response('{}',{status:412});if(!ignore){state=opt.method==='DELETE'?null:JSON.parse(opt.body);etag+='a';}}
  return new Response(JSON.stringify(state),{headers:{ETag:etag}});
 };
 const before=await readMediaVersion(target,fetcher,'synthetic');assert.equal(before.exists,false);
 const next=await writePublicMedia(target,{news:[wireNews]},'synthetic',before.etag,fetcher);assert.equal(next.exists,true);assert.equal(next.value.news[0].title,'Title');
 await assert.rejects(removePublicMedia(target,'synthetic',before.etag,fetcher),e=>e.status===412);
 assert.equal(writes,2);
 ignore=true;await assert.rejects(removePublicMedia(target,'synthetic',next.etag,fetcher),e=>e.status===412);
 await assert.rejects(writePublicMedia(target,{news:[{...wireNews,title:'Changed'}]},'synthetic',next.etag,fetcher),e=>e.status===412);
 ignore=false;assert.equal((await removePublicMedia(target,'synthetic',next.etag,fetcher)).exists,false);
 const count=calls;await assert.rejects(writePublicMedia('https://evil.test/publicMedia/u/s.json',{news:[]},'synthetic','a',fetcher));await assert.rejects(fetchPublicMedia(target+'?auth=x',fetcher));assert.equal(calls,count);
});

import {planMediaNews,planMediaTournament} from '../js/public-media.js';
test('media news preview binds exact replacement and preserves other public content',()=>{
 const t=tournamentProjection(makeTournament({name:'Cup',system:'league',format:'score',bestOf:1,target:25,decider:15,names:['A','B']}));
 const current=mediaProjection({news:[wireNews,{...wireNews,publicId:'b'}],tournament:t});
 const plan=planMediaNews(current,{...wireNews,title:'New',teamId:'private'});
 assert.equal(plan.previous.title,'Title');assert.equal(plan.item.title,'New');assert.equal(plan.item.teamId,undefined);assert.equal(plan.changed,true);
 assert.deepEqual(plan.next.tournament,t);assert.equal(plan.next.news.length,2);assert.equal(current.news[0].title,'Title');
 assert.equal(planMediaNews(current,wireNews).changed,false);
 const full=mediaProjection({news:Array.from({length:20},(_,i)=>({...wireNews,publicId:'n'+i}))});
 assert.throws(()=>planMediaNews(full,wireNews));assert.equal(planMediaNews(full,{...wireNews,publicId:'n0',title:'New'}).next.news.length,20);
});
test('tournament preview preserves news and identifies unchanged publication',()=>{
 const t=tournamentProjection(makeTournament({name:'Cup',system:'league',format:'score',bestOf:1,target:25,decider:15,names:['A','B']}));
 const current=mediaProjection({news:[wireNews],tournament:t});
 assert.equal(planMediaTournament(current,t).changed,false);
 const plan=planMediaTournament(current,{...t,name:'Final'});assert.equal(plan.previous.name,'Cup');assert.equal(plan.item.name,'Final');assert.deepEqual(plan.next.news,[wireNews]);assert.equal(current.tournament.name,'Cup');
});

import {newsDraftStatus} from '../js/public-media.js';
test('media draft statuses distinguish unread, unpublished, identical and edited projections',()=>{
 const version={etag:'base',exists:true,value:mediaProjection({news:[wireNews]})};
 const draft={...wireNews,id:'local',teamId:'private',kind:'publicNewsDraft'};
 assert.equal(newsDraftStatus(draft,null),'unknown');
 assert.equal(newsDraftStatus(draft,{etag:'empty',exists:false,value:mediaProjection(null)}),'local');
 assert.equal(newsDraftStatus(draft,version),'published');
 assert.equal(newsDraftStatus({...draft,title:'Edited'},version),'changed');
 assert.equal(newsDraftStatus({...draft,publicId:'b'},version),'local');
 assert.throws(()=>newsDraftStatus(draft,{value:{schema:2}}));
});
