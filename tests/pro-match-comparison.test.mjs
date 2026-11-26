import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSummary,captureComparison} from '../js/match-capture.js';
import {detailEvent,replayDetailed} from '../js/match-protocol.js';
import {playerSeasonStats} from '../js/coach.js';

const players=Array.from({length:6},(_,i)=>({id:'a'+i,name:'Synthetic '+i,number:i+1}));
const away=Array.from({length:6},(_,i)=>({id:'b'+i,name:'Synthetic away '+i,number:i+1}));
const base={mode:'dual',teamName:'Synthetic',opponent:'Guests',competition:'',venue:'',startedAt:'2026-01-01T12:00:00Z',ourPlayers:players,awayPlayers:away,roster:players.map(p=>p.id),lineup:players.map(p=>p.id),awayLineup:away.map(p=>p.id),libero:null,scheme:'5-1',bestOf:3,target:15,decider:15,firstServe:'ours',events:[]};
const serve={side:'ours',player:'a0',action:'serve',result:'point',quality:'positive',zone:null};
const event={type:'rally',side:'ours',kind:'ace',player:'a0',captureMode:'pro',captureComplete:true,touches:[serve]};
test('PRO comparison distinguishes no attempts, insufficient volume, unknown quality and known zero',()=>{
 const full={...event,set:1,before:{serve:'ours',lineups:{ours:['a0'],theirs:['b0']}}};
 const partial={...full,captureComplete:false};
 const small=captureComparison(captureSummary([full,partial],{player:'a0'}));
 assert.equal(small.complete,1);assert.deepEqual(small.metrics.serveEfficiency,{total:1,n:1,value:null,status:'small'});
 assert.equal(small.metrics.attackEfficiency.status,'empty');
 const received={type:'rally',set:1,side:'theirs',kind:'point',before:{serve:'theirs',lineups:{ours:['a0'],theirs:['b0']}},captureComplete:true,touches:[{...serve,side:'theirs',player:'b0',result:'continue'},{...serve,action:'receive',result:'continue',quality:'unknown'},{...serve,side:'theirs',player:'b0',action:'attack',result:'point'}]};
 assert.equal(captureComparison(captureSummary(Array(10).fill(received),{player:'a0'})).metrics.positiveReceive.status,'unknown');
 const error={...full,kind:'serveError',side:'theirs',touches:[{...serve,result:'error'}]};
 assert.deepEqual(captureComparison(captureSummary([...Array(5).fill(full),...Array(5).fill(error)],{player:'a0'})).metrics.serveEfficiency,{total:10,n:0,value:0,status:'comparable'});
 assert.throws(()=>captureComparison(captureSummary([]),0),/число попыток/);
});
test('Player comparison uses only complete observed rallies in detailed matches, never manual or other-player samples',()=>{
 let d=base;for(let i=0;i<10;i++)d=detailEvent(d,event);
 d=detailEvent(d,{type:'rally',side:'ours',kind:'ace',player:'a0'}); // no complete record
 const state=replayDetailed(d);
 const detailed={id:'detail',date:'2026-01-01',opponent:'Guests',roster:base.roster,detail:d,stats:state.stats};
 const manual={id:'manual',date:'2026-01-02',opponent:'Guests',roster:['a0'],stats:{a0:{serves:50,serveErrors:0}}};
 const s=playerSeasonStats([detailed,manual],'a0');
 assert.equal(s.captureMatches.length,1);assert.equal(s.captureMatches[0].matchId,'detail');assert.equal(s.captureMatches[0].complete,10);assert.equal(s.captureMatches[0].rallies,11);
 assert.deepEqual(s.captureMatches[0].metrics.serveEfficiency,{total:10,n:10,value:100,status:'comparable'});
 assert.equal(s.rates.serve.total,50);
 assert.equal(playerSeasonStats([detailed],'a1').captureMatches[0].metrics.serveEfficiency.status,'empty');
});
