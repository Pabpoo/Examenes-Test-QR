// Análisis del banco: distribución del relleno medido por tipo de marca y parámetros de las fotos que fallan.
// Uso: npx tsx tests/bench/analyze.ts [casos=120] [semilla=1]

import { scanSheet } from '../../src/scanner/scan';
import { makeCase } from './cases';
import { Rng } from './rng';

const [nArg, seedArg] = process.argv.slice(2);
const n = Number(nArg ?? 120);
const first = Number(seedArg ?? 1);
const scores = new Map<string, number[]>();
const push = (k: string, v: number) => {
  if (!scores.has(k)) scores.set(k, []);
  scores.get(k)!.push(v);
};

for (let seed = first; seed < first + n; seed++) {
  const c = makeCase(seed, new Rng(seed * 7919 + 13));
  const res = scanSheet(c.photo.image, (code) => (code.versionId === c.code.versionId ? c.layout : null));
  const p = c.photoParams;
  if (!res.ok) {
    console.log(
      `semilla ${seed}: ${res.code} · ${p.width}x${p.height} ${p.pxPerMm.toFixed(2)} px/mm, desenfoque ${p.blurSigma.toFixed(2)}, ` +
        `ruido ${p.noise.toFixed(1)}, jpeg ${p.jpegQuality}, inclinación ${((p.tiltX * 180) / Math.PI).toFixed(0)}/${((p.tiltY * 180) / Math.PI).toFixed(0)}, ` +
        `sombra ${p.shadow ? p.shadow.strength.toFixed(2) : '-'}, tapado ${c.occludedMarker}`,
    );
    continue;
  }
  const lowRes = res.quality.pxPerMm < 3.2 ? ' baja' : '';
  const contours = [...res.id.flat(), ...res.answers.flat()].map((b) => b.contour).sort((a, b) => a - b);
  push('contorno-min', contours[0]);
  push('contorno-p1', contours[Math.floor(contours.length * 0.01)]);
  push('contorno-p10', contours[Math.floor(contours.length * 0.1)]);
  res.answers.forEach((row, qi) =>
    row.forEach((b, k) => {
      const style = c.marks.answers[qi][k] ?? 'vacia';
      push(style, b.score);
      push(style + lowRes, b.score);
    }),
  );
}

const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
for (const [k, v] of [...scores].sort()) {
  v.sort((a, b) => a - b);
  console.log(
    `${k.padEnd(14)} n=${String(v.length).padStart(6)}  min ${v[0].toFixed(3)}  p1 ${q(v, 0.01).toFixed(3)}  p5 ${q(v, 0.05).toFixed(3)}  ` +
      `p50 ${q(v, 0.5).toFixed(3)}  p95 ${q(v, 0.95).toFixed(3)}  p99.9 ${q(v, 0.999).toFixed(3)}  max ${v[v.length - 1].toFixed(3)}`,
  );
}
