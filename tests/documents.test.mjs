import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {buildDocument,makeDocx,crc32,documentWorkbook,docxEntries} from '../js/documents.js';
const plan={name:'План & техника',goal:'Цель <тест>',minutes:45,equipment:'Мячи',audience:'7А',items:[{phase:'main',minutes:10,notes:'Строка 1\nСтрока 2',exercise:{name:'Подача',description:'Описание',equipment:'Мячи'}}]};
test('Документы: валидные части DOCX, ZIP, CRC и XML-экранирование',()=>{
 const report=buildDocument('lesson',{plan,author:'Учитель',title:'Урок & <тест>'});
 const zip=Buffer.from(makeDocx(report)),entries={};
 let i=0;
 while(zip.readUInt32LE(i)===0x04034b50){
  const size=zip.readUInt32LE(i+18),n=zip.readUInt16LE(i+26),extra=zip.readUInt16LE(i+28),start=i+30+n+extra,name=zip.toString('utf8',i+30,i+30+n),data=zip.subarray(start,start+size);
  assert.equal(zip.readUInt32LE(i+14),crc32(data));entries[name]=data.toString('utf8');i=start+size;
 }
 assert.equal(zip.readUInt32LE(i),0x02014b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
 assert.deepEqual(entries,docxEntries(report));
 const {window}=new JSDOM();for(const [name,xml] of Object.entries(entries)){const parsed=new window.DOMParser().parseFromString(xml,'application/xml');assert.equal(parsed.querySelector('parsererror'),null,name);}
 assert.match(entries['word/document.xml'],/Урок &amp; &lt;тест&gt;/);assert.match(entries['word/document.xml'],/Строка 1/);assert.match(entries['word/document.xml'],/<w:br\/>/);
 assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926);window.close();
});
test('Документы: настоящая книга Excel и данные без формул',()=>{
 const context=vm.createContext({ArrayBuffer,Uint8Array});vm.runInContext(readFileSync(new URL('../vendor/xlsx.full.min.js',import.meta.url),'utf8'),context);
 const XLSX=context.XLSX,report=buildDocument('registration',{teamName:'Команда',players:[{name:'=Тест',number:7,positionLabel:'Связующая'}]});
 const book=XLSX.read(documentWorkbook(report,XLSX),{type:'array'});assert.equal(book.Sheets['Таблица 1'].B2.v,'=Тест');assert.equal(book.Sheets['Таблица 1'].B2.f,undefined);assert.equal(report.personal,true);
 assert.throws(()=>buildDocument('registration',{players:[]}));assert.throws(()=>buildDocument('lesson',{}));
});
