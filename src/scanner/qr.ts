import jsQR from 'jsqr';
import { QR_QUIET, QR_RECT } from '../shared/sheet/frame';
import { decodeSheetCode, type SheetCode } from '../shared/sheet/qr-payload';
import { cropGray, grayToRgba, type GrayImage } from './image';
import { bilinear } from './rectify';

/** Módulos del QR impreso (versión 1). */
const QR_MODULES = 21;

function decode(img: GrayImage): string | null {
  const res = jsQR(grayToRgba(img), img.width, img.height, { inversionAttempts: 'dontInvert' });
  return res?.data ?? null;
}

/**
 * Lectura guiada por la geometría: como la hoja ya está enderezada, se sabe dónde cae cada módulo. Se mide el
 * centro de cada uno, se decide blanco o negro con un umbral de Otsu y se redibuja un QR limpio para el
 * decodificador. Funciona con fotos más pequeñas o desenfocadas que la lectura directa. Prueba pequeños
 * desplazamientos por si la homografía no es exacta en esa esquina.
 */
/** Valor esperado (1 negro, −1 blanco) del cuadro de posición con su separador blanco, 9 × 9 módulos. */
function finderExpected(r: number, c: number): number {
  const d = Math.max(Math.abs(r - 4), Math.abs(c - 4));
  return d === 4 || d === 2 ? -1 : 1;
}

/**
 * Desplazamiento (mm) que mejor encaja un cuadro de posición cuya esquina superior izquierda (módulo r0, c0)
 * debería estar donde dice la geometría. Busca hasta ±1,5 mm.
 */
function locateFinder(norm: GrayImage, scale: number, r0: number, c0: number): { dx: number; dy: number } {
  const cell = QR_RECT.w / QR_MODULES;
  const step = 1 / scale;
  const range = 1.5;
  let best = -Infinity;
  let res = { dx: 0, dy: 0 };
  for (let dy = -range; dy <= range + 1e-9; dy += step) {
    for (let dx = -range; dx <= range + 1e-9; dx += step) {
      let s = 0;
      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          const x = QR_RECT.x + dx + (c0 - 1 + c + 0.5) * cell;
          const y = QR_RECT.y + dy + (r0 - 1 + r + 0.5) * cell;
          s += finderExpected(r, c) * (1 - bilinear(norm, x * scale - 0.5, y * scale - 0.5));
        }
      }
      if (s > best) {
        best = s;
        res = { dx, dy };
      }
    }
  }
  return res;
}

/**
 * Valor medio (normalizado, papel ≈ 1) del centro de cada módulo, fila a fila. Con `aligned`, corrige la posición
 * con un ajuste afín local a partir de los tres cuadros de posición (superior izquierdo, superior derecho e
 * inferior izquierdo), interpolando el desplazamiento según la posición del módulo.
 */
export function sampleQrGrid(norm: GrayImage, scale: number, aligned: boolean): number[] {
  const cell = QR_RECT.w / QR_MODULES;
  let offset = (_r: number, _c: number) => ({ dx: 0, dy: 0 });
  if (aligned) {
    const tl = locateFinder(norm, scale, 0, 0);
    const tr = locateFinder(norm, scale, 0, QR_MODULES - 7);
    const bl = locateFinder(norm, scale, QR_MODULES - 7, 0);
    const span = QR_MODULES - 7;
    offset = (r, c) => ({
      dx: tl.dx + ((tr.dx - tl.dx) * c) / span + ((bl.dx - tl.dx) * r) / span,
      dy: tl.dy + ((tr.dy - tl.dy) * c) / span + ((bl.dy - tl.dy) * r) / span,
    });
  }
  const values: number[] = [];
  for (let r = 0; r < QR_MODULES; r++) {
    for (let c = 0; c < QR_MODULES; c++) {
      const { dx, dy } = offset(r - 3, c - 3);
      let s = 0;
      for (const fy of [0.3, 0.5, 0.7]) {
        for (const fx of [0.3, 0.5, 0.7]) {
          const x = QR_RECT.x + dx + (c + fx) * cell;
          const y = QR_RECT.y + dy + (r + fy) * cell;
          s += bilinear(norm, x * scale - 0.5, y * scale - 0.5);
        }
      }
      values.push(s / 9);
    }
  }
  return values;
}

function decodeByGrid(norm: GrayImage, scale: number): string | null {
  const px = 8;
  const quiet = 4;
  const size = (QR_MODULES + 2 * quiet) * px;
  for (const aligned of [true, false]) {
    const values = sampleQrGrid(norm, scale, aligned);
    const t = otsu(values);
    const data = new Float32Array(size * size).fill(255);
    values.forEach((v, i) => {
      if (v >= t) return;
      const r = Math.floor(i / QR_MODULES);
      const c = i % QR_MODULES;
      for (let y = 0; y < px; y++) data.fill(0, ((quiet + r) * px + y) * size + (quiet + c) * px, ((quiet + r) * px + y) * size + (quiet + c + 1) * px);
    });
    const text = decode({ width: size, height: size, data });
    if (text) return text;
  }
  return null;
}

function otsu(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  let best = sorted[sorted.length >> 1];
  let bestVar = -1;
  let sumAll = 0;
  for (const v of sorted) sumAll += v;
  let sumLow = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    sumLow += sorted[i];
    const nLow = i + 1;
    const nHigh = sorted.length - nLow;
    const mLow = sumLow / nLow;
    const mHigh = (sumAll - sumLow) / nHigh;
    const between = nLow * nHigh * (mLow - mHigh) ** 2;
    if (between > bestVar) {
      bestVar = between;
      best = (sorted[i] + sorted[i + 1]) / 2;
    }
  }
  return best;
}

/**
 * Lee el QR en su posición fija de la hoja enderezada (`scale` px/mm). Primero, lectura directa del recorte; si
 * falla, lectura guiada por la geometría sobre la imagen con la luz normalizada.
 */
export function readSheetQr(
  rectified: GrayImage,
  normalized: GrayImage,
  scale: number,
): { code: SheetCode | null; raw: string | null; method: 'directo' | 'rejilla' | null } {
  const m = QR_QUIET;
  const crop = cropGray(
    rectified,
    (QR_RECT.x - m) * scale,
    (QR_RECT.y - m) * scale,
    (QR_RECT.w + 2 * m) * scale,
    (QR_RECT.h + 2 * m) * scale,
  );
  const direct = decode(crop);
  if (direct) return { code: decodeSheetCode(direct), raw: direct, method: 'directo' };
  const grid = decodeByGrid(normalized, scale);
  if (grid) return { code: decodeSheetCode(grid), raw: grid, method: 'rejilla' };
  return { code: null, raw: null, method: null };
}
