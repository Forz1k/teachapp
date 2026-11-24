import test from 'node:test';
import assert from 'node:assert/strict';
import {documentColumnWidths,docxEntries} from '../js/documents.js';
test('plan columns preserve total width and reserve room for exercises and guidance',()=>{
 const matrix=[['Часть','Время, мин','Содержание','Методические указания','Инвентарь'],['Основная',20,'Упражнения','Объяснение','Мяч']];
 const widths=documentColumnWidths(matrix,9638);
 assert.equal(widths.reduce((a,b)=>a+b,0),9638);
 assert.ok(widths[2]>widths[1]*3&&widths[3]>widths[1]*2);
 const doc=docxEntries({title:'Тест',sections:[{heading:'Таблица',paragraphs:[],matrix}]} )['word/document.xml'];
 const actual=[...doc.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map(m=>Number(m[1]));
 assert.deepEqual(actual,widths);
 assert.match(doc,/<w:tblHeader\/>/);
});
test('adaptive column widths stay positive even on very narrow grid',()=>{
 const matrix=[['№','ФИО','Содержание'],[1,'А','Длинное описание '.repeat(10)]];
 for(const width of [3,10,10000]){
 const result=documentColumnWidths(matrix,width);
 assert.equal(result.reduce((a,b)=>a+b,0),width);
 assert.ok(result.every(v=>v>=1));
 }
});
