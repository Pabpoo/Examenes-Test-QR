import type { Point } from '../shared/sheet/frame';

/** Homografía 3 × 3 por filas, con h[8] = 1. Lleva puntos del plano de origen al de destino. */
export type Homography = Float64Array;

export function applyHomography(h: Homography, x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
}

/** Resuelve A·x = b por eliminación gaussiana con pivote parcial. A es n × n por filas. */
function solve(a: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const m = new Float64Array(a);
  const v = new Float64Array(b);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r * n + col]) > Math.abs(m[piv * n + col])) piv = r;
    if (Math.abs(m[piv * n + col]) < 1e-12) return null;
    if (piv !== col) {
      for (let c = 0; c < n; c++) [m[col * n + c], m[piv * n + c]] = [m[piv * n + c], m[col * n + c]];
      [v[col], v[piv]] = [v[piv], v[col]];
    }
    for (let r = col + 1; r < n; r++) {
      const f = m[r * n + col] / m[col * n + col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) m[r * n + c] -= f * m[col * n + c];
      v[r] -= f * v[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = v[r];
    for (let c = r + 1; c < n; c++) s -= m[r * n + c] * x[c];
    x[r] = s / m[r * n + r];
  }
  return x;
}

/** Traslada y escala los puntos para que el cálculo sea estable (normalización de Hartley). */
function normalization(pts: Point[]): Float64Array {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let d = 0;
  for (const p of pts) d += Math.hypot(p.x - cx, p.y - cy);
  d /= pts.length;
  const s = d > 0 ? Math.SQRT2 / d : 1;
  return new Float64Array([s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1]);
}

export function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

export function invert(h: Float64Array): Float64Array | null {
  const [a, b, c, d, e, f, g, hh, i] = h;
  const A = e * i - f * hh;
  const B = -(d * i - f * g);
  const C = d * hh - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const inv = new Float64Array([
    A,
    -(b * i - c * hh),
    b * f - c * e,
    B,
    a * i - c * g,
    -(a * f - c * d),
    C,
    -(a * hh - b * g),
    a * e - b * d,
  ]);
  for (let k = 0; k < 9; k++) inv[k] /= det;
  const s = inv[8];
  if (Math.abs(s) > 1e-15) for (let k = 0; k < 9; k++) inv[k] /= s;
  return inv;
}

/**
 * Homografía por mínimos cuadrados que lleva `src[i]` a `dst[i]` (al menos 4 pares). Normaliza los puntos y
 * resuelve las ecuaciones normales del sistema lineal con h[8] = 1.
 */
export function findHomography(src: Point[], dst: Point[]): Homography | null {
  if (src.length !== dst.length || src.length < 4) return null;
  const ts = normalization(src);
  const td = normalization(dst);
  const ata = new Float64Array(64);
  const atb = new Float64Array(8);
  const row = new Float64Array(8);
  const add = (rhs: number) => {
    for (let r = 0; r < 8; r++) {
      if (row[r] === 0) continue;
      for (let c = 0; c < 8; c++) ata[r * 8 + c] += row[r] * row[c];
      atb[r] += row[r] * rhs;
    }
  };
  for (let k = 0; k < src.length; k++) {
    const x = ts[0] * src[k].x + ts[2];
    const y = ts[4] * src[k].y + ts[5];
    const u = td[0] * dst[k].x + td[2];
    const v = td[4] * dst[k].y + td[5];
    row.set([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    add(u);
    row.set([0, 0, 0, x, y, 1, -v * x, -v * y]);
    add(v);
  }
  const sol = solve(ata, atb, 8);
  if (!sol) return null;
  const hn = new Float64Array([...sol, 1]);
  const tdInv = invert(td);
  if (!tdInv) return null;
  const h = multiply(multiply(tdInv, hn), ts);
  const s = h[8];
  if (Math.abs(s) < 1e-15) return null;
  for (let k = 0; k < 9; k++) h[k] /= s;
  return h;
}
