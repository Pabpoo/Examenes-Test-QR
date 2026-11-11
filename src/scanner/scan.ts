import { MARKERS, MARKER_CELL, MARKER_SIZE, PAGE_H, PAGE_W, markerCorners, type Point } from '../shared/sheet/frame';
import type { SheetLayout } from '../shared/sheet/layout';
import type { SheetCode } from '../shared/sheet/qr-payload';
import { classify, emptyLevel, measureBubbles, verifyAlignment, type BubbleRead } from './bubbles';
import { applyHomography, findHomography, type Homography } from './homography';
import { normalizeIllumination } from './illumination';
import { downscaleToGray, rgbaToGray, type GrayImage, type RgbaImage } from './image';
import { detectMarkers, type DetectedMarker } from './markers';
import { readSheetQr } from './qr';
import { refineMarkerCorners } from './refine';
import { RECT_SCALE, bilinear, imageScaleAtCenter, rectify } from './rectify';

// Flujo completo de lectura de una hoja a partir de una foto. Sin DOM: recibe píxeles y devuelve la lectura.

/** Lado mayor de la imagen reducida en la que se buscan los marcadores. */
export const DETECT_SIDE = 1280;
const DETECT_SIDE_RETRY = 2048;

/** Límites de calidad. Calibrados con el banco sintético; revisar con fotos reales. */
export const QUALITY = {
  /** Mínimo de píxeles por milímetro de hoja en la foto. */
  minPxPerMm: 2.2,
  /** Relación mínima entre lados opuestos de la hoja en la foto (perspectiva). */
  minSideRatio: 0.55,
  /** Ancho máximo del borde de un marcador (mm, del 20 al 80 %): por encima, la foto está movida o desenfocada. */
  maxEdgeMm: 1.0,
};

export type ScanErrorCode = 'sin_marcadores' | 'calidad' | 'qr_ilegible' | 'hoja_desconocida' | 'alineacion';

export interface ScanError {
  ok: false;
  code: ScanErrorCode;
  message: string;
  /** Detalle técnico para depurar (no para el profesor). */
  detail?: string;
  markers: DetectedMarker[];
  /** Esquinas de la hoja en la foto, si se llegó a localizar. */
  sheetCorners?: Point[];
}

export interface SheetQuality {
  markersFound: number[];
  pxPerMm: number;
  sideRatio: number;
  edgeMm: number;
  qrMethod: 'directo' | 'rejilla' | null;
  /** Burbujas comprobadas en la red de seguridad de alineación y cuántas salieron desalineadas. */
  alignment: { checked: number; misaligned: number };
}

export interface ScanOptions {
  /** Solo para pruebas: altera la homografía para comprobar que una mala alineación se rechaza. */
  adjustHomography?: (h: Homography) => Homography;
  /** Solo para pruebas: no rechaza la hoja aunque la comprobación de alineación falle. */
  skipAlignmentCheck?: boolean;
}

export interface SheetReading {
  ok: true;
  code: SheetCode;
  layout: SheetLayout;
  /** `id[columna][cifra]`. */
  id: BubbleRead[][];
  /** Una fila por pregunta de la hoja, en el orden de `layout.questions`. */
  answers: BubbleRead[][];
  emptyLevel: number;
  quality: SheetQuality;
  /** Hoja enderezada (gris 0–255) a RECT_SCALE px/mm, para recortes y para pintar la lectura. */
  rectified: GrayImage;
  sheetToImage: Homography;
  sheetCorners: Point[];
  timings: Record<string, number>;
}

export type ScanResult = SheetReading | ScanError;

export type LayoutResolver = (code: SheetCode) => SheetLayout | null;

/**
 * Correspondencia entre el orden de esquinas que da el detector y el de `markerCorners`. El detector devuelve las
 * esquinas en el sentido de las agujas del reloj empezando por la que corresponde a la esquina superior izquierda
 * del propio marcador; se comprueba en tests/scanner.test.ts.
 */
const CORNER_SHIFT = 0;

/**
 * Pasa las esquinas detectadas en la imagen reducida a la foto completa (los contornos dan índices de píxel, cuyo
 * centro está en +0,5) y las afina al subpíxel sobre la foto.
 */
function toFullResolution(markers: DetectedMarker[], scale: number, gray: GrayImage): DetectedMarker[] {
  return markers.map((m) => {
    const rough = m.corners.map((c) => ({ x: (c.x + 0.5) / scale, y: (c.y + 0.5) / scale }));
    return { ...m, corners: refineMarkerCorners(gray, rough) as DetectedMarker['corners'] };
  });
}

function correspondences(markers: DetectedMarker[]): { sheet: Point[]; image: Point[] } {
  const sheet: Point[] = [];
  const image: Point[] = [];
  for (const m of markers) {
    const spec = MARKERS[m.id];
    const sc = markerCorners(spec);
    for (let k = 0; k < 4; k++) {
      sheet.push(sc[(k + CORNER_SHIFT) % 4]);
      image.push(m.corners[k]);
    }
  }
  return { sheet, image };
}

function reprojectionError(h: Homography, sheet: Point[], image: Point[]): number {
  let worst = 0;
  for (let i = 0; i < sheet.length; i++) {
    const p = applyHomography(h, sheet[i].x, sheet[i].y);
    worst = Math.max(worst, Math.hypot(p.x - image[i].x, p.y - image[i].y));
  }
  return worst;
}

/** Homografía hoja → foto con los marcadores; descarta uno si no encaja con los demás. */
function sheetHomography(markers: DetectedMarker[]): { h: Homography; used: DetectedMarker[] } | null {
  const tryWith = (ms: DetectedMarker[]) => {
    const { sheet, image } = correspondences(ms);
    const h = findHomography(sheet, image);
    if (!h) return null;
    const pxPerMm = imageScaleAtCenter(h);
    const err = reprojectionError(h, sheet, image) / pxPerMm;
    return { h, err, used: ms };
  };
  const all = tryWith(markers);
  if (all && all.err < MARKER_SIZE * 0.08) return { h: all.h, used: markers };
  if (markers.length === 4) {
    let best: ReturnType<typeof tryWith> = null;
    for (let i = 0; i < 4; i++) {
      const r = tryWith(markers.filter((_, j) => j !== i));
      if (r && (!best || r.err < best.err)) best = r;
    }
    if (best && best.err < MARKER_SIZE * 0.05) return { h: best.h, used: best.used };
  }
  return null;
}

function sheetCornersInImage(h: Homography): Point[] {
  return [
    applyHomography(h, 0, 0),
    applyHomography(h, PAGE_W, 0),
    applyHomography(h, PAGE_W, PAGE_H),
    applyHomography(h, 0, PAGE_H),
  ];
}

function sideRatio(c: Point[]): number {
  const d = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const top = d(c[0], c[1]);
  const bottom = d(c[3], c[2]);
  const left = d(c[0], c[3]);
  const right = d(c[1], c[2]);
  return Math.min(Math.min(top, bottom) / Math.max(top, bottom), Math.min(left, right) / Math.max(left, right));
}

/**
 * Nitidez: ancho (mm) de la transición blanco → negro en los bordes exteriores de los marcadores encontrados,
 * medido sobre la hoja enderezada. Una foto nítida da unas décimas de milímetro.
 */
function markerEdgeWidth(rect: GrayImage, scale: number, used: DetectedMarker[]): number {
  const widths: number[] = [];
  const step = 0.05;
  for (const m of used) {
    const spec = MARKERS[m.id];
    const s = MARKER_SIZE;
    // Cada borde: punto de partida, dirección a lo largo del borde y normal hacia dentro.
    const edges = [
      { o: { x: spec.x, y: spec.y }, along: { x: 1, y: 0 }, inward: { x: 0, y: 1 } },
      { o: { x: spec.x + s, y: spec.y }, along: { x: 0, y: 1 }, inward: { x: -1, y: 0 } },
      { o: { x: spec.x, y: spec.y + s }, along: { x: 1, y: 0 }, inward: { x: 0, y: -1 } },
      { o: { x: spec.x, y: spec.y }, along: { x: 0, y: 1 }, inward: { x: 1, y: 0 } },
    ];
    for (const e of edges) {
      for (const t of [0.3, 0.5, 0.7]) {
        const base = { x: e.o.x + e.along.x * s * t, y: e.o.y + e.along.y * s * t };
        const prof: number[] = [];
        for (let d = -1.6; d <= MARKER_CELL * 0.8; d += step) {
          prof.push(bilinear(rect, (base.x + e.inward.x * d) * scale - 0.5, (base.y + e.inward.y * d) * scale - 0.5));
        }
        const hi = Math.max(...prof.slice(0, 10));
        const lo = Math.min(...prof.slice(-6));
        if (hi - lo < 30) continue;
        const at = (f: number) => prof.findIndex((v) => v <= hi - (hi - lo) * f);
        const a = at(0.2);
        const b = at(0.8);
        if (a >= 0 && b >= a) widths.push((b - a) * step);
      }
    }
  }
  if (widths.length === 0) return Infinity;
  widths.sort((a, b) => a - b);
  return widths[widths.length >> 1];
}

export function scanSheet(img: RgbaImage, resolve: LayoutResolver, options: ScanOptions = {}): ScanResult {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const lap = (name: string, from: number) => {
    timings[name] = Math.round(performance.now() - from);
    return performance.now();
  };

  let t = t0;
  let small = downscaleToGray(img, DETECT_SIDE);
  let markers = detectMarkers(small.image);
  // Hoja lejana: los marcadores quedan muy pequeños en la imagen reducida. Se repite con más resolución.
  if (markers.length < 3 && Math.max(img.width, img.height) > DETECT_SIDE) {
    const bigger = downscaleToGray(img, DETECT_SIDE_RETRY);
    const again = detectMarkers(bigger.image);
    if (again.length > markers.length) {
      small = bigger;
      markers = again;
    }
  }
  t = lap('marcadores', t);
  if (markers.length < 3) {
    return {
      ok: false,
      code: 'sin_marcadores',
      message:
        markers.length === 0
          ? 'No se ve la hoja de respuestas. Encuadra la hoja entera con sus cuatro cuadrados negros.'
          : 'Solo se ven algunos cuadrados de las esquinas. Encuadra la hoja entera.',
      markers,
    };
  }
  const gray = rgbaToGray(img);
  markers = toFullResolution(markers, small.scale, gray);
  t = lap('esquinas', t);
  const located = sheetHomography(markers);
  if (!located) {
    return {
      ok: false,
      code: 'sin_marcadores',
      message: 'Los cuadrados de las esquinas no encajan. Pon la hoja plana y vuelve a intentarlo.',
      markers,
    };
  }
  const { used } = located;
  const h = options.adjustHomography ? options.adjustHomography(located.h) : located.h;
  const corners = sheetCornersInImage(h);
  const pxPerMm = imageScaleAtCenter(h);
  const ratio = sideRatio(corners);
  if (pxPerMm < QUALITY.minPxPerMm) {
    return {
      ok: false,
      code: 'calidad',
      message: 'La hoja sale muy pequeña. Acerca el móvil.',
      markers,
      sheetCorners: corners,
    };
  }
  if (ratio < QUALITY.minSideRatio) {
    return {
      ok: false,
      code: 'calidad',
      message: 'La hoja sale muy inclinada. Pon el móvil más paralelo a la hoja.',
      markers,
      sheetCorners: corners,
    };
  }

  const rect = rectify(gray, h, RECT_SCALE);
  t = lap('enderezar', t);
  const edgeMm = markerEdgeWidth(rect, RECT_SCALE, used);
  if (edgeMm > QUALITY.maxEdgeMm) {
    return {
      ok: false,
      code: 'calidad',
      message: 'La foto está movida o desenfocada. Sujeta el móvil quieto un momento.',
      markers,
      sheetCorners: corners,
    };
  }

  const norm = normalizeIllumination(rect);
  t = lap('luz', t);
  const qr = readSheetQr(rect, norm, RECT_SCALE);
  t = lap('qr', t);
  if (!qr.code) {
    return {
      ok: false,
      code: 'qr_ilegible',
      message: qr.raw
        ? 'El código QR no es de una hoja de esta aplicación.'
        : 'No se puede leer el código QR de la hoja. Prueba con más luz o más cerca.',
      markers,
      sheetCorners: corners,
    };
  }
  const layout = resolve(qr.code);
  if (!layout) {
    return {
      ok: false,
      code: 'hoja_desconocida',
      message: 'Esta hoja es de un examen que no está en la aplicación.',
      markers,
      sheetCorners: corners,
    };
  }

  const centers: Point[] = [...layout.id.bubbles.flat(), ...layout.questions.flatMap((q) => q.options)];
  const measured = measureBubbles(norm, RECT_SCALE, centers);
  const base = emptyLevel(measured.map((m) => m.fill));
  const reads: BubbleRead[] = measured.map((m) => {
    const score = Math.max(0, m.fill - base);
    return { at: m.at, fill: m.fill, score, contour: m.contour, state: classify(score) };
  });
  t = lap('burbujas', t);
  const alignment = verifyAlignment(norm, RECT_SCALE, reads);
  lap('comprobación', t);
  if (!alignment.ok && !options.skipAlignmentCheck) {
    return {
      ok: false,
      code: 'alineacion',
      message: 'La hoja no ha quedado bien alineada (¿está doblada o arrugada?). Ponla plana y repite la foto.',
      detail:
        `${alignment.misaligned} de ${alignment.checked} burbujas comprobadas fuera de sitio` +
        (alignment.worst
          ? `; peor zona en (${alignment.worst.at.x.toFixed(0)}, ${alignment.worst.at.y.toFixed(0)}) mm con un ${Math.round(alignment.worst.fraction * 100)} %`
          : ''),
      markers,
      sheetCorners: corners,
    };
  }
  let k = 0;
  const id = layout.id.bubbles.map((col) => col.map(() => reads[k++]));
  const answers = layout.questions.map((q) => q.options.map(() => reads[k++]));
  timings.total = Math.round(performance.now() - t0);

  return {
    ok: true,
    code: qr.code,
    layout,
    id,
    answers,
    emptyLevel: base,
    quality: {
      markersFound: markers.map((m) => m.id),
      pxPerMm,
      sideRatio: ratio,
      edgeMm,
      qrMethod: qr.method,
      alignment: { checked: alignment.checked, misaligned: alignment.misaligned },
    },
    rectified: rect,
    sheetToImage: h,
    sheetCorners: corners,
    timings,
  };
}
