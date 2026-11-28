/* Actual packaged WebKit, bounded synthetic dataset, temporary context.
 * Measures commands (not UI latency / physical device), no external network. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {webkit,devices} from 'playwright';
const root=resolve(process.argv[2]||process.cwd()),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://localhost'),file=resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+sep))throw Error('Path');const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
 browser=await webkit.launch();
 const context=await browser.newContext({...devices['iPhone 13'],locale:'ru-RU',serviceWorkers:'block'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/index.html');await page.locator('.workspace-nav').waitFor({timeout:90000});
 const result=await page.evaluate(async()=>{
  const D=await import('/js/db.js'),C=await import('/js/coach.js'),M=await import('/js/model.js'),V=await import('/js/volleyball.js');
  const teams=Array.from({length:12},(_,i)=>({id:'lab-team-'+i,name:'Synthetic '+i,archived:false}));
  const players=teams.flatMap(t=>Array.from({length:14},(_,i)=>({id:t.id+'-player-'+i,teamId:t.id,name:'Synthetic player '+i,number:i+1,position:'universal',archived:false,restrictions:[]})));
  const matches=teams.flatMap(t=>Array.from({length:100},(_,i)=>({id:t.id+'-match-'+i,teamId:t.id,date:M.todayIso(),opponent:'Synthetic opponent',competition:'',sets:[{ours:25,theirs:10}],roster:players.filter(p=>p.teamId===t.id).map(p=>p.id),stats:{}})));
  await D.bulkPut('coachTeams',teams);await D.bulkPut('coachPlayers',players);await D.bulkPut('coachMatches',matches);
  C.validateCoachData(await C.loadCoach());
  const team=teams.at(-1),roster=players.filter(p=>p.teamId===team.id),ids=roster.map(p=>p.id);
  const input={teamId:team.id,teamName:team.name,date:M.todayIso(),opponent:'Synthetic LIVE',competition:'',venue:'',roster:ids,ourPlayers:roster,awayPlayers:[],lineup:ids.slice(0,6),awayLineup:[],libero:null,scheme:'5-1',bestOf:1,target:3,decider:3,regulation:{name:'Synthetic short',winBy:2,pointCap:null,liberoInterval:'oneRally',ends:'manual',deciderSwitchAt:2},firstServe:'ours',liveTiming:true,ourSide:'right'};
  const scans=[],indexed=[],starts=[],finishes=[],rallies=[],undos=[];
  const oldAll=IDBObjectStore.prototype.getAll,oldIndex=IDBIndex.prototype.getAll;
  IDBObjectStore.prototype.getAll=function(...a){scans.push(this.name);return oldAll.apply(this,a);};
  IDBIndex.prototype.getAll=function(...a){indexed.push([this.objectStore.name,this.name,a[0]]);return oldIndex.apply(this,a);};
  try{
   for(let i=0;i<20;i++){
    let t=performance.now(),d=await C.startDetailedMatch(input);starts.push(performance.now()-t);
    t=performance.now();d=await C.changeLiveMatch(d.id,d.revision,{type:'rally',side:'ours',kind:'kill',player:ids[0],assist:ids[1]});rallies.push(performance.now()-t);
    t=performance.now();d=await C.changeLiveMatch(d.id,d.revision,null);undos.push(performance.now()-t);
    for(let n=0;n<3;n++)d=await C.changeLiveMatch(d.id,d.revision,{type:'rally',side:'ours',kind:'point'});
    if(!V.replay(d).finished)throw Error('Synthetic match not finished');
    t=performance.now();const result=await C.finishLiveMatch(d.id,d.revision);finishes.push(performance.now()-t);
    if(result.sets.length!==1||result.sets[0].ours!==3||result.sets[0].theirs!==0||await D.get('coachLive',d.id))throw Error('Atomic finish mismatch');
   }
  }finally{IDBObjectStore.prototype.getAll=oldAll;IDBIndex.prototype.getAll=oldIndex;}
  const after=await C.loadCoach();C.validateCoachData(after);
  const old=new Map(after.coachMatches.map(m=>[m.id,m])),intact=matches.every(m=>JSON.stringify(old.get(m.id))===JSON.stringify(m));
  const p95=x=>Math.round(x.slice().sort((a,b)=>a-b)[Math.ceil(x.length*.95)-1]*100)/100;
  return {archive:matches.length,teams:teams.length,players:players.length,samples:20,finished:after.coachMatches.length-matches.length,remainingDrafts:after.coachLive.length,intact,fullScans:scans,indexedReads:indexed.length,onlyTeam:indexed.every(x=>x[0]==='coachPlayers'&&x[1]==='teamId'&&x[2]===team.id),p95Ms:{start:p95(starts),finish:p95(finishes),rally:p95(rallies),undo:p95(undos)}};
 });
 assert.equal(result.archive,1200);assert.equal(result.finished,20);assert.equal(result.remainingDrafts,0);assert.equal(result.intact,true);assert.deepEqual(result.fullScans,[]);assert.equal(result.indexedReads,40);assert.equal(result.onlyTeam,true);assert.deepEqual(errors,[]);
 console.log('LIVE ARCHIVE WEBKIT PASS '+JSON.stringify(result)+' (synthetic CI, not physical-device or UI latency)');
 await context.close();
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
