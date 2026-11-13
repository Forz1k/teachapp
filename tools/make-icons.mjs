/* make-icons.mjs — генерирует PNG-иконки без внешних зависимостей.
   Рисует оранжевый градиентный фон и белый знак «журнал с галочкой».
   Запуск: node tools/make-icons.mjs */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'icons');
mkdirSync(outDir, { recursive: true });

/* ---------- PNG-энкодер ---------- */

function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- рисование ---------- */

/** Сглаженное покрытие прямоугольника со скругление��и: 0..1 на пиксель. */
function roundRectCoverage(x, y, rx, ry, rw, rh, radius) {
  // расстояние от точки до скруглённого прямоугольника
  const cx = Math.max(rx + radius, Math.min(x, rx + rw - radius));
  const cy = Math.max(ry + radius, Math.min(y, ry + rh - radius));
  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  // Внутри核心 прямоугольника
  if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
    if (radius <= 0) return 1;
    if (dist <= radius) return 1;
  }
  const edge = radius - dist;
  return Math.max(0, Math.min(1, edge + 0.5));
}

/** Сэмплирование со сверхвыборкой (SSAA 3x3) — сглаженные края без библиотек. */
function sample(px, py, fn, ss = 3) {
  let acc = 0;
  for (let sy = 0; sy < ss; sy++) {
    for (let sx = 0; sx < ss; sx++) {
      acc += fn(px + (sx + 0.5) / ss, py + (sy + 0.5) / ss);
    }
  }
  return acc / (ss * ss);
}

function makeIcon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const S = size;

  // Пропорции: у maskable-safe зоны знак меньше
  const pad = maskable ? S * 0.22 : S * 0.16;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;

      // Фон: диагональный градиент оранжевый → янтарный
      const t = ((x / S) * 0.5 + (y / S) * 0.5);
      const r0 = 255, g0 = 122, b0 = 26;     // #FF7A1A
      const r1 = 255, g1 = 178, b1 = 34;     // #FFB222
      let R = Math.round(r0 + (r1 - r0) * t);
      let G = Math.round(g0 + (g1 - g0) * t);
      let B = Math.round(b0 + (b1 - b0) * t);
      let A = 255;

      // Скруглённые углы (для обычной иконки; maskable — во весь квадрат)
      if (!maskable) {
        const rad = S * 0.225;
        const cov = sample(x, y, (px, py) => roundRectCoverage(px, py, 0, 0, S, S, rad));
        A = Math.round(255 * cov);
      }

      // Знак: открытый журнал (две страницы) + галочка
      const cw = S - pad * 2;             // ширина знака
      const ch = cw * 0.78;
      const ox = pad, oy = (S - ch) / 2;
      const white = (px, py) => {
        // левая страница
        const lp = roundRectCoverage(px, py, ox, oy, cw * 0.46, ch, S * 0.035);
        // правая страница (чуть сдвинута)
        const rp = roundRectCoverage(px, py, ox + cw * 0.54, oy, cw * 0.46, ch, S * 0.035);
        return Math.max(lp, rp);
      };

      const markCov = sample(x, y, white);
      if (markCov > 0.01) {
        // Внутри знака — «прорези» под строки и галочку: рисуем вычитанием
        const lineCov = sample(x, y, (px, py) => {
          let v = 0;
          // три коротких строки на левой странице
          for (let k = 0; k < 3; k++) {
            const ly = oy + ch * (0.28 + k * 0.18);
            v = Math.max(v, roundRectCoverage(px, py, ox + cw * 0.09, ly, cw * 0.28, S * 0.022, S * 0.011));
          }
          // галочка на правой странице — два прямоугольника-штриха
          const cx = ox + cw * 0.77;
          const cy = oy + ch * 0.58;
          const th = S * 0.034;
          // штрих 1 (короткий, вниз-вправо)
          v = Math.max(v, strokeCoverage(px, py, cx - S * 0.075, cy - S * 0.005, cx - S * 0.018, cy + S * 0.052, th));
          // штрих 2 (длинный, вверх-вправо)
          v = Math.max(v, strokeCoverage(px, py, cx - S * 0.02, cy + S * 0.052, cx + S * 0.085, cy - S * 0.062, th));
          return v;
        });

        const inkAlpha = markCov * (1 - lineCov * 0.92);
        R = Math.round(R * (1 - inkAlpha) + 255 * inkAlpha);
        G = Math.round(G * (1 - inkAlpha) + 255 * inkAlpha);
        B = Math.round(B * (1 - inkAlpha) + 255 * inkAlpha);
      }

      buf[i] = R; buf[i + 1] = G; buf[i + 2] = B; buf[i + 3] = A;
    }
  }
  return encodePng(S, S, buf);
}

/** Покрытие «капсулы» (толстого отрезка) с радиусом. */
function strokeCoverage(x, y, x1, y1, x2, y2, thickness) {
  const r = thickness / 2;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx, py = y1 + t * dy;
  const dist = Math.hypot(x - px, y - py);
  return Math.max(0, Math.min(1, r - dist + 0.5));
}

const sizes = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
];

for (const [name, size, opts] of sizes) {
  const png = makeIcon(size, opts);
  writeFileSync(join(outDir, name), png);
  console.log(`${name}: ${size}×${size}, ${png.length} байт`);
}
