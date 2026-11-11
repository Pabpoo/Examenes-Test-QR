import type { Point } from '../shared/sheet/frame';
import type { GrayImage } from './image';
import { bilinear } from './rectify';

/**
 * Afina al subpíxel las esquinas de un marcador sobre la imagen a resolución completa: en cada lado busca el borde
 * blanco → negro en varios perfiles perpendiculares, ajusta una recta y corta las rectas de lados contiguos.
 * Si algo no cuadra, devuelve las esquinas de partida.
 */
export function refineMarkerCorners(gray: GrayImage, corners: Point[]): Point[] {
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
  const lines: { px: number; py: number; dx: number; dy: number }[] = [];
  for (let k = 0; k < 4; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 8) return corners;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    // Normal hacia fuera del marcador.
    let nx = -uy;
    let ny = ux;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const cell = len / 8;
    const inner = 0.75 * cell;
    const outer = 1.25 * cell;
    const step = Math.max(0.2, cell / 20);
    const pts: Point[] = [];
    for (let i = 1; i <= 9; i++) {
      const t = 0.1 + (0.8 * i) / 10;
      const ox = a.x + (b.x - a.x) * t;
      const oy = a.y + (b.y - a.y) * t;
      const prof: number[] = [];
      for (let d = -inner; d <= outer; d += step) prof.push(bilinear(gray, ox + nx * d - 0.5, oy + ny * d - 0.5));
      const nIn = Math.max(2, Math.floor((0.35 * cell) / step));
      const black = prof.slice(0, nIn).reduce((s, v) => s + v, 0) / nIn;
      const white = prof.slice(-nIn).reduce((s, v) => s + v, 0) / nIn;
      if (white - black < 20) continue;
      const mid = (white + black) / 2;
      // Primer cruce del nivel medio, de dentro (negro) a fuera (blanco).
      for (let j = 1; j < prof.length; j++) {
        if (prof[j - 1] < mid && prof[j] >= mid) {
          const f = (mid - prof[j - 1]) / (prof[j] - prof[j - 1]);
          const d = -inner + (j - 1 + f) * step;
          pts.push({ x: ox + nx * d, y: oy + ny * d });
          break;
        }
      }
    }
    if (pts.length < 4) return corners;
    const line = fitLine(pts);
    if (!line) return corners;
    lines.push(line);
  }
  const out: Point[] = [];
  for (let k = 0; k < 4; k++) {
    // La esquina k está entre el lado k−1 (de k−1 a k) y el lado k (de k a k+1).
    const p = intersect(lines[(k + 3) % 4], lines[k]);
    if (!p || Math.hypot(p.x - corners[k].x, p.y - corners[k].y) > Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y) / 8) {
      return corners;
    }
    out.push(p);
  }
  return out;
}

/** Recta por mínimos cuadrados totales; descarta una vez los puntos a más de 1 px. */
function fitLine(points: Point[]): { px: number; py: number; dx: number; dy: number } | null {
  let pts = points;
  let res: { px: number; py: number; dx: number; dy: number } | null = null;
  for (let pass = 0; pass < 2; pass++) {
    if (pts.length < 3) return res;
    let mx = 0;
    let my = 0;
    for (const p of pts) {
      mx += p.x;
      my += p.y;
    }
    mx /= pts.length;
    my /= pts.length;
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    for (const p of pts) {
      sxx += (p.x - mx) ** 2;
      sxy += (p.x - mx) * (p.y - my);
      syy += (p.y - my) ** 2;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    res = { px: mx, py: my, dx: Math.cos(theta), dy: Math.sin(theta) };
    const r = res;
    pts = pts.filter((p) => Math.abs((p.x - r.px) * -r.dy + (p.y - r.py) * r.dx) < 1);
  }
  return res;
}

function intersect(
  a: { px: number; py: number; dx: number; dy: number },
  b: { px: number; py: number; dx: number; dy: number },
): Point | null {
  const den = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den;
  return { x: a.px + a.dx * t, y: a.py + a.dy * t };
}
