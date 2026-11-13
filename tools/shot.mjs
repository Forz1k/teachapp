/* tools/shot.mjs — скриншоты через headless Edge.
   Использует shots/preview.html, которая сама засевает демо и рисует нужный экран.
   Запуск: node tools/shot.mjs */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

const PROFILE = 'D:\\projects\\teachapp\\shots\\profile';
const BASE = 'http://127.0.0.1:8099/shots/preview.html';
const OUT = 'D:\\projects\\teachapp\\shots';

const common = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-features=Translate', `--user-data-dir=${PROFILE}`];

function shot(name, query, size = '390,844', budget = 8000) {
  const args = [...common, `--window-size=${size}`, `--virtual-time-budget=${budget}`,
    `--screenshot=${OUT}\\${name}`, `${BASE}?${query}`];
  const r = spawnSync(EDGE, args, { encoding: 'utf8', timeout: 90000 });
  console.log(`${name}: ${existsSync(`${OUT}\\${name}`) ? 'OK' : 'FAIL'}`);
}

const q = process.argv[2];

const plan = {
  classes: 'screen=classes',
  journal: 'screen=journal',
  monthly: 'screen=monthly',
  exemptions: 'screen=exemptions',
  settings: 'screen=settings',
  sheet: 'screen=sheet',
  osv: 'screen=osv',
  msheet: 'screen=monthly-sheet',
  quick: 'screen=quick',
  empty: 'screen=classes-empty&fresh=1',
  dark: 'screen=journal&theme=dark',
  landscape: 'screen=journal',
};

if (q && plan[q]) {
  const size = q === 'landscape' ? '844,390' : '390,844';
  shot(`${q}.png`, plan[q], size);
} else {
  for (const [name, query] of Object.entries(plan)) {
    const size = name === 'landscape' ? '844,390' : '390,844';
    shot(`${name}.png`, query, size);
  }
}
