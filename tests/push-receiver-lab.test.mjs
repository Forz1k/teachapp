import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePushSignalLab,pushReceiverLab} from '../tools/prototypes/push-receiver-lab.mjs';
const scope='http://127.0.0.1:8099/tools/prototypes/push-receiver/',valid='{"version":1,"kind":"workspace-update"}';
const event=text=>({data:{text:()=>text}});
test('Push receiver accepts only the fixed versioned signal, with consent and isolated scope',async()=>{
 const shown=[];let enabled=false;
 const registration={scope,showNotification:async(...args)=>shown.push(args)};
 const r=pushReceiverLab({registration,consent:()=>enabled});
 assert.equal(await r.push(event(valid)),false);enabled=true;
 for(const x of [null,'', '{','[]','{"version":2,"kind":"workspace-update"}','{"version":1,"kind":"workspace-update","url":"https://evil.test"}','{"version":1,"kind":"workspace-update","text":"PRIVATE"}',valid+' '.repeat(129)])assert.equal(parsePushSignalLab(x),false);
 assert.equal(await r.push(event(valid)),true);assert.deepEqual(shown,[['TeachApp',{body:'В личном кабинете есть обновления.',tag:'teachapp-workspace-update-lab',renotify:false}]]);
 assert.equal(await r.push({data:{text(){throw Error('invalid');}}}),false);
 for(const bad of ['https://teachapp.example/tools/prototypes/push-receiver/','http://localhost:8099/','http://localhost:8099/tools/prototypes/push-receiver/?x=1'])assert.throws(()=>pushReceiverLab({registration:{scope:bad}}),/isolated localhost/);
});
test('Click focuses only exact local LAB window, ignores supplied URL and rechecks consent after reading clients',async()=>{
 let enabled=true,closed=0,focused=0,opened=[],windows=[];
 const clients={matchAll:async()=>windows,openWindow:async url=>opened.push(url)};
 const r=pushReceiverLab({registration:{scope},clients,consent:()=>enabled});
 const click=tag=>({notification:{tag,data:{url:'https://evil.test'},close:()=>closed++}});
 assert.equal(await r.click(click('other')),false);assert.equal(closed,0);
 windows=[{url:'https://evil.test/',focus:()=>{throw Error('Wrong focus');}},{url:scope+'index.html?token=PRIVATE',focus:()=>{throw Error('Wrong focus');}},{url:scope+'index.html',focus:async()=>focused++}];
 assert.equal(await r.click(click('teachapp-workspace-update-lab')),true);assert.equal(focused,1);
 windows=[];assert.equal(await r.click(click('teachapp-workspace-update-lab')),true);assert.deepEqual(opened,[scope+'index.html']);
 let release;clients.matchAll=()=>new Promise(r=>release=r);
 const pending=r.click(click('teachapp-workspace-update-lab'));await Promise.resolve();await Promise.resolve();enabled=false;release([]);assert.equal(await pending,false);assert.equal(opened.length,1);assert.equal(closed,3);
});
