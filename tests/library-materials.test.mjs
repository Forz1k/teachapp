import 'fake-indexeddb/auto';import test from 'node:test';import assert from 'node:assert/strict';
import {ktpMaterial,tacticMaterial,documentMaterial,validateMaterial,instantiateMaterial,saveMaterial} from '../js/library-materials.js';
import {libraryBundle,parseLibrary,importLocalLibrary} from '../js/portable-library.js';
import * as db from '../js/db.js';
test('KTP snapshot omits class IDs and creates fresh unassigned topics',async()=>{
 await db.clearAll();const r=ktpMaterial({id:'k',name:'Тест',classIds:['private']},[{id:'t',ktpId:'k',name:'Бег',ktpOrder:1,activityIds:['run','custom-private']}]);assert.deepEqual(r.topics,[{name:'Бег',activityIds:['run']}]);assert.equal(JSON.stringify(r).includes('private'),false);await saveMaterial(r);
 const imported=await importLocalLibrary(JSON.stringify(libraryBundle([r])),true);assert.equal(imported.count,1);const k=await instantiateMaterial(imported.records[0],{confirmed:true});assert.deepEqual(k.classIds,[]);assert.notEqual(k.id,'k');const topics=await db.transaction(['topics'],'readonly',s=>s.topics.index('ktpId').getAll(k.id));assert.equal(topics.length,1);assert.equal(topics[0].activitiesConfirmed,false);assert.notEqual(topics[0].id,'t');
});
test('tactic template detaches team and replaces identifying labels',()=>{
 const r=tacticMaterial({name:'Тест',teamId:'private',note:'private',markers:[{id:'secret',label:'secret',side:'ours',x:100,y:100}],arrows:[]});assert.equal(r.markers[0].label,'1');assert.equal(r.note,'');assert.equal(JSON.stringify(r).includes('private'),false);assert.throws(()=>validateMaterial({...r,teamId:'private'}));assert.equal(parseLibrary(JSON.stringify(libraryBundle([r]))).records.length,1);
});
test('document template validates type and whitelists fields',()=>{
 const r=documentMaterial('lesson',{title:'Тест',author:'private'});assert.equal(Object.hasOwn(r.preset,'author'),false);assert.throws(()=>validateMaterial({...r,type:'invalid'}));
});
