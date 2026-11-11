// Depuración de la red de seguridad de alineación en un caso: parámetros de la foto y burbujas que salen
// desalineadas. Uso: npx tsx tests/bench/dump-align.ts <semilla>

import { scanSheet } from '../../src/scanner/scan';
import { makeCase } from './cases';
import { Rng } from './rng';

for (const seed of process.argv.slice(2).map(Number)) {
  const c = makeCase(seed, new Rng(seed * 7919 + 13));
  const p = c.photoParams;
  console.log(
    `semilla ${seed}: ${p.width}x${p.height} ${p.pxPerMm.toFixed(2)} px/mm, desenfoque ${p.blurSigma.toFixed(2)}, ruido ${p.noise.toFixed(1)}, ` +
      `jpeg ${p.jpegQuality}, combado ${p.bend.toFixed(2)}, sombra ${p.shadow ? p.shadow.strength.toFixed(2) + '/' + p.shadow.softness.toFixed(0) : '-'}, ` +
      `luz ${p.light.map((v) => v.toFixed(2))}, negro ${p.black.toFixed(0)}, blanco ${p.white.toFixed(0)}, tapado ${c.occludedMarker}`,
  );
  const res = scanSheet(c.photo.image, () => c.layout);
  console.log('   ', res.ok ? 'leída' : `${res.message} · ${res.detail ?? ''}`);
  if (!res.ok && res.code === 'alineacion') {
    const loose = scanSheet(c.photo.image, () => c.layout, { skipAlignmentCheck: true });
    if (loose.ok) {
      const errs = [...loose.id.flat(), ...loose.answers.flat()].length;
      console.log(`    sin la comprobación se habría leído (${errs} burbujas), alineación ${JSON.stringify(loose.quality.alignment)}`);
    }
  }
}
