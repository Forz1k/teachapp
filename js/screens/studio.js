import {el,openSheet,closeSheet,toast,confirmDialog} from '../ui.js';
import {templates,formats,paintStudio,studioStyle,readStudioStyle,saveStudioStyle,resetStudioStyle,studioPublication,canvasPng,studioBatch,studioLayouts,studioFocus,studioPresetList,saveStudioPreset,removeStudioPreset,studioStyleFile,parseStudioStyleFile,studioMatchKit,studioMatchPackage} from '../media-studio.js';
const btn=(text,onclick)=>el('button',{type:'button',class:'btn wide',text,onclick}),field=(name,node)=>el('label',{class:'field'},[el('span',{text:name}),node]),p=text=>el('p',{text});
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function openStudio(seed={},back=closeSheet){
 const scope=seed.scope||'default';let style=studioStyle();try{style=readStudioStyle(scope);}catch{}
 const select=rows=>el('select',{},Object.entries(rows).map(([value,label])=>el('option',{value,text:Array.isArray(label)?label.join(' × '):label}))),input=(value,maxlength)=>el('input',{value,maxlength});
 const template=select(templates),format=select(formats),layout=select(studioLayouts),focus=select(studioFocus),title=input(seed.title||'',80),team=input(seed.team||'',100),opponent=input(seed.opponent||'',100),score=input(seed.score||'',24),details=el('textarea',{maxlength:500,rows:4,text:seed.details||''}),footer=input(style.footer,100),accent=el('input',{type:'color',value:style.accent}),background=el('input',{type:'color',value:style.background}),logo=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp'}),photo=el('input',{type:'file',accept:'image/png,image/jpeg,image/webp'}),canvas=el('canvas',{style:'width:100%;height:auto;max-height:55vh;object-fit:contain;border-radius:14px;background:#101b31','aria-label':'Предпросмотр изображения'});
 template.value=Object.hasOwn(templates,seed.template)?seed.template:'matchday';format.value=style.format;layout.value=style.layout;focus.value=style.focus;
 layout.setAttribute('aria-label','Дизайн');focus.setAttribute('aria-label','Положение фотографии');
 const publication=el('textarea',{rows:6,maxlength:4000,'aria-label':'Текст публикации'}),includeLink=el('input',{type:'checkbox'}),includeText=el('input',{type:'checkbox'});includeText.checked=true;
 const selected=Object.keys(formats).map(k=>{const n=el('input',{type:'checkbox','aria-label':'Экспорт '+k});n.checked=true;return [k,n];});
 const preset=el('select',{'aria-label':'Сохранённое оформление'}),presetName=el('input',{'aria-label':'Название оформления',maxlength:48,placeholder:'Например, домашняя серия'}),styleImport=el('input',{type:'file',accept:'.json,application/json','aria-label':'Импорт оформления'});
 const eventDetails=el('textarea',{rows:2,maxlength:500,'aria-label':'Дата, время и место встречи',placeholder:'Например: 12 декабря · 16:00 · спортивный зал'}),kitSummary=el('p',{role:'status',class:'studio-kit-summary'});
 const status=el('p',{role:'status',class:'studio-status'}),controls=[eventDetails,preset,presetName,styleImport,layout,focus,template,format,title,team,opponent,score,details,footer,accent,background,logo,photo,publication,includeLink,includeText,...selected.map(([,n])=>n)];
 let emblem=null,backdrop=null,closed=false,busy=false,pending=0,editedText=false;const body=el('div',{class:'coach-stack studio-editor'});
 const current=()=>({template:template.value,format:format.value,title:title.value,team:team.value,opponent:opponent.value,score:score.value,details:details.value,footer:footer.value,accent:accent.value,background:background.value,layout:layout.value,focus:focus.value});
 const writeText=()=>{publication.value=studioPublication(current(),includeLink.checked?seed.link||'':'');editedText=false;};
 const draw=()=>{if(closed)return;try{paintStudio(canvas,current(),{logo:emblem,backgroundImage:backdrop});if(!editedText)writeText();}catch(e){status.textContent=e.message;}refreshKit();};
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
 for(const n of [template,format,layout,focus,title,team,opponent,score,details,footer,accent,background])n.oninput=draw;
 publication.oninput=()=>editedText=true;includeLink.onchange=()=>{try{writeText();}catch(e){includeLink.checked=false;toast(e.message);}};
 const styleSave=btn('Сохранить фирменный стиль',()=>{try{saveStudioStyle(scope,current());status.textContent='Оформление сохранено на этом устройстве.';}catch(e){toast(e.message);}}),
 styleReset=btn('Сбросить оформление',()=>{try{const d=resetStudioStyle(scope);footer.value=d.footer;accent.value=d.accent;background.value=d.background;format.value=d.format;layout.value=d.layout;focus.value=d.focus;draw();status.textContent='Оформление сброшено.';}catch(e){toast(e.message);}}),
 regenerate=btn('Обновить текст из макета',()=>{try{writeText();}catch(e){toast(e.message);}}),copy=btn('Скопировать текст',async()=>{try{await navigator.clipboard.writeText(publication.value);status.textContent='Текст скопирован.';}catch{publication.focus();publication.select();status.textContent='Скопируйте выделенный текст.';}});
 const applyStyle=d=>{accent.value=d.accent;background.value=d.background;footer.value=d.footer;format.value=d.format;layout.value=d.layout;focus.value=d.focus;draw();};
 const refreshPresets=(chosen='')=>{preset.replaceChildren(el('option',{value:'',text:'Выберите оформление'}),...studioPresetList(scope).map(x=>el('option',{value:x.name,text:x.name})));preset.value=chosen;};
 const presetApply=btn('Применить оформление',()=>{const row=studioPresetList(scope).find(x=>x.name===preset.value);if(!row)return toast('Выберите оформление');applyStyle(row.style);status.textContent='Оформление применено к текущему макету.';});
 const presetSave=btn('Сохранить как пресет',async()=>{if(busy||closed)return;try{const name=presetName.value.trim(),exists=studioPresetList(scope).some(x=>x.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru'));if(exists&&!await confirmDialog({title:'Заменить оформление?',text:'Будут изменены только цвета, формат, подпись и расположение фотографии.',ok:'Заменить'}))return;if(closed)return;const rows=saveStudioPreset(scope,name,current(),{replace:exists});refreshPresets(rows.find(x=>x.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru'))?.name||'');status.textContent='Пресет сохранён.';}catch(e){toast(e.message);}});
 const presetDelete=btn('Удалить выбранный пресет',async()=>{const name=preset.value;if(!name)return;if(!await confirmDialog({title:'Удалить оформление?',text:name,ok:'Удалить',danger:true})||closed)return;try{removeStudioPreset(scope,name);refreshPresets();status.textContent='Пресет удалён.';}catch(e){toast(e.message);}});
 const styleExport=btn('Скачать оформление JSON',()=>download(new Blob([studioStyleFile(current())],{type:'application/json'}),'teachapp-studio-style.json'));
 styleImport.onchange=async()=>{const file=styleImport.files[0];styleImport.value='';if(!file)return;pending++;update();try{if(file.size>4096)throw Error('Файл оформления больше 4 КБ');const d=parseStudioStyleFile(await file.text());if(closed||!body.isConnected)return;if(!await confirmDialog({title:'Применить оформление из файла?',text:'Цвета, формат, подпись и положение фотографии будут заменены в текущем макете. Текст и изображения сохраняются.',ok:'Применить'})||closed)return;applyStyle(d);status.textContent='Оформление импортировано в текущий макет.';}catch(e){if(!closed)toast(e.message);}finally{pending--;update();}};
 refreshPresets();
 const run=async(label,fn)=>{if(busy||pending||closed)return;busy=true;status.textContent=label;update();try{await fn();if(!closed)status.textContent='Файл подготовлен. Проверьте загрузки устройства.';}catch(e){if(!closed){status.textContent=e.message;toast(e.message);}}finally{busy=false;update();}};
 const png=btn('Сохранить PNG',()=>run('Подготовка PNG…',async()=>{const blob=await canvasPng(canvas);if(!closed&&body.isConnected)download(blob,'teachapp-'+template.value+'-'+format.value+'.png');}));
 const batch=btn('Скачать ZIP с форматами',()=>run('Подготовка архива…',async()=>{
  const snapshot=current(),text=includeText.checked?publication.value:'',work=document.createElement('canvas');
  const blob=await studioBatch(work,snapshot,selected.filter(([,n])=>n.checked).map(([k])=>k),{logo:emblem,backgroundImage:backdrop,text,cancelled:()=>closed||!body.isConnected});
  if(!closed&&body.isConnected)download(blob,'teachapp-'+snapshot.template+'.zip');
 }));
 const kit=btn('Скачать комплект матча ZIP',()=>run('Подготовка комплекта матча…',async()=>{
  const work=document.createElement('canvas'),snapshot=current(),chosen=selected.filter(([,n])=>n.checked).map(([k])=>k);
  const blob=await studioMatchPackage(work,snapshot,chosen,{eventDetails:eventDetails.value,logo:emblem,backgroundImage:backdrop,includeText:includeText.checked,link:includeLink.checked?seed.link||'':'',cancelled:()=>closed||!body.isConnected});
  if(!closed&&body.isConnected)download(blob,'teachapp-match-kit.zip');
 }));
 function refreshKit(){try{const models=studioMatchKit(current(),eventDetails.value),count=selected.filter(([,n])=>n.checked).length;if(!count)throw Error('Выберите хотя бы один формат');kitSummary.textContent=models[0].title+' + '+models[1].title+' · '+(count*2)+' PNG'+(includeText.checked?' + 2 TXT':'');kit.disabled=busy||pending>0;}catch(e){kitSummary.textContent=e.message;kit.disabled=true;}}
 eventDetails.oninput=refreshKit;for(const [,n] of selected)n.onchange=refreshKit;includeText.onchange=refreshKit;
 const textDownload=btn('Скачать текст TXT',()=>download(new Blob(['\uFEFF'+publication.value],{type:'text/plain;charset=utf-8'}),'teachapp-publication.txt'));
 const backButton=btn('Назад',()=>{dispose();back();});
 const update=()=>{if(closed)return;for(const n of controls)n.disabled=busy;for(const n of [styleSave,styleReset,presetApply,presetSave,presetDelete,styleExport,regenerate,copy,textDownload])n.disabled=busy;png.disabled=batch.disabled=busy||pending>0;refreshKit();};
 body.append(el('h2',{text:'TeachApp Studio'}),p('Изображения и текст создаются локально. Используйте только разрешённые к распространению сведения и фотографии.'),field('Шаблон',template),field('Формат',format),field('Дизайн',layout),canvas,field('Заголовок (пусто — название шаблона)',title),field('Команда / получатель',team),field('Соперник',opponent),field('Счёт / достижение',score),field('Описание',details),el('h3',{text:'Фирменное оформление'}),field('Подпись',footer),field('Акцент',accent),field('Фон',background),styleSave,styleReset,p('Сохраняются только параметры оформления для этой команды на данном устройстве. Фотографии, эмблемы, имена и текст публикации не сохраняются в настройках.'),el('h3',{text:'Пресеты оформления'}),field('Название пресета',presetName),presetSave,field('Сохранённое оформление',preset),presetApply,presetDelete,styleExport,field('Импорт оформления JSON',styleImport),field('Эмблема',logo),field('Фотография фона',photo),field('Положение фотографии',focus),png,el('h3',{text:'Текст публикации'}),p('Текст составляется из полей макета. После ручного редактирования обновляется только по вашей команде.'));
 if(seed.link)body.append(field('Добавить ссылку зрительской страницы (проверьте публикацию)',includeLink));
 body.append(publication,regenerate,copy,textDownload,el('h3',{text:'Пакетный экспорт'}),...selected.map(([k,n])=>field(formats[k].join(' × '),n)),field('Добавить текст публикации в архив',includeText),batch,el('h3',{text:'Комплект матча'}),p('Афиша без счёта и итоговая карточка с введённым счётом. Используются текущие команды, оформление и выбранные форматы. Для афиши введите сведения отдельно; тексты для комплекта создаются из этих полей, а не из ручной правки текста выше.'),field('Дата, время и место встречи',eventDetails),kitSummary,kit,status,backButton);
 openSheet(body,{onClose:dispose,fullHeight:true});draw();update();
}
