/* No SDK/CDN. Only Firebase REST over HTTPS; credentials stay in memory. */
import {firebaseOrigin,portalAddress,readPortal} from './public-portal.js';
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
async function request(fetcher,url,options={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 try{const r=await fetcher(url,{...options,signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer'});if(!r.ok)throw Object.assign(Error(r.status===412?'Публичная страница изменилась на другом устройстве.':r.status===401||r.status===403?'Firebase: доступ запрещён. Проверьте учётную запись и правила.':'Firebase: запрос не выполнен ('+r.status+')'),{status:r.status});const data=r.status===204?null:await r.json();return options.headers?.['X-Firebase-ETag']?{data,etag:r.headers.get('ETag')}:data;}
 catch(e){if(e.name==='AbortError')throw Error('Firebase: время ожидания истекло');throw e;}finally{clearTimeout(timeout);}
}
export async function firebaseSignIn(apiKey,email,password,fetcher=globalThis.fetch){
 assert(typeof apiKey==='string'&&/^[A-Za-z0-9_-]{10,150}$/.test(apiKey),'Укажите Web API Key проекта Firebase');
 assert(typeof email==='string'&&email.includes('@')&&typeof password==='string'&&password.length,'Введите почту и пароль');
 const auth=await request(fetcher,'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
 assert(auth?.localId&&auth.idToken&&auth.refreshToken,'Firebase: неполный ответ авторизации');
 let token=auth.idToken,refresh=auth.refreshToken,expiry=Date.now()+Number(auth.expiresIn||3600)*1000,closed=false,refreshing=null;
 async function getToken(){
  assert(!closed,'Войдите в Firebase снова');
  if(Date.now()<expiry-60000)return token;
  if(!refreshing)refreshing=(async()=>{const a=await request(fetcher,'https://securetoken.googleapis.com/v1/token?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:refresh})});
    assert(!closed&&a.user_id===auth.localId&&a.id_token&&a.refresh_token,'Firebase: повторите вход');token=a.id_token;refresh=a.refresh_token;expiry=Date.now()+Number(a.expires_in||3600)*1000;return token;})().finally(()=>{refreshing=null;});
  return refreshing;
 }
 return {uid:auth.localId,getToken,close(){closed=true;token='';refresh='';}};
}
export async function resetPortalPassword(apiKey,email){
 assert(email.includes('@'),'Введите почту тренера');
 await request(fetch,'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestType:'PASSWORD_RESET',email})});
}
// Firebase normalizes empty collections and array keys. Compare only validated
// public content, never client timestamps or raw object order.
export function samePortalContent(a,b){
 const normalize=x=>{const p=readPortal(x);if(!p)return null;const {updatedAt,...content}=p;return content;};
 const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
 if(a!==null&&!readPortal(a)||b!==null&&!readPortal(b))return false;
 return canonical(normalize(a))===canonical(normalize(b));
}
export function firebasePublisher(origin,slug,session,fetcher=globalThis.fetch){
 const url=portalAddress(firebaseOrigin(origin),session.uid,slug);
 async function readVersion(){
  const result=await request(fetcher,url,{headers:{'X-Firebase-ETag':'true'}});
  assert(typeof result.etag==='string'&&result.etag.length>0,'Firebase не вернул ETag. Запись остановлена.');
  assert(result.data===null||readPortal(result.data),'Не удалось проверить существующую публичную страницу.');
  return result;
 }
 async function send(method,body,expected){
  assert(typeof expected==='string'&&expected.length>0,'Сначала получите подтверждённую ревизию страницы');
  const token=await session.getToken();
  return request(fetcher,url+'?auth='+encodeURIComponent(token),{method,headers:{'Content-Type':'application/json','If-Match':expected},...(body?{body:JSON.stringify(body)}:{})});
 }
 async function conditional(method,data,expected){
  const body=data?{...data,updatedAt:{'.sv':'timestamp'}}:null;
  try{await send(method,body,expected);}
  catch(error){
   if(error.status!==412)throw error;
   // A lost acknowledgement can result in 412 on retry. Accept only if the
   // server already contains exactly the intended public content.
   const version=await readVersion();
   if(samePortalContent(version.data,data))return version;
   throw error;
  }
  const version=await readVersion();
  if(!samePortalContent(version.data,data))throw Object.assign(Error('Публичная страница изменилась после записи.'),{status:412});
  return version;
 }
 return {
  read(){return request(fetcher,url);},
  readVersion,
  write(data,expected){return conditional('PUT',data,expected);},
  remove(expected){return conditional('DELETE',null,expected);}
 };
}
