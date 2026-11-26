import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../js/db.js';
import * as S from '../js/store.js';
import * as M from '../js/model.js';
import {planJournalPaste} from '../js/journal-filters.js';

async function setup(){
 await D.clearAll();await S.load();
 const cls=await S.addClass('7А'),p=await S.addStudent(cls.id,'Синтетический ученик',1,'girls');
 const ktp=await S.addKtp({name:'Демо КТП',classIds:[cls.id]});
 await S.appendKtpTopics(ktp.id,[{name:'Первая тема'},{name:'Вторая тема'}]);
 const topics=S.state.topics.filter(t=>t.ktpId===ktp.id).sort((a,b)=>a.ktpOrder-b.ktpOrder);
 const date=M.todayIso(),a=await S.addLesson(cls.id,date,topics[0].id,'',{slot:1,time:'09:00'}),b=await S.addLesson(cls.id,date,topics[1].id,'',{slot:2,time:'10:00'});
 return {cls,p,topics,a,b};
}
const planned=({p,a,b},values='4\t5')=>planJournalPaste(values,[p],[a,b],{studentId:p.id,lessonId:a.id}).entries.map(e=>({...e,expectedLesson:S.journalLessonSnapshot(e.lessonId===a.id?a:b)}));
test('Journal rejects stale topic or load and leaves every cell and grade history unchanged',async()=>{
 const data=await setup(),{cls,topics,a,b}=data,entries=planned(data);
 await D.put('topics',{...topics[1],name:'Изменённая тема'});
 await assert.rejects(S.applyJournalPaste(cls.id,entries,true,{requireLessonSnapshot:true}),/Тема, нагрузка или состояние/);
 assert.equal((await D.getAll('marks')).length,0);assert.equal((await D.getAll('workRecords')).length,0);
 await S.load();
 const updated=planned(data);
 await D.put('lessons',{...a,activityIds:['run'],activitiesConfirmed:true});
 await assert.rejects(S.applyJournalPaste(cls.id,updated,true,{requireLessonSnapshot:true}),/Тема, нагрузка или состояние/);
 assert.equal((await D.getAll('marks')).length,0);
 await S.load();const fresh={...data,a:await D.get('lessons',a.id),b:await D.get('lessons',b.id)};
 assert.equal(await S.applyJournalPaste(cls.id,planned(fresh),true,{requireLessonSnapshot:true}),2);
 assert.equal((await D.getAll('marks')).length,2);
});
test('Bulk replacement requires frozen lesson preview; caller mutation cannot change the confirmed grade',async()=>{
 const data=await setup(),{cls,p,a}=data;
 const entries=planned(data,'3');
 const missing=entries.map(({expectedLesson,...rest})=>rest);
 await assert.rejects(S.applyJournalPaste(cls.id,missing,true,{requireLessonSnapshot:true}),/актуальный предпросмотр/);
 const pending=S.applyJournalPaste(cls.id,entries,true,{requireLessonSnapshot:true});
 entries[0].value='1';await pending;
 const mark=(await D.getAll('marks')).find(m=>m.studentId===p.id&&m.lessonId===a.id);
 assert.equal(mark.value,'3');
 const replacements=planned(data,'5').map(e=>({...e,expectedMark:S.journalMarkSnapshot(mark)}));
 await D.put('lessons',{...a,held:true});
 await assert.rejects(S.applyJournalPaste(cls.id,replacements,true,{replace:true,requireLessonSnapshot:true}),/состояние урока изменились/);
 assert.equal((await D.get('marks',mark.id)).value,'3');
});
