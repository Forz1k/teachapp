import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnerSessionLifecycle} from '../js/vault-owner-lifecycle.js';
class Channel extends EventTarget{
 static peers=new Set();constructor(name){super();this.name=name;Channel.peers.add(this);}
 postMessage(data){for(const peer of Channel.peers)if(peer!==this&&peer.name===this.name)peer.dispatchEvent(new MessageEvent('message',{data}));}
 close(){Channel.peers.delete(this);}
}
function env(){const documentTarget=new EventTarget(),windowTarget=new EventTarget();documentTarget.visibilityState='visible';return {documentTarget,windowTarget,Channel};}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
test('Owner gate requires explicit unlock, refuses pending/stale access and revokes peers without reopening',async t=>{
 const aEnv=env(),bEnv=env(),otherEnv=env(),events=[];let closes=0;
 const openSession=async({passwords,stillAllowed})=>{
  if(passwords.school!=='test')throw Error('wrong password');
  let closed=false;
  return {close(){if(!closed){closed=true;closes++;}},isClosed:()=>closed,async transaction(n,m,fn){assert.ok(stillAllowed());return fn();}};
 };
 const a=createOwnerSessionLifecycle({...aEnv,channelName:'owner-test',openSession,onLock:r=>events.push(r)}),b=createOwnerSessionLifecycle({...bEnv,channelName:'owner-test',openSession}),other=createOwnerSessionLifecycle({...otherEnv,channelName:'other-test',openSession});
 t.after(()=>[a,b,other].forEach(x=>x.dispose()));
 await assert.rejects(a.transaction('meta','readonly',()=>true),/заблокирован/);
 await assert.rejects(a.unlock({school:'bad'}),/wrong password/);assert.equal(a.isUnlocked(),false);
 await a.unlock({school:'test'});await b.unlock({school:'test'});await other.unlock({school:'test'});
 assert.equal(await a.transaction('meta','readonly',()=>1),1);
 const entered=deferred(),release=deferred();
 const pending=a.transaction('meta','readonly',async()=>{entered.resolve();await release.promise;return 'private';});await entered.promise;
 b.lockEveryTab();release.resolve();await assert.rejects(pending,/заблокирован/);
 assert.deepEqual(events,['remote']);assert.equal(closes,2);assert.equal(a.isUnlocked(),false);assert.equal(b.isUnlocked(),false);assert.equal(other.isUnlocked(),true);
 await assert.rejects(a.unlock({school:'test'}),/закрыт/);
});
test('Owner lifecycle closes a late authentication result and uses monotonic expiration even if timer is delayed',async t=>{
 const e=env(),ready=deferred();let close=0,clock=0;
 const a=createOwnerSessionLifecycle({...e,channelName:'pending-auth',openSession:()=>ready.promise});
 t.after(()=>a.dispose());
 const pending=a.unlock({school:'test'});e.documentTarget.visibilityState='hidden';e.documentTarget.dispatchEvent(new Event('visibilitychange'));
 ready.resolve({close:()=>close++,transaction:async()=>1});await assert.rejects(pending,/заблокирован/);assert.equal(close,1);
 const b=createOwnerSessionLifecycle({...env(),channelName:'expiry',idleMs:1000,now:()=>clock,openSession:async()=>({close:()=>close++,transaction:async()=>1})});
 t.after(()=>b.dispose());await b.unlock({school:'test'});clock=1001;assert.equal(b.isUnlocked(),false);assert.equal(close,2);
});

test('Backend authentication failure revokes the entire owner UI immediately',async t=>{
 let closed=false;const reasons=[];
 const gate=createOwnerSessionLifecycle({...env(),channelName:'backend-failed',onLock:r=>reasons.push(r),openSession:async()=>({close(){closed=true;},isClosed:()=>closed,async transaction(){closed=true;throw Error('rotated key');}})});
 t.after(()=>gate.dispose());await gate.unlock({school:'test'});
 await assert.rejects(gate.transaction('meta','readonly',()=>{}),/rotated key/);assert.equal(gate.isUnlocked(),false);assert.equal(reasons.length,1);
 await assert.rejects(gate.unlock({school:'test'}),/закрыт/);
});
