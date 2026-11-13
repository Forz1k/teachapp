/* tools/validate.mjs — проверка целостности проекта перед публикацией:
   синтаксис модулей, наличие всех файлов из precache-списка, валидность манифеста. */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

let errors = 0;
const ok = (msg) => console.log('  ✓ ' + msg);
const bad = (msg) => { console.log('  ✗ ' + msg); errors += 1; };

/* 1. Манифест */
console.log('Манифест:');
try {
  const m = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
  if (m.name && m.short_name && m.start_url && m.display === 'standalone') ok('обязательные поля на месте');
  else bad('не хватает обязательных полей');
  if (m.icons && m.icons.length >= 2) ok(`${m.icons.length} иконки`);
  else bad('мало иконок');
  for (const icon of m.icons) {
    if (existsSync(icon.src.replace('./', ''))) ok('файл ' + icon.src);
    else bad('нет файла ' + icon.src);
  }
} catch (e) {
  bad('manifest.webmanifest невалиден: ' + e.message);
}

/* 2. Precache-список service worker */
console.log('\nФайлы из precache (sw.js):');
const sw = readFileSync('sw.js', 'utf8');
const list = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
if (!list) {
  bad('не найден PRECACHE');
} else {
  const files = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  let missing = 0;
  for (const f of files) {
    const path = f === './' ? 'index.html' : f.replace('./', '');
    if (!existsSync(path)) { bad('нет файла ' + f); missing += 1; }
  }
  if (!missing) ok(`все ${files.length} файлов существуют`);
}

/* 3. Синтаксис JS */
console.log('\nСинтаксис модулей:');
const modules = [
  'js/app.js', 'js/db.js', 'js/model.js', 'js/store.js', 'js/ui.js', 'js/export.js', 'js/demo.js',
  'js/screens/classes.js', 'js/screens/journal.js', 'js/screens/monthly.js',
  'js/screens/exemptions.js', 'js/screens/lesson.js', 'js/screens/settings.js',
  'sw.js',
];
for (const m of modules) {
  const r = spawnSync(process.execPath, ['--check', m], { encoding: 'utf8' });
  if (r.status === 0) ok(m);
  else bad(m + ': ' + (r.stderr || '').split('\n')[0]);
}

/* 4. Импорты указывают на существующие файлы */
console.log('\nИмпорты:');
for (const m of modules) {
  const src = readFileSync(m, 'utf8');
  const imports = [...src.matchAll(/from\s+'(\.[^']+)'/g)].map((x) => x[1]);
  for (const imp of imports) {
    const base = m.includes('/') ? m.slice(0, m.lastIndexOf('/')) : '.';
    const target = new URL(imp, 'file:///' + base + '/').pathname.slice(1);
    if (!existsSync(decodeURIComponent(target))) bad(`${m} → ${imp} не найден`);
  }
}
ok('проверка импортов завершена');

/* 5. Запрет внешних ресурсов в HTML/CSS */
console.log('\nВнешние ресурсы (должно быть 0):');
const html = readFileSync('index.html', 'utf8');
const css = readFileSync('css/app.css', 'utf8');
const externals = [
  ...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g),
  ...css.matchAll(/url\((https?:\/\/[^)]+)\)/g),
];
if (externals.length) {
  for (const e of externals) bad('внешний ресурс: ' + e[1]);
} else {
  ok('нет ссылок на CDN — офлайн не сломается');
}

/* 6. Ключевые размеры */
console.log('\nРазмер файлов:');
for (const f of ['vendor/xlsx.full.min.js', 'css/app.css', 'js/app.js', 'js/store.js', 'js/model.js']) {
  if (existsSync(f)) {
    const kb = Math.round(readFileSync(f).length / 1024);
    ok(`${f} — ${kb} КБ`);
  }
}

console.log(`\n${errors ? '❌ Ошибок: ' + errors : '✅ Всё чисто'}`);
process.exitCode = errors ? 1 : 0;
