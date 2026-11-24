import {videoMarkers} from '../video-review.js';
import {reasons} from '../match-protocol.js';
import {el,openSheet,closeSheet,toast} from '../ui.js';
const p=text=>el('p',{text}),field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]),btn=(text,onclick)=>el('button',{type:'button',class:'btn wide',text,onclick});
const select=rows=>el('select',{},rows.map(([value,text])=>el('option',{value,text})));
const stamp=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
export function openVideoReview(match){
 const detail=match.detail;if(!detail)return;
 const file=el('input',{type:'file',accept:'video/*','aria-label':'Выбрать локальное видео'}),video=el('video',{controls:true,playsinline:true,preload:'metadata',style:'width:100%;max-height:45vh;background:#000;border-radius:12px'}),anchor=el('input',{type:'number',min:0,step:0.1,value:0}),kind=select([['','Все завершения'],...Object.entries(reasons)]),side=select([['','Обе команды'],['ours',detail.teamName],['theirs',detail.opponent]]),player=select([['','Все игроки'],...[...detail.ourPlayers,...detail.awayPlayers].map(x=>[x.id,x.name])]),rows=el('div',{class:'coach-stack'}),info=p('Выберите видео матча на устройстве.');
 let url=null,observer=null;
 function release(){video.pause();video.removeAttribute('src');video.load();if(url)URL.revokeObjectURL(url);url=null;}
 function cleanup(){observer?.disconnect();window.removeEventListener('pagehide',cleanup);release();}
 function draw(){try{const duration=Number.isFinite(video.duration)?video.duration:Infinity,markers=videoMarkers(detail,Number(anchor.value),{kind:kind.value,side:side.value,playerId:player.value,duration});rows.replaceChildren(p('Найдено событий: '+markers.length),...markers.slice(0,500).map(m=>btn(stamp(m.seconds)+' · сет '+m.set+' · '+m.score+' · '+m.label+' · '+m.player,()=>{if(!url||!Number.isFinite(video.duration)){toast('Сначала откройте видео');return;}video.currentTime=Math.min(video.duration,Math.max(0,m.seconds-4));video.play().catch(()=>{});})));if(markers.length>500)rows.append(p('Уточните фильтр: показаны первые 500 событий.'));}catch(e){rows.replaceChildren(p(e.message));}}
 file.onchange=()=>{release();const f=file.files?.[0];if(!f)return;url=URL.createObjectURL(f);video.src=url;info.textContent='Видео открывается локально. Настройте синхронизацию.';draw();};
 video.onloadedmetadata=draw;video.onerror=()=>{if(url)info.textContent='Не удалось открыть видео. Проверьте формат и кодек.';};
 for(const n of [anchor,kind,side,player])n.onchange=draw;
 const root=el('div',{class:'coach-form'},[el('h2',{text:'Видеоразбор · '+match.opponent}),p('Только непрерывная запись матча. Укажите момент первого записанного очка на видео. Метки приблизительные: время зависит от момента внесения события.'),field('Локальный файл',file),info,video,field('Первое записанное очко на видео, секунд',anchor),btn('Установить по текущему положению видео',()=>{if(!url)return;anchor.value=video.currentTime.toFixed(1);draw();}),field('Завершение',kind),field('Команда, выигравшая розыгрыш',side),field('Указанный игрок',player),p('Переход начинает просмотр за 4 секунды до отметки. Файл не загружается на сервер и не сохраняется в базе.'),rows,btn('Закрыть',()=>{cleanup();closeSheet();})]);
 draw();openSheet(root,{fullHeight:true,onClose:cleanup});observer=new MutationObserver(()=>{if(!root.isConnected)cleanup();});observer.observe(document.body,{childList:true,subtree:true});window.addEventListener('pagehide',cleanup);
}
