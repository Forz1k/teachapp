import test from 'node:test';import assert from 'node:assert/strict';
import {dayDataIndex} from '../js/dashboard.js';
import {previewRows} from '../js/documents.js';
test('Индекс рабочего дня исключает посторонние уроки и сохраняет неизвестную явку',()=>{const lesson={id:'l',date:'2026-01-01',held:true},rows=[{classId:'c',lesson}],s={students:[{id:'p',classId:'c'},{id:'q',classId:'c'},{id:'other',classId:'b'}],marks:[{lessonId:'l',studentId:'p',value:'5',source:'manual'},{lessonId:'other',studentId:'q',value:'3'}],participation:[],exemptions:[]};const i=dayDataIndex(s,rows,'2026-01-01');assert.equal(i.byLesson.size,1);assert.equal(i.students.get('c').length,2);assert.equal(i.attendance(rows[0]).unknown,1);});
test('Ограничение предпросмотра не изменяет исходную матрицу',()=>{const a=[['Показатель'],...Array.from({length:200},(_,i)=>[i])];const v=previewRows(a);assert.equal(v.rows.length,150);assert.equal(v.omitted,50);assert.equal(a.length,201);});
