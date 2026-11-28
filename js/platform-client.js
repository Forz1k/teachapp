/* Synthetic sandbox only. No session persistence, no access to IndexedDB. */
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const token=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const loopback=new Set(['localhost','127.0.0.1','[::1]']);
export const isLocalPlatformPage=(loc=globalThis.location)=>!!loc&&['http:','https:'].includes(loc.protocol)&&loopback.has(loc.hostname);
export function platformEndpoint(value){
 const u=new URL(String(value).trim());if(!isLocalPlatformPage(u)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Только локальный адрес тестового Worker без пути');return u.origin;
}
export function platformClient(endpoint,workspace,secret,options){return createClient(endpoint,workspace,secret,false,options);}
export function platformIdentityClient(endpoint,workspace,assertion,options){return createClient(endpoint,workspace,assertion,true,options);}
export function platformCandidateClient(config,workspace,secret,options){return createClient(config?.apiOrigin,workspace,secret,false,options,config);}
export function platformCandidateIdentityClient(config,workspace,assertion,options){return createClient(config?.apiOrigin,workspace,assertion,true,options,config);}
function createClient(endpoint,workspace,secret,identity,{fetcher=globalThis.fetch,location=globalThis.location}={},candidate=null){
 let origin;
 if(candidate){
  const ui=new URL(candidate.origin),api=new URL(endpoint);
  if(ui.protocol!=='https:'||api.protocol!=='https:'||ui.origin!==candidate.origin||api.origin!==endpoint||ui.origin===api.origin||location?.origin!==ui.origin||ui.username||api.username||loopback.has(ui.hostname)||loopback.has(api.hostname))throw Error('HTTPS-кандидат не настроен');
  origin=api.origin;
 }else{if(!isLocalPlatformPage(location))throw Error('Тестовые кабинеты доступны только на localhost');origin=platformEndpoint(endpoint);}
 if(!id(workspace)||!(identity?typeof secret==='string'&&secret.length<=8192&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(secret):token(secret)))throw Error('Проверьте ID пространства и секретный код');
 let closed=false,key=secret;const pending=new Set();
 return {async request(path,method='GET',body){
  if(closed)throw Error('Сессия закрыта');
  if(!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)||!['GET','POST','PUT'].includes(method))throw Error('Некорректный запрос');
  if(identity&&(method!=='POST'||!(candidate?['identity/session','identity/redeem','identity/bootstrap','identity/recover','identity/restore']:['identity/session','identity/bind','identity/redeem']).includes(path)))throw Error('Только обмен подписанного токена');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  pending.add(controller);
  const checkActive=()=>{if(closed)throw Error('Сессия закрыта');if(controller.signal.aborted)throw Error('Время ожидания запроса истекло');};
  try{const r=await fetcher(origin+'/v1/workspaces/'+workspace+'/'+path,{method,headers:{Authorization:'Bearer '+key,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
   checkActive();
   const value=await r.json();checkActive();if(!r.ok){const retry=Number(r.headers.get('Retry-After')||value?.retryAfter);if(r.status===429&&Number.isInteger(retry)&&retry>=1&&retry<=60)throw Object.assign(Error('Слишком много запросов. Повторите через '+retry+' с.'),{status:429,retryAfter:retry});throw Object.assign(Error('Сервер: '+(typeof value?.error==='string'?value.error:'ошибка')+' (HTTP '+r.status+')'),{status:r.status});}return value;
  }catch(err){checkActive();throw err;}finally{clearTimeout(timer);pending.delete(controller);}
 },close(){closed=true;key='';for(const controller of pending)controller.abort();pending.clear();}};
}
