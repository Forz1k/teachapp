import test from 'node:test';
import assert from 'node:assert/strict';
import {sealWorkspaceBackup,openWorkspaceBackup,restoreWorkspaceData} from '../server/platform-backup.mjs';
import {dispatchWorkspace} from '../server/platform-api.mjs';
const now=1800000000000,key='f'.repeat(64),root='a'.repeat(64);
function fixture(){
 let state=null,seq=0;
 const call=(path,auth,body={})=>{
  const hash=(++seq).toString(16).padStart(64,'0');
  const result=dispatchWorkspace(state,{workspaceId:'source',method:'POST',path,auth,rootHash:root,body,issued:{id:'m-'+seq,hash,secret:hash},now});
  if(result.changed)state=result.state;return result;
 };
 const owner=call('bootstrap',root,{name:'Test'}).body.token;
 call('teams',owner,{id:'t',name:'Team',players:[{id:'p',name:'Player',number:1}]});
 call('matches',owner,{id:'m',teamId:'t',opponent:'Guest',bestOf:3,target:15,decider:15});
 const lease=call('matches/m/acquire',owner,{expectedRevision:0}).body.match;
 call('matches/m/score',owner,{expectedRevision:0,generation:lease.generation,opId:'point',side:'ours'});
 call('owner/recovery',owner,{recoveryHash:'b'.repeat(64),expectedVersion:0});
 const invite=call('invite',owner,{role:'athlete',teamId:'t',athleteId:'p',matchId:null}).body.invite;
 return {state,owner,invite,lease};
}
test('RC6 encrypted workspace backup excludes credentials, identities, pending invitations and live leases',async()=>{
 const f=fixture();
 const packet=await sealWorkspaceBackup(f.state,key,now),second=await sealWorkspaceBackup(f.state,key,now);
 assert.notEqual(packet.iv,second.iv);assert.notEqual(packet.ciphertext,second.ciphertext);
 const data=await openWorkspaceBackup(packet,key,'source');
 for(const field of ['members','invites','recoveryHash','identityHash'])assert.equal(data[field],undefined);
 assert.equal(data.matches[0].lease,null);assert.ok(data.matches[0].generation>f.lease.generation);assert.equal(data.matches[0].score.ours,1);
 assert.equal(f.state.matches[0].lease.holderId,'m-1');
 assert.ok(!JSON.stringify(data).includes(f.owner));assert.ok(!JSON.stringify(data).includes(f.invite));
 for(const change of [{...packet,createdAt:now+1},{...packet,source:'another'},{...packet,ciphertext:(packet.ciphertext[0]==='A'?'B':'A')+packet.ciphertext.slice(1)}])await assert.rejects(openWorkspaceBackup(change,key,'source'));
 await assert.rejects(openWorkspaceBackup(packet,'e'.repeat(64),'source'));
 await assert.rejects(openWorkspaceBackup(packet,key,'other'));
 const bootstrap=dispatchWorkspace(null,{workspaceId:'destination',method:'POST',path:'bootstrap',auth:root,rootHash:root,body:{name:'Fresh'},issued:{id:'new-owner',hash:'c'.repeat(64),secret:'c'.repeat(64)},now});
 const restored=restoreWorkspaceData(bootstrap,data,now);
 assert.equal(restored.state.id,'destination');assert.equal(restored.state.members.length,1);assert.equal(restored.state.members[0].id,'new-owner');assert.equal(restored.state.recoveryHash,undefined);
 assert.deepEqual(restored.state.invites,[]);assert.equal(restored.state.matches[0].score.ours,1);assert.equal(restored.state.audit.at(-1).action,'workspace.restore');
 assert.throws(()=>restoreWorkspaceData(restored,data,now),/not empty/);
});
