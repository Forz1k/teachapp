/* Read-only, local, deliberately non-identifying diagnostics. No DB reads,
 * network fetches, URLs, keys, identifiers, or record contents in the report. */
import {APP_VERSION} from './version.js';
export async function collectUpdateDiagnostics({nav=globalThis.navigator,cacheStorage=globalThis.caches,location=globalThis.location,matchMedia=globalThis.matchMedia?.bind(globalThis),encrypted=false,version=APP_VERSION}={}){
 const report={format:1,version:/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version)?version:'unknown',storageRoute:encrypted===true?'encrypted':'native',network:nav?.onLine===true?'online':nav?.onLine===false?'offline':'unknown',display:'unknown',worker:'unavailable',update:'unknown',versionCache:'unavailable'};
 try{report.display=nav?.standalone===true||matchMedia?.('(display-mode: standalone)').matches?'standalone':matchMedia?'browser':'unknown';}catch{}
 try{
  const sw=nav?.serviceWorker;if(!sw||typeof sw.getRegistration!=='function')return report;
  const reg=await sw.getRegistration();report.worker=sw.controller?.state==='activated'?'controlled':sw.controller?'transition':reg?.active?'uncontrolled':'not-installed';
  report.update=reg?.waiting?'waiting':reg?.installing?'installing':reg?'none':'unknown';
  if(!reg||!cacheStorage||typeof cacheStorage.match!=='function'||report.version==='unknown')return report;
  const scope=new URL(reg.scope),here=new URL(location.href);
  if(scope.origin!==here.origin||!here.href.startsWith(scope.href)||!['https:','http:'].includes(scope.protocol))return report;
  const response=await cacheStorage.match(new URL('js/version.js',scope).href,{cacheName:'teachapp:'+scope.href+':v'+report.version});
  if(!response){report.versionCache='missing';return report;}
  const value=await response.text();
  report.versionCache=value.trim()==="export const APP_VERSION = '"+report.version+"';"?'matching':'mismatch';
 }catch{/* fixed vocabulary, never disclose exceptions */}
 return report;
}
export function updateDiagnosticsText(r){
 const values={online:'В сети',offline:'Офлайн',unknown:'Не определено',native:'Обычный',encrypted:'Защищённый',standalone:'Установленное приложение',browser:'Браузер',controlled:'Управляется',transition:'Переход',uncontrolled:'Не управляется', 'not-installed':'Не установлен',unavailable:'Недоступно',waiting:'Ожидает подтверждения',installing:'Устанавливается',none:'Нет ожидающего обновления',missing:'Не найден',matching:'Совпадает',mismatch:'Не совпадает'};
 return ['Версия: '+r.version,'Режим хранилища: '+values[r.storageRoute],'Сеть: '+values[r.network],'Запуск: '+values[r.display],'Service worker: '+values[r.worker],'Обновление: '+values[r.update],'Кэш файла версии: '+values[r.versionCache]].join(' · ');
}
