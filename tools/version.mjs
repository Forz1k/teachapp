// npm version обновляет package.json и lock-файл перед вызовом этого скрипта.
import { readFileSync, writeFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const { version } = JSON.parse(read('package.json'));
const check = process.argv.includes('--check');
const worker = read('sw.js');
const declaration = /^const VERSION = 'v[^']+';/m;
if (!declaration.test(worker)) throw new Error('Не найдена версия Service Worker');
const files = {
  'sw.js': worker.replace(declaration, `const VERSION = 'v${version}';`),
  'js/version.js': `export const APP_VERSION = '${version}';\n`,
};
if (!read('CHANGELOG.md').split(/\r?\n/).includes('## ' + version)) {
  throw new Error('Добавьте описание выпуска в CHANGELOG.md');
}
for (const [path, content] of Object.entries(files)) {
  if (!check) writeFileSync(path, content);
  else if (read(path) !== content) throw new Error('Версия не совпадает: ' + path);
}
const lock = JSON.parse(read('package-lock.json'));
if ([lock.version, lock.packages[''].version].some(v => v !== version)) {
  throw new Error('Версия package-lock.json не совпадает');
}
