import {el,openSheet,closeSheet,toast} from '../ui.js';
import {templates,formats,paintStudio,studioStyle,readStudioStyle,saveStudioStyle,resetStudioStyle,studioPublication,canvasPng,studioBatch} from '../media-studio.js';
const btn=(text,onclick)=>el('button',{type:'button',class:'btn wide',text,onclick}),field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]),p=text=>el('p',{text});
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function openStudio(seed={},back=closeSheet){
 const scope=seed.scope||'default';let style=studioStyle();try{style=readStudioStyle(scope);}catch{}
 const select=rows=>el('select',{},Object.entries(rows).map(([value,label])=>el('option',{value,text:Array.isArray(label)?label.join(' × '):label}))),input=(value,maxlength)=>el('input',{value,maxlength});
 const template=select(templates),format=select(formats),title=input(seed.title||'',80),team=input(seed.team||'',100),opponent=input(seed.opponent||'',100),score=input(seed.score||'',24),details=el('textarea',{maxlength:500,rows:4,text:seed.details||''}),footer=input(style.footer,100),accent=el('input',{type:'color',value:style.accent}),background=el('input',{type:'color',value:style.background}),logo=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp'}),photo=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp'}),canvas=el('canvas',{style:'width:100%;height:auto;max-height:55vh;object-fit:contain;border-radius:14px;background:#101b31','aria-label':'Предпросмотр изображения'});
 template.value=Object.hasOwn(templates,seed.template)?seed.template:'matchday';format.value=style.format;
 const publication=el('textarea',{rows:6,maxlength:4000,'aria-label':'Текст публикации'}),includeLink=el('input',{type:'checkbox'}),includeText=el('input',{type:'checkbox'});includeText.checked=true;
 const selected=Object.keys(formats).map(k=>{const n=el('input',{type:'checkbox','aria-label':'Экспорт '+k});n.checked=true;return [k,n];});
 const status=el('p',{role:'status',class:'studio-status'}),controls=[template,format,title,team,opponent,score,details,footer,accent,background,logo,photo,publication,includeLink,includeText,...selected.map(([,n])=>n)];
 let emblem=null,backdrop=null,closed=false,busy=false,pending=0,editedText=false;const body=el('div',{class:'coach-stack studio-editor'});
 const current=()=>({template:template.value,format:format.value,title:title.value,team:team.value,opponent:opponent.value,score:score.value,details:details.value,footer:footer.value,accent:accent.value,background:background.value});
 const writeText=()=>{publication.value=studioPublication(current(),includeLink.checked?seed.link||'':'');editedText=false;};
 const draw=()=>{if(closed)return;try{paintStudio(canvas,current(),{logo:emblem,backgroundImage:backdrop});if(!editedText)writeText();}catch(e){status.textContent=e.message;}};
 const dispose=()=>{if(closed)return;closed=true;emblem?.close();backdrop?.close();emblem=backdrop=null;canvas.width=canvas.height=1;};
 const load=(control,assign)=>{let generation=0;control.onchange=async()=>{const ticket=++generation;pending++;update();try{
  const file=control.files[0];if(!file){assign(null);draw();return;}
  if(file.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Выберите PNG, JPEG или WebP до 10 МБ');
  const img=await createImageBitmap(file);
  if(closed||ticket!==generation||!body.isConnected){img.close();return;}
  if(img.width*img.height>30000000){img.close();throw Error('Слишком большое изображение');}
  assign(img);draw();
 }catch(e){if(!closed)toast(e.message);}finally{pending--;update();}};};
 load(logo,x=>{emblem?.close();emblem=x;});load(photo,x=>{backdrop?.close();backdrop=x;});
 for(const n of [template,format,title,team,opponent,score,details,footer,accent,background])n.oninput=draw;
 publication.oninput=()=>editedText=true;includeLink.onchange=()=>{try{writeText();}catch(e){includeLink.checked=false;toast(e.message);}};
 const styleSave=btn('Сохранить фирменный стиль',()=>{try{saveStudioStyle(scope,current());status.textContent='Оформление сохранено на этом устройстве.';}catch(e){toast(e.message);}}),
 styleReset=btn('Сбросить оформление',()=>{try{const d=resetStudioStyle(scope);footer.value=d.footer;accent.value=d.accent;background.value=d.background;format.value=d.format;draw();status.textContent='Оформление сброшено.';}catch(e){toast(e.message);}}),
 regenerate=btn('Обновить текст из макета',()=>{try{writeText();}catch(e){toast(e.message);}}),copy=btn('Скопировать текст',async()=>{try{await navigator.clipboard.writeText(publication.value);status.textContent='Текст скопирован.';}catch{publication.focus();publication.select();status.textContent='Скопируйте выделенный текст.';}});
 const run=async(label,fn)=>{if(busy||pending||closed)return;busy=true;status.textContent=label;update();try{await fn();if(!closed)status.textContent='Файл подготовлен. Проверьте загрузки устройства.';}catch(e){if(!closed){status.textContent=e.message;toast(e.message);}}finally{busy=false;update();}};
 const png=btn('Сохранить PNG',()=>run('Подготовка PNG…',async()=>{const blob=await canvasPng(canvas);if(!closed&&body.isConnected)download(blob,'teachapp-'+template.value+'-'+format.value+'.png');}));
 const batch=btn('Скачать ZIP с форматами',()=>run('Подготовка архива…',async()=>{
  const snapshot=current(),text=includeText.checked?publication.value:'',work=document.createElement('canvas');
  const blob=await studioBatch(work,snapshot,selected.filter(([,n])=>n.checked).map(([k])=>k),{logo:emblem,backgroundImage:backdrop,text,cancelled:()=>closed||!body.isConnected});
  if(!closed&&body.isConnected)download(blob,'teachapp-'+snapshot.template+'.zip');
 }));
 const textDownload=btn('Скачать текст TXT',()=>download(new Blob(['\uFEFF'+publication.value],{type:'text/plain;charset=utf-8'}),'teachapp-publication.txt'));
 const backButton=btn('Назад',()=>{dispose();back();});
 const update=()=>{if(closed)return;for(const n of controls)n.disabled=busy;for(const n of [styleSave,styleReset,regenerate,copy,textDownload])n.disabled=busy;png.disabled=batch.disabled=busy||pending>0;};
 body.append(el('h2',{text:'TeachApp Studio'}),p('Изображения и текст создаются локально. Используйте только разрешённые к распространению сведения и фотографии.'),field('Шаблон',template),field('Формат',format),canvas,field('Заголовок (пусто — название шаблона)',title),field('Команда / получатель',team),field('Соперник',opponent),field('Счёт / достижение',score),field('Описание',details),el('h3',{text:'Фирменное оформление'}),field('Подпись',footer),field('Акцент',accent),field('Фон',background),styleSave,styleReset,p('Сохраняются только цвета, подпись и формат для этой команды на данном устройстве. Фотографии, эмблемы, имена и текст публикации не сохраняются в настройках.'),field('Эмблема',logo),field('Фотография фона',photo),png,el('h3',{text:'Текст публикации'}),p('Текст составляется из полей макета. После ручного редактирования обновляется только по вашей команде.'));
 if(seed.link)body.append(field('Добавить ссылку зрительской страницы (проверьте публикацию)',includeLink));
 body.append(publication,regenerate,copy,textDownload,el('h3',{text:'Пакетный экспорт'}),...selected.map(([k,n])=>field(formats[k].join(' × '),n)),field('Добавить текст публикации в архив',includeText),batch,status,backButton);
 openSheet(body,{onClose:dispose,fullHeight:true});draw();update();
}
