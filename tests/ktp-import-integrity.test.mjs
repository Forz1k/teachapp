import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../js/db.js';
import * as S from '../js/store.js';
test('KTP import never detaches topics used by a lesson in another tab',async()=>{await db.clearAll();await S.load();await db.put('ktp',{id:'k',name:'Тест',classIds:[]});await db.put('topics',{id:'t',name:'Тема',ktpId:'k',ktpOrder:1});await S.load();await db.put('lessons',{id:'l',classId:'c',date:'2026-11-25',topicId:'t'});await assert.rejects(S.replaceKtpTopics('k',[{name:'Новая'}]),/используются/);assert.equal((await db.get('lessons','l')).topicId,'t');assert.equal((await db.get('topics','t')).name,'Тема');assert.equal(await S.appendKtpTopics('k',[{name:'Первая',order:1},{name:'Вторая',order:1}]),2);assert.deepEqual((await db.getAll('topics')).sort((a,b)=>a.ktpOrder-b.ktpOrder).map(t=>t.ktpOrder),[1,2,3]);await assert.rejects(S.appendKtpTopics('missing',[{name:'Тема'}]),/недоступен/);});
