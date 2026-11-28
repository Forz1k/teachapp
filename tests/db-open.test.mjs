import test from 'node:test';
import assert from 'node:assert/strict';
import {open} from '../js/db.js';

test('IndexedDB opening: concurrent callers, blocked upgrade, retry and connection lifecycle', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const requests = [];
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {open() { const req = {}; requests.push(req); return req; }},
  });
  try {
    const first = open();
    const second = open();
    assert.equal(first, second);
    assert.equal(requests.length, 1);
    const rejected = assert.rejects(first, {name: 'DatabaseBlockedError'});
    requests[0].onblocked();
    await rejected;

    let aborted = 0;
    requests[0].transaction = {abort() { aborted++; }};
    requests[0].onupgradeneeded({oldVersion: 9});
    assert.equal(aborted, 1);

    const retry = open();
    assert.equal(requests.length, 2);
    let oldClosed = 0;
    requests[0].result = {close() { oldClosed++; }};
    requests[0].onsuccess();
    assert.equal(oldClosed, 1);

    let closed = 0;
    const connection = {close() { closed++; }};
    requests[1].result = connection;
    requests[1].onsuccess();
    assert.equal(await retry, connection);
    assert.equal(await open(), connection);
    connection.onversionchange();
    assert.equal(closed, 1);

    const afterUpgrade = open();
    assert.equal(requests.length, 3);
    const next = {close() {}};
    requests[2].result = next;
    requests[2].onsuccess();
    assert.equal(await afterUpgrade, next);
    connection.onclose();
    assert.equal(await open(), next);
    next.onclose();

    const failed = open();
    const failure = assert.rejects(failed, {name: 'UnknownError'});
    requests[3].error = new DOMException('Test error', 'UnknownError');
    requests[3].onerror();
    await failure;

    const recovered = open();
    const final = {close() {}};
    requests[4].result = final;
    requests[4].onsuccess();
    assert.equal(await recovered, final);
    final.onversionchange();
  } finally {
    if (original) Object.defineProperty(globalThis, 'indexedDB', original);
    else delete globalThis.indexedDB;
  }
});


test('Newer schema and actual versionchange terminally fence this document, including a subsequent deletion',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'indexedDB'),originalWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),requests=[];
 const window=new EventTarget();let events=0;
 Object.defineProperty(globalThis,'window',{configurable:true,value:window});
 Object.defineProperty(globalThis,'indexedDB',{configurable:true,value:{open(){const q={};requests.push(q);return q;}}});
 try{
  const D=await import('../js/db.js?native-fence-test');window.addEventListener(D.NATIVE_STORAGE_FENCED_EVENT,()=>events++);
  const opening=D.open(),connection={close(){}};requests[0].result=connection;requests[0].onsuccess();await opening;
  connection.onversionchange({newVersion:11});assert.equal(events,1);
  await assert.rejects(D.open(),{name:'NativeStorageFencedError'});assert.equal(requests.length,1);
  const E=await import('../js/db.js?native-fence-version-error');const failed=E.open();
  requests[1].error=new DOMException('newer','VersionError');requests[1].onerror();
  await assert.rejects(failed,{name:'NativeStorageFencedError'});await assert.rejects(E.open(),{name:'NativeStorageFencedError'});assert.equal(requests.length,2);
  const F=await import('../js/db.js?native-fence-deletion');const third=F.open();const deleted={close(){}};requests[2].result=deleted;requests[2].onsuccess();await third;
  deleted.onversionchange({newVersion:null});await assert.rejects(F.open(),{name:'NativeStorageFencedError'});assert.equal(events,2);
 }finally{
  if(original)Object.defineProperty(globalThis,'indexedDB',original);else delete globalThis.indexedDB;
  if(originalWindow)Object.defineProperty(globalThis,'window',originalWindow);else delete globalThis.window;
 }
});
