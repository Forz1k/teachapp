/* Isolated synthetic workspace service. State and authorization decisions live
 * inside one workspace transaction. No access to the personal relay or Firebase. */
import {authorizeWorkspace,assistantProjection,athleteProjection} from './workspace-policy.mjs';
export const BODY_LIMIT=64*1024, STATE_LIMIT=512*1024;
const DAY=86400000,LEASE_MS=45000,INVITE_MS=600000;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const str=(x,n=100)=>typeof x==='string'&&x.trim()===x&&x.length>=1&&x.length<=n&&!/[\x00-\x1f\x7f]/.test(x);
const int=(x,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const time=x=>typeof x==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(x);
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.slice().sort().join(',');
const uniq=a=>new Set(a).size===a.length;
const clone=x=>structuredClone(x);
const err=(status,error)=>({status,body:{error}});
const ok=(body,status=200,changed=false)=>({status,body,changed});
const exists=(rows,key)=>rows.find(x=>x.id===key);
const require=(condition,status,error)=>{if(!condition)throw {status,error};};
const publicMember=m=>({id:m.id,role:m.role,teamIds:m.teamIds,matchIds:m.matchIds,teamId:m.teamId,athleteId:m.athleteId,expiresAt:m.expiresAt,revokedAt:m.revokedAt});
const publicMatch=(m,now)=>({id:m.id,teamId:m.teamId,opponent:m.opponent,status:m.status,revision:m.revision,set:m.set,score:clone(m.score),sets:clone(m.sets),lease:m.lease&&m.lease.until>now?{holderId:m.lease.holderId,generation:m.generation,until:m.lease.until}:null,generation:m.generation});
const resource=(s,type,fields={})=>({workspaceId:s.id,type,...fields});
function allowed(s,member,action,r){if(member.role==='assistant'&&action==='team.roster'&&!s.matches.some(m=>m.teamId===r.teamId&&m.status==='live'&&member.matchIds.includes(m.id)))return false;return authorizeWorkspace({id:member.id},{...member,userId:member.id,workspaceId:s.id,revoked:member.revokedAt!==null},r,action);}
function audit(s,member,action,target,now){s.audit.push({at:now,actorId:member.id,action,target});if(s.audit.length>200)s.audit.splice(0,s.audit.length-200);}
function memberByHash(s,auth,now){return s.members.find(m=>m.tokenHash===auth&&m.revokedAt===null&&m.expiresAt>now);}
function validateRoster(body){require(exact(body,['id','name','players'])&&id(body.id)&&str(body.name)&&Array.isArray(body.players)&&body.players.length<=64,400,'team');require(body.players.every(p=>exact(p,['id','name','number'])&&id(p.id)&&str(p.name)&&int(p.number,0,99))&&uniq(body.players.map(p=>p.id))&&uniq(body.players.map(p=>p.number)),400,'roster');}
function validateAthlete(body){require(exact(body,['expectedRevision','goals','assignments','schedule'])&&int(body.expectedRevision)&&['goals','assignments','schedule'].every(k=>Array.isArray(body[k])&&body[k].length<=32&&uniq(body[k].map(x=>x?.id))),400,'athlete');
 require(body.goals.every(g=>exact(g,['id','name','status','to'])&&id(g.id)&&str(g.name,160)&&['active','done','paused'].includes(g.status)&&date(g.to)),400,'goals');
 require(body.assignments.every(g=>exact(g,['id','name','due','status'])&&id(g.id)&&str(g.name,160)&&date(g.due)&&['open','done','review'].includes(g.status)),400,'assignments');
 require(body.schedule.every(g=>exact(g,['id','date','time','title'])&&id(g.id)&&date(g.date)&&time(g.time)&&str(g.title,160)),400,'schedule');}
function inviteScope(s,b){require(exact(b,['role','teamId','athleteId','matchId'])&&['coach','assistant','athlete'].includes(b.role)&&id(b.teamId),400,'role');const team=exists(s.teams,b.teamId);require(team,404,'team');
 if(b.role==='athlete'){require(b.matchId===null&&id(b.athleteId)&&team.players.some(p=>p.id===b.athleteId),400,'athlete');return {role:'athlete',teamId:team.id,athleteId:b.athleteId,teamIds:[],matchIds:[]};}
 require(b.athleteId===null,400,'scope');
 if(b.role==='assistant'){const m=exists(s.matches,b.matchId);require(m&&m.teamId===team.id&&m.status==='live',400,'match');return {role:'assistant',teamId:team.id,athleteId:null,teamIds:[team.id],matchIds:[m.id]};}
 require(b.matchId===null,400,'scope');return {role:'coach',teamId:team.id,athleteId:null,teamIds:[team.id],matchIds:[]};}
function makeMember(s,scope,newId,tokenHash,now){require(id(newId)&&hash(tokenHash)&&!exists(s.members,newId)&&!s.members.some(m=>m.tokenHash===tokenHash)&&tokenHash!==s.recoveryHash&&!s.invites.some(i=>i.hash===tokenHash)&&s.members.length<128,409,'member-limit');const m={id:newId,...scope,tokenHash,expiresAt:now+7*DAY,revokedAt:null};s.members.push(m);return m;}
// Only known credentials get persistent rate buckets; arbitrary invalid tokens
// must not fill the database or exhaust a valid member's budget.
export function workspaceRatePolicy(s,{auth,rootHash,method,path,now}){
 if(!s||!hash(auth)||!int(now))return null;
 if(method==='POST'&&path==='recover'&&hash(s.recoveryHash)&&auth===s.recoveryHash&&auth!==rootHash)return {key:'recovery',limit:6};
 if(method==='POST'&&path==='redeem'&&s.invites.some(i=>i.hash===auth&&i.usedAt===null&&i.expiresAt>now))return {key:'redeem',limit:64};
 const actor=memberByHash(s,auth,now);if(!actor)return null;
 const kind=method==='GET'?'read':/^(owner\/recovery|invite|invites\/cancel|revoke|members\/prune|session\/revoke)$/.test(path)?'access':'write';
 return {key:'member:'+actor.id+':'+kind,limit:kind==='read'?240:kind==='access'?24:180};
}
/** Rolling fixed-minute windows, bounded retry interval; a clock regression
 * cannot reset an existing bucket prematurely. */
export function consumeWorkspaceRate(policy,bucket,now){
 if(!policy)return null;
 const start=bucket&&now<bucket.start+60000?bucket.start:now,count=bucket&&start===bucket.start?bucket.count:0;
 if(count>=policy.limit)return {allowed:false,start,count,retryAfter:Math.min(60,Math.max(1,Math.ceil((start+60000-now)/1000)))};
 return {allowed:true,start,count:count+1,retryAfter:0};
}
function releaseMemberLeases(s,ids){for(const m of s.matches)if(ids.has(m.lease?.holderId)){m.lease=null;m.generation++;}}
function leaseFor(m,actor,body,now){require(m.status==='live',409,'finished');require(m.lease&&m.lease.until>now&&m.lease.holderId===actor.id&&body.generation===m.generation,409,'lease');}
function exactRevision(m,revision){require(int(revision)&&revision===m.revision,409,'revision');}
function validateSetScore(m){const target=m.set===m.bestOf?m.decider:m.target;return Math.max(m.score.ours,m.score.theirs)>=target&&Math.abs(m.score.ours-m.score.theirs)>=2;}
/** The adapter must commit returned state atomically, only if changed. Tokens
 * and request bodies are already bounded and hashed by the HTTP entrypoint. */
export function dispatchWorkspace(current,{workspaceId,method,path,auth,rootHash,body,issued,now}){
 const s=current?clone(current):null;
 try{
  require(id(workspaceId)&&hash(auth)&&int(now),401,'unauthorized');
  if(method==='POST'&&path==='bootstrap'){
   require(auth===rootHash&&hash(rootHash),401,'unauthorized');require(!s,409,'exists');require(exact(body,['name'])&&str(body.name),400,'workspace');
   const created={id:workspaceId,name:body.name,members:[],invites:[],teams:[],athletes:[],matches:[],audit:[]};
   const m=makeMember(created,{role:'owner',teamId:null,athleteId:null,teamIds:[],matchIds:[]},issued.id,issued.hash,now);audit(created,m,'workspace.bootstrap',workspaceId,now);
   return {...ok({workspaceId,member:publicMember(m),token:issued.secret},201,true),state:created};
  }
  // Unknown workspaces do not disclose their existence to unauthenticated callers.
  require(s&&s.id===workspaceId,401,'unauthorized');
  if(method==='POST'&&path==='recover'){
   require(exact(body,[])&&hash(s.recoveryHash)&&auth===s.recoveryHash&&auth!==rootHash,401,'unauthorized');
   const oldOwners=new Set(s.members.filter(m=>m.role==='owner').map(m=>m.id));
   s.members=s.members.filter(m=>m.role!=='owner');
   s.invites=s.invites.filter(i=>!oldOwners.has(i.issuerId));
   for(const m of s.matches)if(oldOwners.has(m.lease?.holderId)){m.lease=null;m.generation++;}
   const owner=makeMember(s,{role:'owner',teamId:null,athleteId:null,teamIds:[],matchIds:[]},issued.id,issued.hash,now);audit(s,owner,'workspace.recover',s.id,now);
   require(new TextEncoder().encode(JSON.stringify(s)).length<=STATE_LIMIT,409,'workspace-limit');
   return {...ok({workspaceId:s.id,member:publicMember(owner),token:issued.secret},201,true),state:s};
  }
  if(method==='POST'&&path==='redeem'){
   require(exact(body,[]),400,'packet');const invite=s.invites.find(i=>i.hash===auth&&i.usedAt===null&&i.expiresAt>now);
   require(invite,401,'unauthorized');const issuer=exists(s.members,invite.issuerId);require(issuer&&issuer.role==='owner'&&issuer.revokedAt===null&&issuer.expiresAt>now,401,'unauthorized');
   // Revalidate current resource binding: an invitation cannot outlive a removed/finished assignment.
   const scope=inviteScope(s,{role:invite.scope.role,teamId:invite.scope.teamId,athleteId:invite.scope.athleteId,matchId:invite.scope.matchIds[0]??null});
   const m=makeMember(s,scope,issued.id,issued.hash,now);invite.usedAt=now;audit(s,m,'member.redeem',m.id,now);require(new TextEncoder().encode(JSON.stringify(s)).length<=STATE_LIMIT,409,'workspace-limit');return {...ok({workspaceId,member:publicMember(m),token:issued.secret},201,true),state:s};
  }
  const actor=memberByHash(s,auth,now);require(actor,401,'unauthorized');
  const owner=()=>require(allowed(s,actor,'workspace.manage',resource(s,'workspace')),403,'forbidden');
  const result=()=>{
   if(method==='GET'&&path==='me')return ok({workspaceId:s.id,name:s.name,member:publicMember(actor)});
   if(method==='GET'&&path==='owner/recovery'){owner();return ok({configured:hash(s.recoveryHash),version:s.recoveryVersion??0});}
   if(method==='POST'&&path==='owner/recovery'){
    owner();require(exact(body,['recoveryHash','expectedVersion'])&&hash(body.recoveryHash)&&int(body.expectedVersion),400,'recovery');
    require(body.expectedVersion===(s.recoveryVersion??0),409,'revision');
    require(body.recoveryHash!==rootHash&&!s.members.some(m=>m.tokenHash===body.recoveryHash)&&!s.invites.some(i=>i.hash===body.recoveryHash)&&body.recoveryHash!==s.recoveryHash,400,'recovery');
    s.recoveryHash=body.recoveryHash;s.recoveryVersion=body.expectedVersion+1;audit(s,actor,'workspace.recovery.configure',s.id,now);
    return ok({configured:true,version:s.recoveryVersion},200,true);
   }
   if(method==='GET'&&path==='members'){owner();return ok({members:s.members.map(publicMember)});}
   if(method==='POST'&&path==='session/revoke'){
    require(exact(body,[]),400,'packet');
    // An owner may end the server session only with an independent recovery code configured.
    require(actor.role!=='owner'||hash(s.recoveryHash),409,'recovery-required');
    actor.revokedAt=now;s.invites=s.invites.filter(i=>i.issuerId!==actor.id);releaseMemberLeases(s,new Set([actor.id]));audit(s,actor,'session.revoke',actor.id,now);return ok({revoked:true},200,true);
   }
   if(method==='GET'&&path==='members/prunable'){
    owner();return ok({members:s.members.filter(m=>m.role!=='owner'&&(m.revokedAt!==null||m.expiresAt<=now)).map(publicMember)});
   }
   if(method==='POST'&&path==='members/prune'){
    owner();require(exact(body,['memberIds'])&&Array.isArray(body.memberIds)&&body.memberIds.length>0&&body.memberIds.length<=128&&body.memberIds.every(id)&&uniq(body.memberIds),400,'packet');
    const ids=new Set(body.memberIds);
    require(body.memberIds.every(k=>{const m=exists(s.members,k);return m&&m.role!=='owner'&&(m.revokedAt!==null||m.expiresAt<=now);}),409,'member-changed');
    releaseMemberLeases(s,ids);s.members=s.members.filter(m=>!ids.has(m.id));s.invites=s.invites.filter(i=>!ids.has(i.issuerId));
    audit(s,actor,'member.prune',String(ids.size),now);return ok({removed:ids.size},200,true);
   }
   if(method==='GET'&&path==='audit'){owner();return ok({events:s.audit.slice().reverse()});}
   if(method==='GET'&&path==='invites'){owner();return ok({invites:s.invites.filter(i=>i.usedAt===null&&i.expiresAt>now).map(i=>({id:i.id,role:i.scope.role,teamId:i.scope.teamId,athleteId:i.scope.athleteId,matchId:i.scope.matchIds[0]??null,expiresAt:i.expiresAt}))});}
   if(method==='POST'&&path==='invites/cancel'){
    owner();require(exact(body,['inviteId'])&&id(body.inviteId),400,'packet');const i=s.invites.find(x=>x.id===body.inviteId&&x.usedAt===null&&x.expiresAt>now);require(i,404,'invite');s.invites=s.invites.filter(x=>x!==i);audit(s,actor,'member.invite.cancel',i.id,now);return ok({cancelled:true},200,true);
   }
   if(method==='POST'&&path==='invite'){
    owner();const scope=inviteScope(s,body);s.invites=s.invites.filter(i=>i.usedAt===null&&i.expiresAt>now);require(s.invites.length<64,409,'invite-limit');require(!s.invites.some(i=>i.hash===issued.hash)&&!s.members.some(m=>m.tokenHash===issued.hash)&&issued.hash!==s.recoveryHash,409,'collision');s.invites.push({id:issued.id,hash:issued.hash,scope,issuerId:actor.id,expiresAt:now+INVITE_MS,usedAt:null});audit(s,actor,'member.invite',issued.id,now);return ok({invite:issued.secret,expiresAt:now+INVITE_MS},201,true);
   }
   if(method==='POST'&&path==='revoke'){
    owner();require(exact(body,['memberId'])&&id(body.memberId),400,'packet');const m=exists(s.members,body.memberId);require(m&&m.role!=='owner',404,'member');if(m.revokedAt!==null)return ok({member:publicMember(m)});
    m.revokedAt=now;for(const match of s.matches)if(match.lease?.holderId===m.id){match.lease=null;match.generation++;}
    audit(s,actor,'member.revoke',m.id,now);return ok({member:publicMember(m)},200,true);
   }
   if(method==='GET'&&path==='teams'){
    require(['owner','coach','assistant'].includes(actor.role),403,'forbidden');return ok({teams:s.teams.filter(t=>allowed(s,actor,'team.roster',resource(s,'team',{teamId:t.id}))||allowed(s,actor,'team.read',resource(s,'team',{teamId:t.id}))).map(t=>({id:t.id,name:t.name}))});
   }
   if(method==='GET'&&path==='matches'){
    require(['owner','coach','assistant'].includes(actor.role),403,'forbidden');return ok({matches:s.matches.filter(m=>{const ref=resource(s,'match',{teamId:m.teamId,matchId:m.id,status:m.status});return allowed(s,actor,'team.read',ref)||allowed(s,actor,'match.score',ref);}).map(m=>publicMatch(m,now))});
   }
   if(method==='POST'&&path==='teams'){
    owner();validateRoster(body);require(!exists(s.teams,body.id)&&s.teams.length<12,409,'team-limit');s.teams.push(clone(body));audit(s,actor,'team.create',body.id,now);return ok({team:assistantProjection(body)},201,true);
   }
   let r=/^teams\/([A-Za-z0-9_-]{1,64})\/roster$/.exec(path);
   if(r&&method==='GET'){
    const ref=resource(s,'team',{teamId:r[1]});require(allowed(s,actor,'team.roster',ref)||allowed(s,actor,'team.read',ref),403,'forbidden');const team=exists(s.teams,r[1]);require(team,404,'resource');return ok({team:assistantProjection(team)});
   }
   r=/^teams\/([A-Za-z0-9_-]{1,64})\/athletes\/([A-Za-z0-9_-]{1,64})(\/respond)?$/.exec(path);
   if(r){
    const athleteId=r[2],ref=resource(s,'athlete',{teamId:r[1],athleteId}),teamRef=resource(s,'team',{teamId:r[1]});
    const permitted=method==='PUT'&&!r[3]?allowed(s,actor,'team.write',teamRef):method==='POST'&&r[3]?allowed(s,actor,'athlete.self.respond',ref):method==='GET'&&!r[3]&&(allowed(s,actor,'athlete.self.read',ref)||allowed(s,actor,'athlete.read',ref));require(permitted,403,'forbidden');
    const team=exists(s.teams,r[1]);require(team&&team.players.some(p=>p.id===athleteId),404,'resource');const record=s.athletes.find(a=>a.teamId===team.id&&a.id===athleteId);
    if(method==='PUT'&&!r[3]){
     require(allowed(s,actor,'team.write',resource(s,'team',{teamId:team.id})),403,'forbidden');validateAthlete(body);
     require(body.expectedRevision===(record?.revision??0),409,'revision');const {expectedRevision,...content}=clone(body);const next={id:athleteId,teamId:team.id,...content,revision:expectedRevision+1,responses:(record?.responses||[]).filter(x=>{const before=record?.assignments.find(a=>a.id===x.assignmentId),after=body.assignments.find(a=>a.id===x.assignmentId);return before&&after&&before.name===after.name&&before.due===after.due;})};
     if(record)s.athletes[s.athletes.indexOf(record)]=next;else s.athletes.push(next);audit(s,actor,'athlete.update',athleteId,now);return ok({record:athleteProjection(next),revision:next.revision,responses:next.responses},200,true);
    }
    if(method==='GET'&&!r[3]){
     require(allowed(s,actor,'athlete.self.read',ref)||allowed(s,actor,'athlete.read',ref),403,'forbidden');return ok({record:athleteProjection(record||{id:athleteId}),revision:record?.revision??0,responses:clone(record?.responses||[])});
    }
    if(method==='POST'&&r[3]){
     require(allowed(s,actor,'athlete.self.respond',ref),403,'forbidden');require(exact(body,['assignmentId','response','expectedRevision'])&&id(body.assignmentId)&&int(body.expectedRevision)&&['seen','ready','question'].includes(body.response),400,'response');require(record&&record.assignments.some(a=>a.id===body.assignmentId&&a.status==='open'),404,'assignment');require(record.revision===body.expectedRevision,409,'revision');
     const old=record.responses.find(x=>x.assignmentId===body.assignmentId);if(old?.response===body.response)return ok({response:old});const next={assignmentId:body.assignmentId,response:body.response,at:now};record.responses=record.responses.filter(x=>x.assignmentId!==body.assignmentId).concat(next);record.revision++;audit(s,actor,'athlete.respond',athleteId,now);return ok({response:next},200,true);
    }
   }
   if(method==='POST'&&path==='matches'){
    require(exact(body,['id','teamId','opponent','bestOf','target','decider'])&&id(body.id)&&id(body.teamId)&&str(body.opponent)&&[3,5].includes(body.bestOf)&&[15,21,25].includes(body.target)&&[15,21,25].includes(body.decider),400,'match');require(allowed(s,actor,'team.write',resource(s,'team',{teamId:body.teamId})),403,'forbidden');require(exists(s.teams,body.teamId),404,'resource');
    require(!exists(s.matches,body.id)&&s.matches.length<32,409,'match-limit');const m={...clone(body),status:'live',revision:0,set:1,score:{ours:0,theirs:0},sets:[],lease:null,generation:0,ops:[]};s.matches.push(m);audit(s,actor,'match.create',m.id,now);return ok({match:publicMatch(m,now)},201,true);
   }
   r=/^matches\/([A-Za-z0-9_-]{1,64})(?:\/(acquire|renew|release|score|next|finish))?$/.exec(path);
   if(r){
    const m=exists(s.matches,r[1]);if(!m)return err(actor.role==='owner'?404:403,'resource');const ref=resource(s,'match',{teamId:m.teamId,matchId:m.id,status:m.status}),canScore=allowed(s,actor,'match.score',ref),canRead=allowed(s,actor,'team.read',ref)||canScore;
    if(method==='GET'&&!r[2]){require(canRead,403,'forbidden');return ok({match:publicMatch(m,now)});}
    require(method==='POST'&&canScore,403,'forbidden');
    const op=r[2];
    if(op==='acquire'){
     require(exact(body,['expectedRevision']),400,'packet');exactRevision(m,body.expectedRevision);require(m.status==='live',409,'finished');
     if(m.lease&&m.lease.until>now){require(m.lease.holderId===actor.id,409,'lease-held');return ok({match:publicMatch(m,now)});}
     m.generation++;m.lease={holderId:actor.id,until:now+LEASE_MS};audit(s,actor,'lease.acquire',m.id,now);return ok({match:publicMatch(m,now)},200,true);
    }
    if(op==='renew'||op==='release'){
     require(exact(body,['generation'])&&int(body.generation),400,'packet');leaseFor(m,actor,body,now);
     if(op==='release'){m.lease=null;m.generation++;audit(s,actor,'lease.release',m.id,now);}else m.lease.until=now+LEASE_MS;
     return ok({match:publicMatch(m,now)},200,true);
    }
    if(['score','next','finish'].includes(op)){
     require(exact(body,op==='score'?['generation','expectedRevision','opId','side']:['generation','expectedRevision','opId'])&&id(body.opId)&&int(body.generation)&&int(body.expectedRevision)&&(op!=='score'||['ours','theirs'].includes(body.side)),400,'packet');
     if(op==='finish')require(allowed(s,actor,'match.confirm',ref),403,'forbidden');
     // Retry acknowledgement is scoped to the exact actor, generation and operation.
     const prior= m.ops.find(x=>x.id===body.opId);
     if(prior){require(prior.actorId===actor.id&&prior.generation===body.generation&&prior.expectedRevision===body.expectedRevision&&prior.op===op&&prior.side===(body.side??null),409,'op-conflict');return ok({match:publicMatch(m,now),appliedRevision:prior.revision,replayed:true});}
     leaseFor(m,actor,body,now);exactRevision(m,body.expectedRevision);require(m.ops.length<5000,409,'operation-limit');
     const ended=validateSetScore(m),wins=m.sets.filter(x=>x.ours>x.theirs).length,losses=m.sets.length-wins,needed=(m.bestOf+1)/2;
     if(op==='score'){require(!ended,409,'set-ended');require(m.score[body.side]<999,409,'score-limit');m.score[body.side]++;}
     if(op==='next'||op==='finish'){
      require(ended,409,'set-not-ended');const finalWins=wins+(m.score.ours>m.score.theirs?1:0),finalLosses=losses+(m.score.theirs>m.score.ours?1:0),finished=Math.max(finalWins,finalLosses)>=needed;
      require(op==='finish'?finished:!finished,409,finished?'match-ended':'match-not-ended');m.sets.push(clone(m.score));
      if(op==='finish'){
       m.status='finished';m.lease=null;m.generation++;
       // Pending assistant invitations are no longer redeemable after the
       // assigned match ends. Remove them in the same transaction as finish.
       s.invites=s.invites.filter(i=>!(i.scope.role==='assistant'&&i.scope.matchIds.includes(m.id)));
      }else{m.set++;m.score={ours:0,theirs:0};}
     }
     m.revision++;m.ops.push({id:body.opId,actorId:actor.id,generation:body.generation,expectedRevision:body.expectedRevision,op,side:body.side??null,revision:m.revision});audit(s,actor,'match.'+op,m.id,now);return ok({match:publicMatch(m,now),appliedRevision:m.revision,replayed:false},200,true);
    }
   }
   return err(404,'route');
  };
  const out=result();if(out.changed)require(new TextEncoder().encode(JSON.stringify(s)).length<=STATE_LIMIT,409,'workspace-limit');return {...out,...(out.changed?{state:s}:{})};
 }catch(e){if(int(e?.status,400,599)&&typeof e.error==='string')return err(e.status,e.error);throw e;}
}
