import assert from 'node:assert/strict';
const account=async()=>{
 const user={email:crypto.randomUUID()+'@example.test',password:crypto.randomUUID(),returnSecureToken:true};
 const call=async op=>{const res=await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:'+op+'?key=demo',{method:'POST',body:JSON.stringify(user),headers:{'Content-Type':'application/json'}});assert.equal(res.status,200);return res.json()};
 await call('signUp');return call('signInWithPassword');
};
const coach=await account(),other=await account(),page='publicTeams/'+coach.localId+'/team';
async function check(method,path,body,token,expected){
 const url=new URL('http://127.0.0.1:9000/'+path+'.json');url.searchParams.set('ns','demo-teachapp-default-rtdb');if(token&&token!=='owner')url.searchParams.set('auth',token);
 const r=await fetch(url,{method,headers:token==='owner'?{Authorization:'Bearer owner'}:{},body:JSON.stringify(body)});assert.equal(r.status,expected,path+' '+method);return r.json();
}
const s={schema:1,team:'Synthetic',updatedAt:1};
await check('PUT',page,s,coach.idToken,401);
await check('PUT','publishers/'+coach.localId,true,'owner',200);
await check('PUT',page,s,coach.idToken,200);
assert.deepEqual(await check('GET',page,undefined,null,200),s);
for(const token of [null,other.idToken])await check('PUT',page,s,token,401);
for(const path of ['','publicTeams','publishers'])await check('GET',path,undefined,null,401);
for(const patch of [{medical:'private'},{schedule:'private'},{match:{notes:'private'}}])await check('PATCH',page,patch,coach.idToken,401);
await check('DELETE',page,undefined,coach.idToken,200);
assert.equal(await check('GET',page,undefined,null,200),null);
console.log('PASS: authenticated allowlisted owner, guest reads, unauthorized writes denied, schema, deletion');

