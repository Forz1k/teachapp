/* Document descriptions and local Office Open XML writer. No external service. */
export const documentTypes={lesson:'Технологическая карта урока',training:'План-конспект тренировки',classReport:'Отчёт о работе за период',ktp:'Отчёт о выполнении КТП',norms:'Ведомость нормативов',registration:'Заявка на соревнования',tournament:'Протокол соревнований',teamReport:'Отчёт команды',playerReport:'Индивидуальный отчёт спортсменки',event:'Сценарий спортивного мероприятия'};
const phase={intro:'Подготовительная',main:'Основная',end:'Заключительная'};
const check=(ok,m)=>{if(!ok)throw Error(m);};
const val=v=>v==null?'—':String(v);
const section=(heading,paragraphs=[],matrix=null)=>({heading,paragraphs:paragraphs.filter(x=>x!==''&&x!=null).map(String),matrix});
const meta=o=>[o.organization&&'Организация: '+o.organization,o.author&&'Ответственный: '+o.author,o.date&&'Дата: '+o.date,o.venue&&'Место: '+o.venue,o.audience&&'Участники / группа: '+o.audience].filter(Boolean);
export function buildDocument(type,input={}){
 check(Object.hasOwn(documentTypes,type),'Выберите шаблон документа');
 const title=String(input.title||documentTypes[type]).trim(),sections=[section('Общие сведения',meta(input))];
 let personal=false;
 if(['lesson','training','event'].includes(type)){
  const p=input.plan;
  check(p&&Array.isArray(p.items)&&p.items.length,'Выберите готовый конспект');
  sections.push(section(type==='event'?'Цель и организация мероприятия':'Цель и задачи',[p.name,p.goal,'Продолжительность: '+p.minutes+' мин','Инвентарь: '+(p.equipment||'не указан'),p.audience?'Группа: '+p.audience:'',input.additional||'']));
  sections.push(section(type==='event'?'Ход мероприятия':'Ход занятия',[],[['Часть','Время, мин','Содержание','Методические указания','Инвентарь'],...p.items.map(i=>[phase[i.phase],i.minutes,i.exercise.name+'\n'+i.exercise.description,i.notes,i.exercise.equipment])]));
  if(p.tactics?.length)sections.push(section('Тактические схемы (описание)',p.tactics.map(b=>b.name+(b.note?' — '+b.note:''))));
  if(type==='event')sections.push(section('Организационные условия',[input.rules||'Правила, состав команд, меры безопасности и порядок подведения итогов уточняет организатор.']));
 }else if(['classReport','ktp','norms'].includes(type)){
  check(Array.isArray(input.matrix)&&input.matrix.length,'Выберите класс и период');personal=type!=='ktp';
  sections.push(section('Результаты за выбранный период',[input.period||'',input.className?'Класс: '+input.className:'',type==='classReport'?'Посещаемость и оценки рассчитаны по внесённым данным; пустые отметки не заменяются нулём.':''],input.matrix));
 }else if(type==='registration'){
  check(Array.isArray(input.players)&&input.players.length,'Выберите участников заявки');personal=true;
  sections.push(section('Состав команды',[input.teamName||'',input.additional||''],[['№','ФИО / имя в составе','Игровой номер','Амплуа'],...input.players.map((p,i)=>[i+1,p.name,p.number??'',p.positionLabel||p.position])]));
  sections.push(section('Подтверждение',['Решение о допуске и требуемые официальные документы оформляются отдельно ответственными лицами.']));
 }else if(type==='tournament'){
  check(input.tournamentName&&Array.isArray(input.games),'Выберите соревнование');
  sections.push(section('Результаты',[input.tournamentName,input.systemLabel||''],input.games));
  if(input.standings)sections.push(section('Турнирная таблица',[input.rules||'Правила ранжирования по настройкам TeachApp.'],input.standings));
 }else if(type==='teamReport'){
  check(input.teamName&&Array.isArray(input.matches),'Выберите команду');
  sections.push(section('Результаты команды',[input.teamName,input.period||'',...input.summary||[]],input.matches));
 }else if(type==='playerReport'){
  check(input.playerName&&Array.isArray(input.matches),'Выберите игрока');personal=true;
  sections.push(section('Игрок и показатели',[input.playerName,input.teamName||'',input.period||'',...input.summary||[]],input.matches));
  if(input.tests?.length)sections.push(section('Сопоставимые тренировочные тесты',['Результаты адаптированных попыток не включены в итоговые показатели.'],input.tests));
 }
 if(input.conclusion)sections.push(section('Выводы / примечания',[input.conclusion]));
 if(input.signatures!==false)sections.push(section('Подписи',['Ответственный ______________________','Дата ______________________']));
 const report={title,sections,personal};
 validateDocument(report);return report;
}
export function validateDocument(report){
 check(report&&typeof report.title==='string'&&report.title.trim()&&report.title.length<=300&&Array.isArray(report.sections)&&report.sections.length<=50,'Проверьте заголовок и разделы');
 let cells=0;
 for(const s of report.sections){
  check(typeof s.heading==='string'&&s.heading.length<=300&&Array.isArray(s.paragraphs)&&s.paragraphs.length<=100&&s.paragraphs.every(t=>typeof t==='string'&&t.length<=12000),'Слишком длинный раздел');
  if(s.matrix){check(Array.isArray(s.matrix)&&s.matrix.length>0&&s.matrix.length<=20000&&Array.isArray(s.matrix[0])&&s.matrix[0].length>0&&s.matrix[0].length<=40,'Слишком большая таблица');
   for(const row of s.matrix){check(Array.isArray(row)&&row.length===s.matrix[0].length&&row.every(v=>v==null||['string','number','boolean'].includes(typeof v)&&val(v).length<=12000),'Повреждённая таблица');cells+=row.length;}
  }
 }
 check(cells<=150000,'Разделите отчёт на меньшие периоды');return report;
}
const enc=new TextEncoder();
export function xmlText(v){return val(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&apos;");}
function runs(text){return val(text).split(/\r\n|\r|\n/).map((s,i)=>(i?'<w:r><w:br/></w:r>':'')+'<w:r><w:t xml:space="preserve">'+xmlText(s)+'</w:t></w:r>').join('');}
const para=(text,style='Normal')=>'<w:p><w:pPr><w:pStyle w:val="'+style+'"/></w:pPr>'+runs(text)+'</w:p>';
/** Stable proportional widths: plan content and instructions get the most room. */
export function documentColumnWidths(matrix,width=10000){
 const n=matrix[0].length;
 check(Number.isInteger(width)&&width>=n&&n>0,'Проверьте ширину таблицы');
 const isPlan=n===5&&matrix[0].join('|')==='Часть|Время, мин|Содержание|Методические указания|Инвентарь';
 const weights=isPlan?[14,9,36,29,12]:matrix[0].map((_,col)=>{
  const len=matrix.slice(0,300).reduce((max,row)=>Math.max(max,...val(row[col]).split(/\r?\n/).map(t=>Math.min(100,t.length))),1);
  return Math.max(1,Math.min(4,Math.sqrt(len/6)));
 });
 const sum=weights.reduce((a,b)=>a+b,0);
 const result=weights.map(w=>Math.max(1,Math.floor(width*w/sum)));
 let remaining=width-result.reduce((a,b)=>a+b,0);
 // Preserve exact grid width, distributing rounding residue without a zero-width column.
 for(let i=0;remaining!==0;i=(i+1)%n){
  if(remaining>0){result[i]++;remaining--;}
  else if(result[i]>1){result[i]--;remaining++;}
 }
 return result;
}
function table(matrix,width){
 const widths=documentColumnWidths(matrix,width);
 return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="'+width+'" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>'+widths.map(cw=>'<w:gridCol w:w="'+cw+'"/>').join('')+'</w:tblGrid>'+matrix.map((row,i)=>'<w:tr><w:trPr><w:cantSplit/>'+(i===0?'<w:tblHeader/>':'')+'</w:trPr>'+row.map((v,col)=>'<w:tc><w:tcPr><w:tcW w:w="'+widths[col]+'" w:type="dxa"/>'+(i===0?'<w:shd w:fill="E8EEF7"/>':'')+'</w:tcPr>'+para(v,i===0?'TableHeading':'TableText')+'</w:tc>').join('')+'</w:tr>').join('')+'</w:tbl>';
}
const xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const word='http://schemas.openxmlformats.org/wordprocessingml/2006/main',rel='http://schemas.openxmlformats.org/package/2006/relationships',office='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const style=(id,name,size,bold=false,extra='')=>'<w:style w:type="paragraph" w:styleId="'+id+'"'+(id==='Normal'?' w:default="1"':'')+'><w:name w:val="'+name+'"/>'+(id==='Normal'?'':'<w:basedOn w:val="Normal"/>')+'<w:pPr>'+extra+'</w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>'+(bold?'<w:b/>':'')+'<w:sz w:val="'+size+'"/><w:szCs w:val="'+size+'"/></w:rPr></w:style>';
export function docxEntries(report){
 validateDocument(report);
 const landscape=report.sections.some(s=>s.matrix?.[0].length>6),w=landscape?16838:11906,h=landscape?11906:16838,width=w-2268;
 const doc=xml+'<w:document xmlns:w="'+word+'"><w:body>'+para(report.title,'Title')+report.sections.map(s=>para(s.heading,'Heading1')+s.paragraphs.map(t=>para(t)).join('')+(s.matrix?table(s.matrix,width):'')).join('')+'<w:sectPr><w:pgSz w:w="'+w+'" w:h="'+h+'"'+(landscape?' w:orient="landscape"':'')+'/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>';
 const borders=['top','left','bottom','right','insideH','insideV'].map(n=>'<w:'+n+' w:val="single" w:sz="4" w:color="A7B1C0"/>').join('');
 const styles=xml+'<w:styles xmlns:w="'+word+'">'+style('Normal','Normal',24,false,'<w:spacing w:after="120" w:line="276" w:lineRule="auto"/>')+style('Title','Title',32,true,'<w:keepNext/><w:spacing w:after="240"/><w:jc w:val="center"/>')+style('Heading1','Heading 1',28,true,'<w:keepNext/><w:spacing w:before="240" w:after="100"/>')+style('TableText','Table text',20,false,'<w:spacing w:after="40"/>')+style('TableHeading','Table heading',20,true,'<w:spacing w:after="40"/>')+'<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>'+borders+'</w:tblBorders><w:tblCellMar><w:top w:w="90" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>';
 return {
  '[Content_Types].xml':xml+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  '_rels/.rels':xml+'<Relationships xmlns="'+rel+'"><Relationship Id="rId1" Type="'+office+'/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml':doc,'word/styles.xml':styles,
  'word/_rels/document.xml.rels':xml+'<Relationships xmlns="'+rel+'"><Relationship Id="rId1" Type="'+office+'/styles" Target="styles.xml"/></Relationships>'
 };
}
const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(data){let c=0xFFFFFFFF;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
const bytes=n=>new Uint8Array(n);
function header(n,fields){const a=bytes(n),d=new DataView(a.buffer);for(const [off,size,v] of fields)size===2?d.setUint16(off,v,true):d.setUint32(off,v,true);return a;}
function concat(parts){const total=parts.reduce((n,x)=>n+x.length,0);check(total<=64*1024*1024,'Документ слишком большой');const a=bytes(total);let pos=0;for(const p of parts){a.set(p,pos);pos+=p.length;}return a;}
export function zipStored(entries){
 const local=[],central=[];let offset=0;
 for(const [path,content] of Object.entries(entries)){
  const name=enc.encode(path),data=typeof content==='string'?enc.encode(content):content,crc=crc32(data);
  const h=header(30,[[0,4,0x04034B50],[4,2,20],[6,2,0x800],[12,2,33],[14,4,crc],[18,4,data.length],[22,4,data.length],[26,2,name.length]]);
  const c=header(46,[[0,4,0x02014B50],[4,2,20],[6,2,20],[8,2,0x800],[14,2,33],[16,4,crc],[20,4,data.length],[24,4,data.length],[28,2,name.length],[42,4,offset]]);
  local.push(h,name,data);central.push(c,name);offset+=h.length+name.length+data.length;
 }
 const count=Object.keys(entries).length,size=central.reduce((n,x)=>n+x.length,0),end=header(22,[[0,4,0x06054B50],[8,2,count],[10,2,count],[12,4,size],[16,4,offset]]);
 return concat([...local,...central,end]);
}
export const makeDocx=report=>zipStored(docxEntries(report));
export function documentWorkbook(report,XLSX){
 validateDocument(report);check(XLSX?.utils&&XLSX.write,'Локальный модуль Excel не загружен');
 const wb=XLSX.utils.book_new();
 const info=[['Документ',report.title],...report.sections.flatMap(s=>[[s.heading],...s.paragraphs.map(t=>[t])])];
 const sheet=XLSX.utils.aoa_to_sheet(info);sheet['!cols']=[{wch:55},{wch:55}];XLSX.utils.book_append_sheet(wb,sheet,'Документ');
 let i=0;for(const s of report.sections){if(!s.matrix)continue;i++;const ws=XLSX.utils.aoa_to_sheet(s.matrix.map(row=>row.map(v=>v??'')));ws['!cols']=s.matrix[0].map((v,col)=>({wch:Math.min(60,Math.max(12,...s.matrix.slice(0,300).map(row=>val(row[col]).length+2)))}));XLSX.utils.book_append_sheet(wb,ws,('Таблица '+i));}
 return XLSX.write(wb,{bookType:'xlsx',type:'array'});
}
