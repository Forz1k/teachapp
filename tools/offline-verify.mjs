/* tools/offline-verify.mjs — главная проверка: приложение открывается БЕЗ сервера.
   Шаги:
     1) с сети заполнить кэш (SW),
     2) остановить сервер,
     3) открыть приложение с тем же профилем и убедиться, что интерфейс отрисован. */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, rmSync } from 'node:fs';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const PROFILE = 'D:\\projects\\teachapp\\shots\\cdpprof';
const PORT = 9333;
const APP_URL = 'http://127.0.0.1:8099/index.html';

if (process.argv.includes('--clean')) rmSync(PROFILE, { recursive: true, force: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Открывает Edge с CDP и возвращает помощники. */
async function openBrowser() {
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-features=msEdgeSidebarV2,Translate', '--disable-component-update',
    '--disable-background-networking', '--disable-sync',
    `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`,
    '--window-size=390,844', 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 40; i++) {
    try {
      targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      if (targets.length) break;
    } catch { /* ждём */ }
    await sleep(250);
  }
  if (!targets) throw new Error('CDP не поднялся');

  const page = targets.find((t) => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, { res, rej });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) return { error: r.exceptionDetails.text };
    return r.result.value;
  };

  await send('Page.enable');
  return { proc, ws, send, evaluate };
}

const report = [];

/* ---------- шаг 1: прогрев кэша ---------- */
console.log('=== ШАГ 1: прогрев кэша с сетью ===');
{
  const { proc, ws, send, evaluate } = await openBrowser();
  await send('Page.navigate', { url: APP_URL });
  await sleep(4000);

  // Ждём активации SW
  for (let i = 0; i < 30; i++) {
    const st = await evaluate(`(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const names = await caches.keys();
      let total = 0;
      for (const n of names) { total += (await (await caches.open(n)).keys()).length; }
      return JSON.stringify({ sw: reg ? (reg.active ? 'active' : reg.installing ? 'installing' : 'waiting') : 'none', caches: names, total });
    })()`);
    if (typeof st === 'string' && st.includes('"active"') && !st.includes('"total":0')) {
      console.log('состояние:', st);
      report.push('ШАГ 1 (с сетью): ' + st);
      break;
    }
    await sleep(500);
  }

  const bodyText = await evaluate('document.body.innerText.slice(0, 200)');
  console.log('DOM с сети:', JSON.stringify(bodyText));
  report.push('ШАГ 1 DOM: ' + JSON.stringify(bodyText));

  ws.close();
  proc.kill();
  await sleep(1500);
}

/* ---------- шаг 2: остановка сервера ---------- */
console.log('\n=== ШАГ 2: останавливаем сервер ===');
const killed = spawnSync('powershell', ['-NoProfile', '-Command',
  "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*http.server*8099*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }",
], { encoding: 'utf8' });
console.log('остановлены PID:', (killed.stdout || '').trim() || '(не найдены)');
await sleep(1000);

const stillUp = spawnSync('powershell', ['-NoProfile', '-Command',
  "try { (Invoke-WebRequest 'http://127.0.0.1:8099/index.html' -UseBasicParsing -TimeoutSec 3).StatusCode } catch { 'OFFLINE' }",
], { encoding: 'utf8' });
console.log('сервер:', (stillUp.stdout || '').trim());
report.push('ШАГ 2: сервер ' + (stillUp.stdout || '').trim());

/* ---------- шаг 3: открыть без сети ---------- */
console.log('\n=== ШАГ 3: открываем приложение БЕЗ сервера ===');
{
  const { proc, ws, send, evaluate } = await openBrowser();
  await send('Page.navigate', { url: APP_URL });
  await sleep(4500);

  const result = await evaluate(`JSON.stringify({
    title: document.title,
    hasTabbar: !!document.querySelector('.tabbar'),
    tabs: [].slice.call(document.querySelectorAll('.tab')).map(function (t) { return t.innerText.trim(); }),
    hasClassCards: document.querySelectorAll('.class-card').length,
    bodyText: document.body.innerText.slice(0, 300),
    moduleLoaded: typeof window.__appReady !== 'undefined' ? window.__appReady : 'n/a',
  })`);
  console.log('результат:', result);
  report.push('ШАГ 3 (без сети): ' + result);

  ws.close();
  proc.kill();
}

writeFileSync('offline-report.txt', report.join('\n\n'), 'utf8');
console.log('\n=== ИТОГ записан в offline-report.txt ===');
