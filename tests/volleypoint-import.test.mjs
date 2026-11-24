import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {extractVolleyPdf} from '../js/volleypoint-pdf.js';
import {parseVolleyRows,buildVolleyImport,suggestPlayer,validateVolleyImport} from '../js/volleypoint-import.js';
import * as C from '../js/coach.js';
import * as S from '../js/store.js';
import * as db from '../js/db.js';
const rows=['VolleyPoint Протокол матча','Дата: 01.09.2025','Турнир: Тест','Отпечаток SHA-256: '+'a'.repeat(64),'Результаты сетов','1 2 1 00:01:00','Расстановки','Команда А Выиграно очков: 2','Итого по команде 1 0 1 0','#1 Тестова А - Связующий 1 0 1 0','Серии подач','1 #1 Тестова А 2 1 0','Команда Б Выиграно очков: 1','Итого по команде 1 0 0 0','#2 Тестова Б - Связующий 1 0 0 0','Серии подач','Детали очка','1 1 : 0 Команда А Эйс #1 Тестова А','1 1 : 1 Команда Б Атака #2 Тестова Б','1 2 : 1 Команда А Атака #1 Тестова А','Подписи'];
function syntheticPdf(lines){
 const hex=s=>Array.from(s,c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
 const chars=[...new Set(lines.join(''))];const map='beginbfchar\n'+chars.map(c=>'<'+hex(c)+'> <'+hex(c)+'>').join('\n')+'\nendbfchar';
 const text=lines.map((s,i)=>'q 1 0 0 1 0 '+(800-i*20)+' cm BT /F6 8 Tf 0 Tc 0 2 Td [<'+hex(s)+'>]TJ ET Q ').join('');
 const obj=(id,s)=>Buffer.from(id+' 0 obj\n'+s+'\nendobj\n');
 const stream=(id,s)=>{const z=deflateSync(Buffer.from(s));return Buffer.concat([Buffer.from(id+' 0 obj\n<</Filter/FlateDecode/Length '+z.length+'>>stream\n'),z,Buffer.from('\nendstream\nendobj\n')]);};
 return Buffer.concat([Buffer.from('%PDF-1.7\n'),obj(1,'<</Type/Pages/Kids[2 0 R]/Count 1>>'),obj(2,'<</Type/Page/Resources<</Font<</F6 3 0 R>>>>/Contents 4 0 R>>'),obj(3,'<</ToUnicode 5 0 R>>'),stream(4,text),stream(5,map),obj(6,'<</Creator(VolleyPoint)>>'),Buffer.from('%%EOF')]);
}
test('VolleyPoint: локальный PDF с Unicode, партии и все очки, обе стороны',async()=>{
 const text=await extractVolleyPdf(syntheticPdf(rows));assert.deepEqual(text,rows);
 const r=parseVolleyRows(text);assert.equal(r.rallies.length,3);assert.equal(r.teams[0].series.length,1);
 assert.equal(suggestPlayer(r.teams[0].players[0],[{id:'a',name:'А Тестова',number:1}]),'a');
 const m=buildVolleyImport(r,1,{2:'b'});assert.deepEqual(m.sets,[{ours:1,theirs:2}]);assert.equal(m.stats.b.points,1);assert.equal(m.stats.b.attacks,undefined);assert.equal(m.imported.rallies[0].playerId,null);validateVolleyImport(m);
 await assert.rejects(extractVolleyPdf(new Uint8Array([1,2,3])),/PDF/);
 assert.throws(()=>parseVolleyRows(rows.filter(s=>!s.startsWith('1 1 : 1'))),/розыгрыш/);
 assert.throws(()=>buildVolleyImport(r,0,{}),/сопоставьте/);
});
test('VolleyPoint: атомарная запись, дубли, резервная копия и аналитика',async()=>{
 await db.clearAll();await S.load();
 const team=await C.saveTeam({name:'Тест'}),player=await C.savePlayer({teamId:team.id,name:'Тестова А',number:1,position:'setter'});
 const input={...buildVolleyImport(parseVolleyRows(rows),0,{1:player.id}),teamId:team.id};
 const m=await C.saveVolleyImport(input);assert.equal(m.stats[player.id].points,2);
 await assert.rejects(C.saveVolleyImport(input),/уже/);
 const broken=structuredClone(input);broken.imported.hash='b'.repeat(64);broken.imported.rallies.pop();await assert.rejects(C.saveVolleyImport({...broken,opponent:'Другой'}));
 assert.equal((await C.loadCoach()).coachMatches.length,1);
 const stat=C.playerSeasonStats([m],player.id);assert.equal(stat.importedMatches,1);assert.equal(stat.importedServiceWins,2);assert.equal(stat.rates.attack.total,0);
 const backup=await S.makeBackup();assert.equal(backup.version,14);await S.restoreBackup(backup);assert.equal((await C.loadCoach()).coachMatches[0].imported.rallies.length,3);
});
