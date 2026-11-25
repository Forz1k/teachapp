/* Read a bounded, local Word document. No macros, external resources or network. */
const MAX_FILE=12*1024*1024,MAX_XML=4*1024*1024,MAX_TOPICS=2000,NS='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const fail=(ok,msg)=>{if(!ok)throw Error(msg);};
const header=/тема|назван|topic|содержан/i,number=/^\s*(\d{1,4})\s*[.)]?\s*$/;
const safeText=v=>String(v||'').replace(/\s+/g,' ').trim();
function direct(n,tag){return [...n.children].filter(x=>x.namespaceURI===NS&&x.localName===tag);}
function textOf(n){return safeText([...n.getElementsByTagNameNS(NS,'t')].map(x=>x.textContent).join(''));}
export function parseKtpWordXml(xml,Parser=globalThis.DOMParser){
 fail(typeof xml==='string'&&xml.length<=MAX_XML&&!/<!DOCTYPE|<!ENTITY/i.test(xml),'Недопустимый XML документа');
 fail(typeof Parser==='function','XML-парсер недоступен');const doc=new Parser().parseFromString(xml,'application/xml');fail(!doc.querySelector('parsererror')&&doc.documentElement.namespaceURI===NS&&doc.documentElement.localName==='document','Повреждённый документ Word');
 const body=direct(doc.documentElement,'body')[0];fail(body,'В документе нет содержимого');const items=[],warnings=[];let ignored=0;
 const add=(name,order)=>{name=safeText(name);if(!name||name.length<3||name.length>500||/^(итого|всего|тема|номер)$/i.test(name)){ignored++;return;}fail(items.length<MAX_TOPICS,'Не более 2000 тем');items.push({name,order:Number.isInteger(order)&&order>0?order:items.length+1,sheet:'Word'});};
 for(const tbl of direct(body,'tbl')){
  const rows=direct(tbl,'tr').map(r=>direct(r,'tc').map(textOf));let col=-1,start=0,orderCol=-1;
  for(let i=0;i<Math.min(rows.length,5);i++){const found=rows[i].findIndex(c=>header.test(c)&&!/^\d/.test(c));if(found>=0){col=found;start=i+1;orderCol=rows[i].findIndex(c=>/^(№|номер|п\/п|№ п\/п)$/i.test(c));break;}}
  if(col<0){if(rows.some(r=>r.length>1&&number.test(r[0])&&r[1]?.length>2)){col=1;orderCol=0;}else{ignored+=rows.length;continue;}}
  for(const row of rows.slice(start)){if(!row[col]||header.test(row[col])&&/^(тема|название темы|содержание)$/i.test(row[col])){ignored++;continue;}const n=orderCol>=0?number.exec(row[orderCol]||''):null;add(row[col],n?Number(n[1]):null);}
 }
 if(!items.length){for(const p of direct(body,'p')){const value=textOf(p),m=/^(\d{1,4})[.)]\s+(.+)$/.exec(value);if(m)add(m[2],Number(m[1]));else if(value)ignored++;}}
 if(ignored)warnings.push('Пропущено строк без распознанной темы: '+ignored+'. Проверьте предпросмотр.');
 if(!items.length)warnings.push('Темы не распознаны. Нужна таблица с колонкой «Тема» либо нумерованный список.');
 return {items,warnings,sheets:['Word']};
}
export async function extractWordXml(bytes){
 const a=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);fail(a.length<=MAX_FILE&&a.length>=22,'Файл Word слишком большой или повреждён');const d=new DataView(a.buffer,a.byteOffset,a.byteLength);
 let end=-1;for(let i=a.length-22;i>=Math.max(0,a.length-65557);i--)if(d.getUint32(i,true)===0x06054b50&&i+22+d.getUint16(i+20,true)===a.length){end=i;break;}
 fail(end>=0&&d.getUint16(end+4,true)===0&&d.getUint16(end+6,true)===0,'Поддерживаются обычные DOCX без многотомного архива');
 const count=d.getUint16(end+10,true),start=d.getUint32(end+16,true),size=d.getUint32(end+12,true);fail(count<=4096&&start+size<=end,'Некорректный каталог DOCX');
 const decoder=new TextDecoder();let pos=start,entry=null;
 for(let i=0;i<count;i++){
  fail(pos+46<=start+size&&d.getUint32(pos,true)===0x02014b50,'Повреждённый каталог DOCX');
  const flags=d.getUint16(pos+8,true),method=d.getUint16(pos+10,true),compressed=d.getUint32(pos+20,true),plain=d.getUint32(pos+24,true),nameLen=d.getUint16(pos+28,true),extra=d.getUint16(pos+30,true),comment=d.getUint16(pos+32,true),offset=d.getUint32(pos+42,true),next=pos+46+nameLen+extra+comment;fail(next<=start+size,'Повреждённый каталог DOCX');
  if(decoder.decode(a.subarray(pos+46,pos+46+nameLen))==='word/document.xml'){fail(!entry,'Повтор document.xml');entry={flags,method,compressed,plain,offset};}pos=next;
 }
 fail(entry&&!(entry.flags&1)&&[0,8].includes(entry.method)&&entry.plain<=MAX_XML&&entry.compressed<=MAX_FILE,'Документ зашифрован, слишком большой или имеет неподдерживаемое сжатие');
 const o=entry.offset;fail(o+30<=start&&d.getUint32(o,true)===0x04034b50,'Повреждённый заголовок DOCX');const nameLen=d.getUint16(o+26,true),at=o+30+nameLen+d.getUint16(o+28,true);fail(at+entry.compressed<=start&&decoder.decode(a.subarray(o+30,o+30+nameLen))==='word/document.xml','Повреждённый XML документа');
 const compressed=a.subarray(at,at+entry.compressed);let result;
 if(entry.method===0)result=compressed;else{
  fail(typeof DecompressionStream==='function','Браузер не поддерживает локальный импорт DOCX; используйте Excel или CSV');
  let stream;try{stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));}catch{throw Error('Браузер не поддерживает распаковку DOCX; используйте Excel или CSV');}
  const reader=stream.getReader(),parts=[];let length=0;try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_XML||length>entry.plain){await reader.cancel();throw Error('XML превышает допустимый размер');}parts.push(value);}}finally{reader.releaseLock();}
  result=new Uint8Array(length);let n=0;for(const p of parts){result.set(p,n);n+=p.length;}
 }
 fail(result.length===entry.plain,'Размер XML не совпадает с каталогом');return new TextDecoder('utf-8',{fatal:true}).decode(result);
}
export async function parseKtpDocx(file){fail(file.size<=MAX_FILE,'DOCX должен быть не больше 12 МБ');return parseKtpWordXml(await extractWordXml(await file.arrayBuffer()));}
