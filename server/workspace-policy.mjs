// Reference authorization policy for the future server. Never trust client role claims.
// All identities, memberships and resource metadata passed here MUST be server-resolved.
const roles=new Set(['owner','teacher','coach','assistant','organizer','athlete']);
const actions={teacher:new Set(['school.read','school.write','documents.school']),coach:new Set(['team.read','team.write','match.score','match.event','match.confirm','training.read','training.write','athlete.read']),assistant:new Set(['team.roster','match.score','match.event']),organizer:new Set(['tournament.read','tournament.write']),athlete:new Set(['athlete.self.read','athlete.self.respond','training.schedule'])};
export function authorizeWorkspace(actor,member,resource,action){
 if(!actor?.id||!member||member.revoked||member.userId!==actor.id||!roles.has(member.role)||!member.workspaceId||member.workspaceId!==resource?.workspaceId||typeof action!=='string')return false;
 if(member.role==='owner')return ['workspace.manage','school.read','school.write','documents.school','team.read','team.write','team.roster','match.score','match.event','match.confirm','training.read','training.write','athlete.read','tournament.read','tournament.write'].includes(action);
 if(!actions[member.role].has(action))return false;
 if(member.role==='teacher')return resource.type==='school'&&Array.isArray(member.schoolIds)&&member.schoolIds.includes(resource.schoolId);
 if(member.role==='organizer')return resource.type==='tournament'&&Array.isArray(member.tournamentIds)&&member.tournamentIds.includes(resource.tournamentId);
 if(member.role==='athlete')return resource.type==='athlete'&&resource.athleteId===member.athleteId&&resource.teamId===member.teamId;
 if(!['team','match','training','athlete'].includes(resource.type)||!Array.isArray(member.teamIds)||!member.teamIds.includes(resource.teamId))return false;
 if(member.role==='assistant')return (action==='team.roster'&&resource.type==='team')||(['match.score','match.event'].includes(action)&&resource.type==='match'&&resource.status==='live'&&member.matchIds?.includes(resource.matchId));
 return true;
}
export function assistantProjection(team){return {id:team.id,name:team.name,players:(team.players||[]).map(p=>({id:p.id,number:p.number,name:p.name}))};}
export function athleteProjection(record){return {id:record.id,goals:(record.goals||[]).map(g=>({id:g.id,name:g.name,status:g.status,to:g.to})),assignments:(record.assignments||[]).map(g=>({id:g.id,name:g.name,due:g.due,status:g.status})),schedule:(record.schedule||[]).map(g=>({id:g.id,date:g.date,time:g.time,title:g.title}))};}
