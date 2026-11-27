import 'fake-indexeddb/auto';import test from 'node:test';import assert from 'node:assert/strict';
import {timingRows,timingPdf} from './fixtures/volleypoint-timing-fixture.mjs';
import {extractVolleyPdf} from '../js/volleypoint-pdf.js';
import {parseVolleyRows,buildVolleyImport,validateVolleyImport} from '../js/volleypoint-import.js';
import {volleyPlayerTime,volleyPlayerTimes,volleyTimeLabel} from '../js/volleypoint-time.js';
import * as C from '../js/coach.js';import * as S from '../js/store.js';import * as db from '../js/db.js';import {projectScope} from '../js/sync.js';
const mapped=(report,side=0)=>buildVolleyImport(report,side,Object.fromEntries(report.teams[side].players.map(p=>[p.number,'p'+p.number])));
test('VolleyPoint historical duration: raw PDF, alias, wrapped substitution, libero, timeout, both sides',async()=>{
 const report=parseVolleyRows(await extractVolleyPdf(timingPdf()));assert.equal(report.timing.matchSeconds,540);assert.deepEqual(report.timing.sets.map(s=>s.seconds),[240,180]);
 assert.deepEqual(report.timing.sets.map(s=>s.lineups.map(x=>x.length)),[[6,6],[6,6]]);
 assert.deepEqual(report.timing.sets.map(s=>s.changes.map(x=>x.length)),[[4,0],[0,0]]);
 assert.deepEqual(report.timing.sets.map(s=>s.timeouts.length),[2,1]);
 const m=mapped(report);validateVolleyImport(m);
 const v=id=>volleyPlayerTime(m,'p'+id);
 assert.equal(volleyTimeLabel(v(1)),'7:00');assert.equal(v(1).sets[0].kind,'full');assert.equal(v(1).sets[0].timeoutMs,60000);
 assert.equal(volleyTimeLabel(v(6)),'0:00–4:00');assert.equal(v(6).sets[0].kind,'changed');assert.equal(volleyTimeLabel(v(7)),'3:00–7:00');assert.equal(volleyTimeLabel(v(8)),'0:00–4:00');assert.equal(volleyTimeLabel(v(9)),'0:00');assert.equal(v(9).sets[0].kind,'bench');
 const other=mapped(report,1);validateVolleyImport(other);assert.equal(volleyTimeLabel(volleyPlayerTime(other,'p11')),'7:00');assert.equal(other.imported.timing.sets[0].timeouts[0].side,'theirs');
 assert.equal(C.playerSeasonStats([m],'p7').playingTime.historicalMinMs,180000);
 assert.equal(C.playerSeasonStats([m],'p7').playingTime.historicalMaxMs,420000);
 assert.equal(C.playerSeasonStats([m],'p7').playingTime.measuredMatches,0);
 assert.equal(C.playerSeasonStats([m],'p7',{from:'2026-01-01'}).playingTime.historicalMatches,0);
});
test('Missing, unrecognized or inconsistent evidence stays unknown, not a fabricated full set',()=>{
 const missing=timingRows.filter(x=>x!=='Замены'&&!x.includes('Обычная замена')&&!x.includes('Замена либеро')&&!x.includes('Возвращение либеро')&&x!=='Игрок'&&x!=='Сет Команда Тип Игрок Позиция');
 const incomplete=mapped(parseVolleyRows(missing));assert.equal(incomplete.imported.timing.sets[0].changes,null);assert.equal(volleyPlayerTime(incomplete,'p1'),null);
 const unknown=mapped(parseVolleyRows(timingRows.map(x=>x.includes('Обычная замена #6')?'1 неизвестный тип замены':x)));assert.equal(volleyPlayerTime(unknown,'p1'),null);
 const noData=mapped(parseVolleyRows(timingRows.map(x=>x==='Замены'?'Замены':x).filter(x=>!x.includes('Обычная замена')&&!x.includes('Замена либеро')&&!x.includes('Возвращение либеро')&&x!=='Игрок').flatMap(x=>x==='Сет Команда Тип Игрок Позиция'?[x,'Нет данных']:[x])));assert.equal(noData.imported.timing.sets[0].changes,null);
 const noLine=timingRows.filter(x=>x!=='А #1 ТестАа #2 ТестАб #3 ТестАв #4 ТестАг #5 ТестАд #7 ТестАж');
 const partial=mapped(parseVolleyRows(noLine));assert.equal(volleyPlayerTime(partial,'p1').unknownSets,1);assert.equal(volleyTimeLabel(volleyPlayerTime(partial,'p1')),'4:00');
 const contradiction=structuredClone(mapped(parseVolleyRows(timingRows)));contradiction.imported.timing.sets[0].changes=[];assert.throws(()=>validateVolleyImport(contradiction),/не согласуются/);
 const invalid=structuredClone(mapped(parseVolleyRows(timingRows)));invalid.imported.timing.sets[0].seconds=-1;assert.throws(()=>validateVolleyImport(invalid),/данные партии/);
 const legacy=structuredClone(partial);delete legacy.imported.timing;assert.equal(volleyPlayerTime(legacy,'p1'),null);validateVolleyImport(legacy);
});
test('Re-import enriches same ID transactionally; preserves labels and mappings; rejects conflicts and duplicates; backup/CSV',async()=>{
 await db.clearAll();await S.load();const report=parseVolleyRows(timingRows),team=await C.saveTeam({name:'Синтетическая команда'}),mapping={};
 for(const p of report.teams[0].players){const r=await C.savePlayer({teamId:team.id,name:p.name,number:p.number,position:'universal'});mapping[p.number]=r.id;}
 const input={...buildVolleyImport(report,0,mapping),teamId:team.id};const old=structuredClone(input);delete old.imported.timing;old.opponent='Сохранённое название';old.competition='Своя запись';old.date='2025-09-02';
 const before=await C.saveVolleyImport(old);assert.equal(C.playerSeasonStats([before],mapping[1]).playingTime.unknownMatches,1);
 await assert.rejects(C.enrichVolleyImport(input),/Подтвердите/);
 await assert.rejects(C.saveVolleyImport(input),/уже/);
 const swapped={...input,roster:[...input.roster]};[swapped.roster[2],swapped.roster[3]]=[swapped.roster[3],swapped.roster[2]];
 await assert.rejects(C.enrichVolleyImport(swapped,{confirmed:true}),/сопоставление/);
 const notSource=structuredClone(input);notSource.imported.hash='c'.repeat(64);await assert.rejects(C.enrichVolleyImport(notSource,{confirmed:true}),/не найден/);
 const enriched=await C.enrichVolleyImport(input,{confirmed:true});assert.equal(enriched.id,before.id);assert.equal(enriched.date,before.date);assert.equal(enriched.opponent,before.opponent);assert.equal(enriched.competition,before.competition);assert.deepEqual(enriched.stats,before.stats);
 assert.deepEqual(await C.enrichVolleyImport(input,{confirmed:true}),enriched);
 const conflict=structuredClone(input);conflict.imported.timing.sets[0].seconds+=1;await assert.rejects(C.enrichVolleyImport(conflict,{confirmed:true}),/противоречат/);
 const snapshot=await S.makeBackup();assert.equal(projectScope(snapshot.data,'school').coachMatches,undefined);assert.equal(projectScope(snapshot.data,'coach').coachMatches.length,1);
 await S.restoreBackup(snapshot);const data=await C.loadCoach(),view=C.teamView(data,team.id);assert.equal(view.matches.length,1);assert.equal(C.playerSeasonStats(view.matches,mapping[1]).playingTime.historicalMinMs,420000);
 assert.match(C.coachCsv(view),/VolleyPoint: время по длительности партий/);assert.match(C.coachCsv(view),/7:00/);
});

test('Batch imported playing time preserves individual evidence and reads substitutions once per set',()=>{
 const m=mapped(parseVolleyRows(timingRows));
 const expected=new Map(m.roster.map(id=>[id,volleyPlayerTime(m,id)]));
 let reads=0;
 const observed=structuredClone(m);
 for(const s of observed.imported.timing.sets){
  if(s.changes===null)continue;
  s.changes=new Proxy(s.changes,{get(target,key,receiver){if(key===Symbol.iterator)reads++;return Reflect.get(target,key,receiver);}});
 }
 assert.deepEqual(volleyPlayerTimes(observed),expected);
 assert.equal(reads,m.imported.timing.sets.filter(s=>s.lineup&&s.changes).length);
 reads=0; C.coachCsv({players:[],matches:[observed]});
 assert.equal(reads,m.imported.timing.sets.filter(s=>s.lineup&&s.changes).length);
 const partial=structuredClone(m);partial.imported.timing.sets[0].changes=null;
 assert.deepEqual(volleyPlayerTimes(partial),new Map(partial.roster.map(id=>[id,volleyPlayerTime(partial,id)])));
 partial.imported.timing.sets[1].changes=null;
 assert.ok([...volleyPlayerTimes(partial).values()].every(x=>x===null));
 delete partial.imported.timing;assert.equal(volleyPlayerTimes(partial).size,0);
});
