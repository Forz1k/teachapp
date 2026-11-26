/* Synthetic sandbox only. No session persistence, no access to IndexedDB. */
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x);
const token=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const loopback=new Set(['localhost','127.0.0.1','[::1]']);
export const isLocalPlatformPage=(loc=globalThis.location)=>!!loc&&['http:','https:'].includes(loc.protocol)&&loopback.has(loc.hostname);
export function platformEndpoint(value){
 const u=new URL(String(value).trim());if(!isLocalPlatformPage(u)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Только локальный адрес тестового Worker без пути');return u.origin;
}
export function platformClient(endpoint,workspace,secret,{fetcher=globalThis.fetch,location=globalThis.location}={}){
 if(!isLocalPlatformPage(location))throw Error('Тестовые кабинеты доступны только на localhost');
 const origin=platformEndpoint(endpoint);if(!id(workspace)||!token(secret))throw Error('Проверьте ID пространства и секретный код');
 let closed=false,key=secret;
 return {async request(path,method='GET',body){
  if(closed)throw Error('Сессия закрыта');
  if(!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)||!['GET','POST','PUT'].includes(method))throw Error('Некорректный запрос');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const r=await fetcher(origin+'/v1/workspaces/'+workspace+'/'+path,{method,headers:{Authorization:'Bearer '+key,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
   if(closed)throw Error('Сессия закрыта');
   const value=await r.json();if(!r.ok){const retry=Number(r.headers.get('Retry-After')||value?.retryAfter);if(r.status===429&&Number.isInteger(retry)&&retry>=1&&retry<=60)throw Object.assign(Error('Слишком много запросов. Повторите через '+retry+' с.'),{status:429,retryAfter:retry});throw Object.assign(Error('Сервер: '+(typeof value?.error==='string'?value.error:'ошибка')+' (HTTP '+r.status+')'),{status:r.status});}return value;
  }finally{clearTimeout(timer);}
 },close(){closed=true;key='';}};
}
