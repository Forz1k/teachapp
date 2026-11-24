import test from 'node:test';
import assert from 'node:assert/strict';
import {filterTasks} from '../js/attention.js';

test('task filters combine without modifying the original priority order',()=>{
 const tasks=[{id:1,kind:'lesson',title:'7А · урок',detail:'Не отмечена явка',date:'2026-11-24',priority:3},{id:2,kind:'match',title:'Матч',detail:'Черновик',date:'2026-11-24',priority:4},{id:3,kind:'lesson',title:'7Б · урок',detail:'Не заполнена явка',date:'2026-11-23',priority:2}];
 assert.deepEqual(filterTasks(tasks,{kind:'lesson',priority:'3',query:'  УРОК   явка  '}).map(t=>t.id),[1]);
 assert.deepEqual(filterTasks(tasks,{query:'2026-11-24'}).map(t=>t.id),[1,2]);
 assert.deepEqual(filterTasks(tasks,{priority:'4'}).map(t=>t.id),[2]);
 assert.deepEqual(filterTasks(tasks,{query:'несуществующий'}),[]);
 assert.deepEqual(tasks.map(t=>t.id),[1,2,3]);
});
