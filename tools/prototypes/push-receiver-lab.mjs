/* Isolated service-worker handler rehearsal. Not registered by TeachApp.
 * Consent is injected by the caller; unavailable/changed consent fails closed.
 * No push subscriptions, production worker, network or account data. */
const tag='teachapp-workspace-update-lab',title='TeachApp',body='В личном кабинете есть обновления.';
const local=new Set(['127.0.0.1','localhost','[::1]']);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===keys.slice().sort().join('|');
export function parsePushSignalLab(text){
 if(typeof text!=='string'||text.length>128)return false;
 try{const v=JSON.parse(text);return exact(v,['version','kind'])&&v.version===1&&v.kind==='workspace-update';}catch{return false;}
}
function scopeURL(value){
 try{const u=new URL(value);if(['http:','https:'].includes(u.protocol)&&local.has(u.hostname)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname.endsWith('/tools/prototypes/push-receiver/'))return u;}catch{}
 return null;
}
export function pushReceiverLab({registration,clients,consent=()=>false}){
 const root=scopeURL(registration?.scope);
 if(!root)throw Error('Only isolated localhost push receiver scope is allowed');
 const target=new URL('index.html',root);
 const allowed=async()=>{try{return await consent()===true;}catch{return false;}};
 return {
  async push(event){
   try{
    if(!event?.data||!parsePushSignalLab(event.data.text())||!await allowed())return false;
    // Use only constant options, not arbitrary decrypted fields or URLs.
    await registration.showNotification(title,{body,tag,renotify:false});
    return true;
   }catch{return false;}
  },
  async click(event){
   if(event?.notification?.tag!==tag)return false;
   event.notification.close();
   if(!await allowed())return false;
   try{
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    if(!await allowed())return false;
    const existing=windows.find(c=>{try{const u=new URL(c.url);return u.origin===root.origin&&(u.pathname===target.pathname||u.pathname===root.pathname)&&!u.search&&!u.hash;}catch{return false;}});
    if(existing?.focus)await existing.focus();else if(clients.openWindow)await clients.openWindow(target.href);else return false;
    return true;
   }catch{return false;}
  }
 };
}
