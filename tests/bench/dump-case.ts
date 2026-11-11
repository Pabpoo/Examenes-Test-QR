// Depuración de una pregunta de un caso: posición nominal y corregida de cada burbuja, relleno y estado; y un
// recorte de la hoja enderezada. Uso: npx tsx tests/bench/dump-case.ts <semilla> <pregunta (1…)>

import { mkdirSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { cropGray, grayToRgba } from '../../src/scanner/image';
import { RECT_SCALE, bilinear } from '../../src/scanner/rectify';
import { normalizeIllumination } from '../../src/scanner/illumination';
import { scanSheet } from '../../src/scanner/scan';
import { makeCase } from './cases';
import { Rng } from './rng';

const seed = Number(process.argv[2] ?? 1);
const qn = Number(process.argv[3] ?? 1);
const c = makeCase(seed, new Rng(seed * 7919 + 13));
const res = scanSheet(c.photo.image, () => c.layout);
if (!res.ok) throw new Error(res.message);
const qi = c.layout.questions.findIndex((q) => q.number === qn);
const q = c.layout.questions[qi];
console.log('marcas', c.marks.answers[qi], 'calidad', res.quality, 'parámetros', c.photoParams);
q.options.forEach((p, k) => {
  const b = res.answers[qi][k];
  console.log(
    `opción ${k + 1}: nominal (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) medida en (${b.at.x.toFixed(2)}, ${b.at.y.toFixed(2)}) relleno ${b.fill.toFixed(3)} ${b.state}`,
  );
});
// Valor normalizado alrededor de cada burbuja, cada 0,5 mm (centro de la cuadrícula = posición nominal).
const norm = normalizeIllumination(res.rectified);
q.options.forEach((p, k) => {
  console.log(`opción ${k + 1}, valores normalizados (filas y, columnas x, de −2,5 a 2,5 mm):`);
  for (let dy = -2.5; dy <= 2.5; dy += 0.5) {
    const row: string[] = [];
    for (let dx = -2.5; dx <= 2.5; dx += 0.5) {
      row.push(bilinear(norm, (p.x + dx) * RECT_SCALE - 0.5, (p.y + dy) * RECT_SCALE - 0.5).toFixed(2));
    }
    console.log('  ' + row.join(' '));
  }
});
const x = (q.options[0].x - 10) * RECT_SCALE;
const y = (q.options[0].y - 8) * RECT_SCALE;
const crop = cropGray(res.rectified, x, y, 60 * RECT_SCALE, 16 * RECT_SCALE);
mkdirSync('tests/bench/out', { recursive: true });
writeFileSync(
  `tests/bench/out/pregunta-${seed}-${qn}.jpg`,
  jpeg.encode({ width: crop.width, height: crop.height, data: Buffer.from(grayToRgba(crop).buffer) }, 95).data,
);
