import test from 'node:test';import assert from 'node:assert/strict';
import {dayReview} from '../js/dashboard.js';
test('Запись отметки не означает подтверждение урока, неизвестная явка отделена',()=>{const rows=[{id:'a',lesson:{id:'l1',held:true}},{id:'b',lesson:{id:'l2'}},{id:'c'},{id:'d',lesson:{id:'l4',held:true}}];const v=dayReview(rows,r=>({unknown:r.id==='a'?2:0,present:1}));assert.deepEqual(v.items.map(x=>x.status),['review','unfinished','planned','done']);assert.equal(v.confirmed,2);assert.equal(v.review,1);assert.equal(v.next.row.id,'b');});
