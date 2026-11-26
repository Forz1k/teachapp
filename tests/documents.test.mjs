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

test('Отчёт назначений не включает персональные данные без явного выбора',()=>{const base={className:'7А',matrix:[['Норматив','Выполнено'],['Прыжок',10]]};const summary=buildDocument('assignmentReport',base);assert.equal(summary.personal,false);assert.equal(buildDocument('assignmentReport',{...base,includeNames:true}).personal,true);assert.throws(()=>buildDocument('assignmentReport',{}));});
test('Послематчевый отчёт сохраняет основания выводов',()=>{const r=buildDocument('matchDebrief',{teamName:'Наши',opponent:'Гости',matrix:[['Партия','Счёт'],[1,'25:20']],notes:['Только записанные события']});assert.equal(r.personal,false);assert.match(docxEntries(r)['word/document.xml'],/Только записанные события/);assert.match(docxEntries(r)['word/document.xml'],/Для внутренней работы тренера/);});

test('School-year document keeps denominators and conflict rows without private student records',()=>{
 const year={from:'2025-09-01',to:'2026-05-31'},row={year,archived:true,cutoff:year.to,classes:1,students:2,lessons:4,held:3,gradeCount:3,gradeWeight:4,mean:4.25,present:3,absent:1,unknown:2,pct:75,rows:[{className:'7А',students:2,lessons:4,held:3,gradeCount:3,gradeWeight:4,mean:4.25,present:3,absent:1,unknown:2,pct:75,student:{name:'SECRET'}}]};
 const summary=buildDocument('schoolYearReport',{years:[row,{year:{from:'2024-09-01',to:'2025-05-31'},conflict:true}]});assert.equal(summary.personal,false);assert.equal(summary.sections[1].matrix[1][8],4);assert.equal(summary.sections[1].matrix[1][13],75);assert.equal(summary.sections[1].matrix[2][2],null);assert.ok(!JSON.stringify(summary).includes('SECRET'));const detail=buildDocument('schoolYearReport',{years:[row],includeClasses:true});assert.equal(detail.personal,true);assert.equal(detail.sections[2].matrix[1][1],'7А');assert.doesNotMatch(JSON.stringify(detail),/SECRET/);
});
import {seasonPlanProgress} from '../js/season-plan.js';
test('Season document separates uncovered training, zero target, and no private notes',()=>{
 const plan={id:'p',kind:'seasonPlan',teamId:'t',name:'S',from:'2026-11-01',to:'2026-11-30',revision:0,phases:[{name:'Техника',kind:'technical',from:'2026-11-05',to:'2026-11-10',sessions:2,minutes:0,goal:'PRIVATE NOTE'}]};
 const progress=seasonPlanProgress(plan,[{teamId:'t',date:'2026-11-01',held:true,minutes:60},{teamId:'t',date:'2026-11-05',held:true,minutes:45}],[],'2026-11-10');
 const report=buildDocument('seasonPlanReport',{teamName:'A',planName:'S',progress,cutoff:'2026-11-10'});assert.equal(report.personal,true);assert.deepEqual(report.sections[1].matrix[1],['Тренировки',2,1,1,0,50]);assert.equal(report.sections[1].matrix[2][5],null);assert.equal(report.sections.find(s=>s.heading==='Вне этапов').matrix[1][2],1);assert.doesNotMatch(JSON.stringify(report),/PRIVATE NOTE/);assert.match(docxEntries(report)['word/document.xml'],/Недельные циклы/);
});
