// Qué hace el escáner cuando la alineación está mal a propósito: o rechaza la hoja o la lee sin errores.
// Uso: npx tsx tests/bench/perturb-check.ts [semilla=11]

import { multiply } from '../../src/scanner/homography';
import { makeCase } from './cases';
import { evaluateCase } from './evaluate';
import { Rng } from './rng';

const seed = Number(process.argv[2] ?? 11);
const c = makeCase(seed, new Rng(seed), true, {
  width: 1080,
  height: 1920,
  pxPerMm: 4,
  roll: 0,
  tiltX: 0,
  tiltY: 0,
  blurSigma: 0.4,
  noise: 1,
  jpegQuality: null,
  light: [1, 1],
  shadow: null,
  bend: 0,
  black: 20,
  white: 240,
});
const cases: [number, number, number][] = [
  [0, 0, 0],
  [0.8, 0, 0],
  [1.2, 0, 0],
  [1.5, 0, 0],
  [2, 0, 0],
  [2.5, 0, 0],
  [3, 0, 0],
  [3.5, 1, 0],
  [5, 0, 0],
  [6.5, 0, 0],
  [0, 6.2, 0],
  [0, 0, 0.006],
  [0, 0, 0.012],
  [0, 0, 0.02],
];
for (const [dx, dy, rot] of cases) {
  const r = evaluateCase(c, {
    adjustHomography: (h) =>
      multiply(h, new Float64Array([Math.cos(rot), -Math.sin(rot), dx, Math.sin(rot), Math.cos(rot), dy, 0, 0, 1])),
  });
  console.log(
    `(${dx}, ${dy}) mm, ${rot} rad: ${r.ok ? `leída · errores ${r.silentErrors.length} · preguntas dudosas ${r.questionsDoubt}` : r.failure}`,
  );
  for (const e of r.silentErrors.slice(0, 3)) console.log('   ! ' + e);
}
