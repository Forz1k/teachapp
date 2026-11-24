import test from 'node:test';
import assert from 'node:assert/strict';
import {competitionOverview,fixtureCalendar} from '../js/competition-center.js';
const now=new Date(2026,10,24,12).getTime(),fixture=(id,day)=>({id,opponent:'Гости',startAt:new Date(2026,10,day,16).getTime()});
const data={schedule:[fixture('old',23),fixture('next',24),fixture('later',25)],enabled:true,match:null};
test('Центр соревнований отделяет просроченные встречи и подтверждённую авторизацию',()=>{
 const v=competitionOverview('a',[],{data,connected:false,dirty:true},now);assert.equal(v.next.id,'next');assert.equal(v.overdue.length,1);assert.equal(v.mode,'login');
 const w=competitionOverview('a',[],{data,connected:true,dirty:true},now);assert.equal(w.mode,'pending');
 const done=competitionOverview('a',[],{data:{...data,match:{scheduledId:'next',status:'finished'}},connected:true},now);assert.equal(done.next.id,'later');
});
test('Расписание в календаре локальное, без архивных команд и служебных данных',()=>{
 const rows=fixtureCalendar([{id:'a',name:'Наши'},{id:'b',name:'Архив',archived:true}],{a:data,b:data},'2026-11-24','2026-11-25');assert.equal(rows.length,2);assert.equal(rows[0].time,'16:00');assert.equal(rows[0].exportTitle,'Волейбольный матч');assert.equal(Object.hasOwn(rows[0],'logos'),false);
});
