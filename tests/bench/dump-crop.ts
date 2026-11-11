// Guarda, ampliado ×4 sin suavizar, el trozo de la foto original donde cae el QR. Uso: npx tsx tests/bench/dump-crop.ts <semilla>

import { mkdirSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { QR_RECT } from '../../src/shared/sheet/frame';
import { applyHomography } from '../../src/scanner/homography';
import { makeCase } from './cases';
import { Rng } from './rng';

const seed = Number(process.argv[2] ?? 136);
const c = makeCase(seed, new Rng(seed * 7919 + 13));
const H = c.photo.sheetToImage;
const pts = [
  [QR_RECT.x - 3, QR_RECT.y - 3],
  [QR_RECT.x + QR_RECT.w + 3, QR_RECT.y - 3],
  [QR_RECT.x + QR_RECT.w + 3, QR_RECT.y + QR_RECT.h + 3],
  [QR_RECT.x - 3, QR_RECT.y + QR_RECT.h + 3],
].map(([x, y]) => applyHomography(H, x, y));
const x0 = Math.floor(Math.min(...pts.map((p) => p.x)));
const y0 = Math.floor(Math.min(...pts.map((p) => p.y)));
const x1 = Math.ceil(Math.max(...pts.map((p) => p.x)));
const y1 = Math.ceil(Math.max(...pts.map((p) => p.y)));
const k = 4;
const w = (x1 - x0) * k;
const h = (y1 - y0) * k;
const out = Buffer.alloc(w * h * 4);
const img = c.photo.image;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const sx = x0 + Math.floor(x / k);
    const sy = y0 + Math.floor(y / k);
    const i = (sy * img.width + sx) * 4;
    out.set([img.data[i], img.data[i + 1], img.data[i + 2], 255], (y * w + x) * 4);
  }
}
mkdirSync('tests/bench/out', { recursive: true });
writeFileSync(`tests/bench/out/recorte-${seed}.jpg`, jpeg.encode({ width: w, height: h, data: out }, 95).data);
console.log(`recorte ${x1 - x0}×${y1 - y0} px`);
