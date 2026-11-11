// Depuración del QR: para los casos dados (o los que fallan en las primeras N semillas), cuántos módulos se leen
// mal con la rejilla, con y sin ajuste a los cuadros de posición.
// Uso: npx tsx tests/bench/dump-qr.ts <semilla> [más semillas…]

import { encodeSheetCode } from '../../src/shared/sheet/qr-payload';
import { qrModules } from '../../src/shared/sheet/qr-matrix';
import { scanSheet } from '../../src/scanner/scan';
import { downscaleToGray, rgbaToGray } from '../../src/scanner/image';
import { detectMarkers } from '../../src/scanner/markers';
import { normalizeIllumination } from '../../src/scanner/illumination';
import { sampleQrGrid } from '../../src/scanner/qr';
import { RECT_SCALE, rectify } from '../../src/scanner/rectify';
import { makeCase } from './cases';
import { Rng } from './rng';

for (const seed of process.argv.slice(2).map(Number)) {
  const c = makeCase(seed, new Rng(seed * 7919 + 13));
  const truth = qrModules(encodeSheetCode(c.code)).flat();
  const rect = rectify(rgbaToGray(c.photo.image), c.photo.sheetToImage, RECT_SCALE);
  const norm = normalizeIllumination(rect);
  const errs = (aligned: boolean) => {
    const v = sampleQrGrid(norm, RECT_SCALE, aligned);
    const sorted = [...v].sort((a, b) => a - b);
    const t = sorted[Math.round(sorted.length * 0.5)];
    return v.filter((x, i) => x < t !== truth[i]).length;
  };
  const res = scanSheet(c.photo.image, () => c.layout);
  const p = c.photoParams;
  const markers = detectMarkers(downscaleToGray(c.photo.image, 1280).image).map((m) => m.id);
  console.log(
    `semilla ${seed}: ${res.ok ? 'leída (' + res.quality.qrMethod + ')' : res.code} · errores rejilla sin ajuste ${errs(false)}, con ajuste ${errs(true)} · ` +
      `${p.pxPerMm.toFixed(2)} px/mm, blur ${p.blurSigma.toFixed(2)}, jpeg ${p.jpegQuality}, combado ${p.bend.toFixed(2)}, marcadores ${markers}`,
  );
}
