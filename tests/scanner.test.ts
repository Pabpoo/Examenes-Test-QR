import { describe, expect, it } from 'vitest';
import { AR } from '../src/scanner/vendor/aruco/aruco.js';
import { MARKERS, markerBits, markerCorners } from '../src/shared/sheet/frame';
import { applyHomography, multiply, type Homography } from '../src/scanner/homography';
import { evaluateCase } from './bench/evaluate';
import { downscaleToGray } from '../src/scanner/image';
import { detectMarkers } from '../src/scanner/markers';
import { scanSheet } from '../src/scanner/scan';
import { makeCase } from './bench/cases';
import { Rng } from './bench/rng';
import type { PhotoParams } from './bench/camera';

const CLEAN: PhotoParams = {
  width: 1080,
  height: 1920,
  pxPerMm: 4.6,
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
};

describe('marcadores', () => {
  it('los bits impresos coinciden con el diccionario del detector', () => {
    const dict = AR.DICTIONARIES.ARUCO_MIP_36h12.codeList;
    for (const m of MARKERS) {
      const bits = markerBits(m.id)
        .flat()
        .map((b) => (b ? '1' : '0'))
        .join('');
      expect(bits).toBe(dict[m.id].toString(2).padStart(36, '0'));
    }
  });

  it('detecta los cuatro y devuelve las esquinas en el orden del marcador, incluso con la hoja girada', () => {
    for (const roll of [0, Math.PI / 2, Math.PI, 4.0]) {
      const c = makeCase(1, new Rng(1), true, { ...CLEAN, roll });
      const small = downscaleToGray(c.photo.image, 1280);
      const found = detectMarkers(small.image);
      expect(found.map((m) => m.id)).toEqual([0, 1, 2, 3]);
      for (const m of found) {
        const expected = markerCorners(MARKERS[m.id]).map((p) => applyHomography(c.photo.sheetToImage, p.x, p.y));
        m.corners.forEach((corner, k) => {
          const e = expected[k];
          const dist = Math.hypot(corner.x / small.scale - e.x, corner.y / small.scale - e.y);
          expect(dist).toBeLessThan(4);
        });
      }
    }
  });
});

describe('red de seguridad de alineación', () => {
  const c = makeCase(11, new Rng(11), true, { ...CLEAN, pxPerMm: 4 });
  // Desplaza la hoja `dx`, `dy` mm y la gira `rot` radianes alrededor de la esquina superior izquierda antes de
  // aplicar la homografía buena: como si los marcadores se hubieran localizado mal.
  const perturb = (dx: number, dy: number, rot = 0) => (h: Homography) =>
    multiply(h, new Float64Array([Math.cos(rot), -Math.sin(rot), dx, Math.sin(rot), Math.cos(rot), dy, 0, 0, 1]));

  it('sin alterar, la hoja se lee', () => {
    const r = evaluateCase(c);
    expect(r.ok, r.failure).toBe(true);
    expect(r.silentErrors).toEqual([]);
  });

  for (const [dx, dy, rot] of [
    [1.5, 0, 0],
    [0, 2, 0],
    [2.5, 0, 0],
    [0, 3, 0],
    [3.5, 1, 0],
    [0, 0, 0.012],
    [0, 0, 0.02],
  ] as const) {
    it(`con la alineación desviada (${dx}, ${dy}) mm y ${rot} rad: o se rechaza o se lee sin errores`, () => {
      const r = evaluateCase(c, { adjustHomography: perturb(dx, dy, rot) });
      if (r.ok) expect(r.silentErrors).toEqual([]);
      else expect(r.failure).toMatch(/^alineacion/);
    });
  }
});

describe('lectura completa', () => {
  it('lee una hoja limpia sin dudas inesperadas', () => {
    const c = makeCase(7, new Rng(7), true, CLEAN);
    const res = scanSheet(c.photo.image, (code) => (code.versionId === c.code.versionId ? c.layout : null));
    expect(res.ok, res.ok ? '' : res.message).toBe(true);
    if (!res.ok) return;
    expect(res.code).toEqual(c.code);
    const idRead = res.id.map((col) => col.findIndex((b) => b.state === 'marcada'));
    expect(idRead).toEqual(c.idDigits.map((d, i) => (c.marks.id[i][d] === 'boli' || c.marks.id[i][d] === 'lapiz' ? d : idRead[i])));
  });
});
