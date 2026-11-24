/* No SDK/CDN. Only Firebase REST over HTTPS; credentials stay in memory. */
import {firebaseOrigin,portalAddress} from './public-portal.js';
const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
async function request(fetcher,url,options={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 try{const r=await fetcher(url,{...options,signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer'});if(!r.ok)throw Error(r.status===401||r.status===403?'Firebase: доступ запрещён. Проверьте учётную запись и правила.':'Firebase: запрос не выполнен ('+r.status+')');return r.status===204?null:await r.json();}
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
export function firebasePublisher(origin,slug,session,fetcher=globalThis.fetch){
 const url=portalAddress(firebaseOrigin(origin),session.uid,slug);
 return {async read(){return request(fetcher,url);},async write(data){const token=await session.getToken();return request(fetcher,url+'?auth='+encodeURIComponent(token)+'&print=silent',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,updatedAt:{'.sv':'timestamp'}})});},async remove(){const token=await session.getToken();return request(fetcher,url+'?auth='+encodeURIComponent(token),{method:'DELETE'});}};
}
