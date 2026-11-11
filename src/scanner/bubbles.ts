import type { Point } from '../shared/sheet/frame';
import type { BubbleState } from '../shared/sheet/interpret';
import type { GrayImage } from './image';

// Lectura de burbujas sobre la hoja enderezada y normalizada (papel ≈ 1, tinta ≈ 0).

/** Radio del disco interior que se mide, sin el trazo impreso de la burbuja (mm). */
export const INNER_R = 1.55;
/** Intensidad a partir de la cual un píxel empieza a contar como tinta, y ancho de la rampa. */
const INK_START = 0.85;
const INK_RAMP = 0.35;

/**
 * Umbrales sobre la puntuación de relleno (0 = vacía, 1 = rellena del todo), ya restado el nivel de las burbujas
 * vacías de la hoja. Calibrados con el banco sintético; revisar con las fotos reales.
 */
export const THRESHOLDS = { marked: 0.5, empty: 0.08 };

/** Búsqueda local de la posición real de cada burbuja (papel combado, pequeños errores de la homografía). */
const SEARCH_MM = 0.9;
const RING_IN = 2.05;
const RING_OUT = 2.55;
const OUTER_IN = 2.85;
const OUTER_OUT = 3.15;
const NEIGHBOUR_MM = 14;

export interface BubbleRead {
  /** Centro usado para medir (mm), ya corregido. */
  at: Point;
  /** Relleno bruto del disco interior, 0 a 1. */
  fill: number;
  /** Relleno restado el nivel de las vacías de la hoja. */
  score: number;
  /** Contraste del contorno impreso en la posición medida (alineación). */
  contour: number;
  state: BubbleState;
}

type Offsets = Int32Array;

function diskOffsets(width: number, rIn: number, rOut: number): { dx: Int32Array; dy: Int32Array; idx: Offsets } {
  const dx: number[] = [];
  const dy: number[] = [];
  const r = Math.ceil(rOut);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y);
      if (d >= rIn && d <= rOut) {
        dx.push(x);
        dy.push(y);
      }
    }
  }
  return {
    dx: Int32Array.from(dx),
    dy: Int32Array.from(dy),
    idx: Int32Array.from(dx.map((x, i) => dy[i] * width + x)),
  };
}

function inkAt(v: number): number {
  const t = (INK_START - v) / INK_RAMP;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/** Oscuridad de cada píxel (1 − intensidad, sin bajar de 0), calculada una vez para las búsquedas. */
function darkness(data: Float32Array): Float32Array {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] >= 1 ? 0 : 1 - data[i];
  return out;
}

/** Media de `dark` en un conjunto de desplazamientos alrededor de `center` (índice). */
function meanDark(dark: Float32Array, center: number, offs: Offsets): number {
  let s = 0;
  for (let i = 0; i < offs.length; i++) s += dark[center + offs[i]];
  return s / offs.length;
}

/** Contraste del contorno impreso: anillo de la burbuja menos el papel de alrededor. */
function contourScore(dark: Float32Array, center: number, ring: Offsets, outer: Offsets): number {
  return meanDark(dark, center, ring) - meanDark(dark, center, outer);
}

/**
 * Mejor desplazamiento del contorno en un radio de `search` píxeles: primero en pasos de `coarse` y después
 * afinando alrededor del mejor.
 */
function bestContour(
  dark: Float32Array,
  width: number,
  px: number,
  py: number,
  search: number,
  coarse: number,
  ring: Offsets,
  outer: Offsets,
): { dx: number; dy: number; score: number } {
  let best = -Infinity;
  let bdx = 0;
  let bdy = 0;
  for (let dy = -search; dy <= search; dy += coarse) {
    for (let dx = -search; dx <= search; dx += coarse) {
      if (dx * dx + dy * dy > search * search + 1) continue;
      const s = contourScore(dark, (py + dy) * width + px + dx, ring, outer);
      if (s > best) {
        best = s;
        bdx = dx;
        bdy = dy;
      }
    }
  }
  const cdx = bdx;
  const cdy = bdy;
  const r = coarse - 1;
  for (let dy = cdy - r; dy <= cdy + r; dy++) {
    for (let dx = cdx - r; dx <= cdx + r; dx++) {
      if ((dx === cdx && dy === cdy) || Math.abs(dx) > search || Math.abs(dy) > search) continue;
      const s = contourScore(dark, (py + dy) * width + px + dx, ring, outer);
      if (s > best) {
        best = s;
        bdx = dx;
        bdy = dy;
      }
    }
  }
  return { dx: bdx, dy: bdy, score: best };
}

function meanInk(data: Float32Array, center: number, offs: Offsets): number {
  let s = 0;
  for (let i = 0; i < offs.length; i++) s += inkAt(data[center + offs[i]]);
  return s / offs.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Mide todas las burbujas. `centers` en mm sobre la hoja; `img` es la hoja normalizada a `scale` px/mm.
 * Devuelve el relleno de cada una, en el mismo orden.
 */
export function measureBubbles(
  img: GrayImage,
  scale: number,
  centers: Point[],
): { at: Point; fill: number; contour: number }[] {
  const { width, height, data } = img;
  const ring = diskOffsets(width, RING_IN * scale, RING_OUT * scale);
  const outer = diskOffsets(width, OUTER_IN * scale, OUTER_OUT * scale);
  const inner = diskOffsets(width, 0, INNER_R * scale);
  const search = Math.round(SEARCH_MM * scale);
  const margin = Math.ceil(OUTER_OUT * scale) + search + 1;
  const dark = darkness(data);

  // 1. Desplazamiento que mejor encaja el contorno impreso de cada burbuja, y lo claro que es ese encaje.
  const raw = centers.map((c) => {
    const px = Math.round(c.x * scale - 0.5);
    const py = Math.round(c.y * scale - 0.5);
    if (px < margin || py < margin || px >= width - margin || py >= height - margin) {
      return { dx: 0, dy: 0, quality: 0, px, py };
    }
    const b = bestContour(dark, width, px, py, search, 2, ring.idx, outer.idx);
    return { dx: b.dx, dy: b.dy, quality: b.score, px, py };
  });

  // 2. Se suaviza con la mediana de las vecinas cuyo contorno se ve bien: una burbuja rellena o tachada no tiene
  //    un contorno fiable, pero sus vecinas sí, y el desplazamiento varía despacio por la hoja.
  const good = raw.filter((r) => r.quality > 0.15);
  const pool = good.length >= 4 ? good : raw;
  const globalDx = median(pool.map((r) => r.dx));
  const globalDy = median(pool.map((r) => r.dy));
  const lim = NEIGHBOUR_MM * scale;

  return centers.map((c, i) => {
    const r = raw[i];
    const near = pool.filter((o) => Math.abs(o.px - r.px) <= lim && Math.abs(o.py - r.py) <= lim);
    const dx = near.length >= 3 ? median(near.map((o) => o.dx)) : globalDx;
    const dy = near.length >= 3 ? median(near.map((o) => o.dy)) : globalDy;
    const cx = Math.round(r.px + dx);
    const cy = Math.round(r.py + dy);
    const inside = cx >= margin && cy >= margin && cx < width - margin && cy < height - margin;
    const center = cy * width + cx;
    const fill = inside ? meanInk(data, center, inner.idx) : 0;
    // Lo bien que se ve el contorno impreso justo donde se mide: si la alineación falla, cae.
    const contour = inside ? contourScore(dark, center, ring.idx, outer.idx) : 0;
    return { at: { x: c.x + (cx - r.px) / scale, y: c.y + (cy - r.py) / scale }, fill, contour };
  });
}

/** Radio de la comprobación de alineación: menos de media separación entre burbujas (6,2 mm). */
const VERIFY_MM = 2.6;
/** Distancia a partir de la cual una burbuja se considera desalineada. */
const MISALIGNED_MM = 1.0;
/** Una zona (cuadrado de 30 mm) se da por desalineada con al menos estas burbujas y esta proporción fuera de sitio. */
const ZONE_MIN_BAD = 4;
const ZONE_MAX_FRACTION = 0.5;

export interface AlignmentCheck {
  ok: boolean;
  checked: number;
  misaligned: number;
  /** Peor zona: centro (mm) y proporción de burbujas desalineadas en ella. */
  worst: { at: Point; fraction: number } | null;
}

/**
 * Red de seguridad: en una muestra de burbujas que parecen vacías (su contorno es fiable), busca el contorno
 * impreso en un radio amplio y comprueba que aparece donde se está midiendo. Si en alguna zona no es así, la
 * alineación no es fiable y la hoja no debe leerse: un desplazamiento grande haría medir la burbuja de al lado.
 */
export function verifyAlignment(
  img: GrayImage,
  scale: number,
  reads: { at: Point; fill: number }[],
): AlignmentCheck {
  const { width, height, data } = img;
  const ring = diskOffsets(width, RING_IN * scale, RING_OUT * scale);
  const outer = diskOffsets(width, OUTER_IN * scale, OUTER_OUT * scale);
  const search = Math.round(VERIFY_MM * scale);
  const margin = Math.ceil(OUTER_OUT * scale) + search + 1;
  const dark = darkness(data);
  const candidates = reads.filter((r) => r.fill < 0.3);
  const results: { at: Point; bad: boolean }[] = [];
  for (const r of candidates) {
    const px = Math.round(r.at.x * scale - 0.5);
    const py = Math.round(r.at.y * scale - 0.5);
    if (px < margin || py < margin || px >= width - margin || py >= height - margin) continue;
    const b = bestContour(dark, width, px, py, search, 2, ring.idx, outer.idx);
    results.push({ at: r.at, bad: Math.hypot(b.dx, b.dy) / scale > MISALIGNED_MM });
  }
  let worst: AlignmentCheck['worst'] = null;
  let ok = true;
  // Una desalineación real afecta a casi todas las burbujas de una zona; unas pocas lecturas ruidosas no.
  for (const r of results) {
    if (!r.bad) continue;
    const near = results.filter((o) => Math.abs(o.at.x - r.at.x) <= 15 && Math.abs(o.at.y - r.at.y) <= 15);
    const bad = near.filter((o) => o.bad).length;
    const fraction = bad / near.length;
    if (!worst || fraction > worst.fraction) worst = { at: r.at, fraction };
    if (bad >= ZONE_MIN_BAD && fraction >= ZONE_MAX_FRACTION) ok = false;
  }
  return { ok, checked: results.length, misaligned: results.filter((r) => r.bad).length, worst };
}

/** Nivel de relleno de las burbujas vacías de la hoja: la mediana, porque la mayoría lo están. */
export function emptyLevel(fills: number[]): number {
  return Math.min(0.2, median(fills));
}

export function classify(score: number): BubbleState {
  if (score >= THRESHOLDS.marked) return 'marcada';
  if (score <= THRESHOLDS.empty) return 'vacia';
  return 'dudosa';
}
