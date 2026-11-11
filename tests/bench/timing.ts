// Tiempos de cada paso del escáner en un solo hilo, con fotos de distintos tamaños.
// Uso: npx tsx tests/bench/timing.ts

import { scanSheet } from '../../src/scanner/scan';
import type { PhotoParams } from './camera';
import { makeCase } from './cases';
import { Rng } from './rng';

const base: PhotoParams = {
  width: 1080,
  height: 1920,
  pxPerMm: 5.5,
  roll: 0.05,
  tiltX: 0.2,
  tiltY: -0.1,
  blurSigma: 0.7,
  noise: 3,
  jpegQuality: 80,
  light: [0.8, 1],
  shadow: null,
  bend: 0,
  black: 20,
  white: 230,
};
const sizes: [number, number, number][] = [
  [1080, 1920, 5.5],
  [1440, 2560, 7.5],
  [2250, 3000, 9],
  [3000, 4000, 12],
];
for (const [width, height, pxPerMm] of sizes) {
  const c = makeCase(5, new Rng(5), true, { ...base, width, height, pxPerMm });
  // Primera pasada para calentar el compilador de JavaScript; se mide la segunda.
  scanSheet(c.photo.image, () => c.layout);
  const res = scanSheet(c.photo.image, () => c.layout);
  console.log(`${width}×${height}:`, res.ok ? res.timings : res.message);
}
