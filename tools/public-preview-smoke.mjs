/* Synthetic public-origin rehearsal. No real credentials, network or data. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {webkit,devices} from 'playwright';
const root=resolve(process.argv[2]||process.cwd()),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
 try{const u=new URL(req.url,'http://127.0.0.2'),file=resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+sep))throw Error('Path');const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{if(!res.headersSent)res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.2',resolve);});
const origin='http://127.0.0.2:'+server.address().port;
let browser;
try{
 browser=await webkit.launch();
 const context=await browser.newContext({...devices['iPhone 13'],locale:'ru-RU',serviceWorkers:'block'});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/index.html?secure-migration=1');
 await page.getByRole('heading',{name:'Экспериментальный перенос отключён'}).waitFor({timeout:90000});
 assert.equal(await page.locator('input[type=password],input[type=file]').count(),0);
 await page.getByRole('button',{name:'Вернуться без изменений'}).click();
 await page.locator('.workspace-nav').waitFor({timeout:90000});
 const before=await page.evaluate(async()=>{const D=await import('/js/db.js');return {version:(await D.open()).version,data:JSON.stringify(await D.dumpAll())};});
 assert.equal(before.version,10);
 await page.goto(origin+'/index.html?secure-recovery=1');
 await page.getByRole('heading',{name:'Экспериментальный перенос отключён'}).waitFor({timeout:90000});
 assert.equal(await page.locator('input[type=password],input[type=file]').count(),0);
 await page.getByRole('button',{name:'Вернуться без изменений'}).click();
 await page.locator('.workspace-nav').waitFor({timeout:90000});
 assert.deepEqual(await page.evaluate(async()=>{const D=await import('/js/db.js');return {version:(await D.open()).version,data:JSON.stringify(await D.dumpAll())};}),before);
 await page.evaluate(async()=>{(await import('/js/screens/sync.js')).openSync();});
 await page.getByText('Расширенные настройки',{exact:true}).click();
 assert.deepEqual(await page.locator('select[aria-label="Протокол обмена"] option').evaluateAll(nodes=>nodes.map(n=>n.value)),['snapshot']);
 assert.equal(await page.getByRole('button',{name:/Перенос \/ возврат Delta/}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('PUBLIC PREVIEW PASS: non-allowlisted origin blocks direct v11 migration and recovery, unchanged v10 records, ordinary snapshot sync only. Synthetic origin, no production requests.');
 await context.close();
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
