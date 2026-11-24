import test from 'node:test';
import assert from 'node:assert/strict';
import {filterHistory,historySummary,compareHistory} from '../js/match-history.js';
const a={id:'a',date:'2026-11-10',opponent:'Ёлочка',competition:'Кубок',sets:[{ours:25,theirs:20},{ours:25,theirs:22}]};
const b={id:'b',date:'2026-11-20',opponent:'Гости',competition:'Кубок',sets:[{ours:20,theirs:25}],imported:true};
test('Фильтры истории и итоги не меняют исходные записи',()=>{assert.deepEqual(filterHistory([a,b],{query:'елочка кубок',outcome:'win'}),[a]);assert.deepEqual(filterHistory([a,b],{source:'imported'}),[b]);assert.deepEqual(filterHistory([a,b],{from:'2026-11-21',to:'2026-11-20'}),[]);const s=historySummary([a,b]);assert.equal(s.wins,1);assert.equal(s.losses,1);assert.equal(s.setsWon,2);assert.equal(s.pointsWon,70);});
test('Сравнение не придумывает проценты из итогового протокола',()=>{const rows=compareHistory(a,b);assert.equal(rows[0].sets,'2:0');assert.equal(rows[0].serve,null);assert.equal(rows[1].source,'imported');assert.equal(compareHistory(a,a),null);});
