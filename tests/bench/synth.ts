import { MARKERS, MARKER_CELL, MARKER_SIZE, PAGE_H, PAGE_W, QR_RECT, markerBits } from '../../src/shared/sheet/frame';
import type { SheetLayout } from '../../src/shared/sheet/layout';
import { qrModules } from '../../src/shared/sheet/qr-matrix';
import { Canvas } from './raster';
import type { Rng } from './rng';

// Hoja sintética: se dibuja a partir de la geometría (igual que el PDF) y se rellena como lo haría un alumno.

export type MarkStyle = 'boli' | 'lapiz' | 'mitad' | 'aspa' | 'punto' | 'tachon';

/** Qué debe leerse en una burbuja si la pregunta no se marca como dudosa. */
export type Truth = 'marcada' | 'vacia';

export const TRUTH_OF: Record<MarkStyle, Truth> = {
  boli: 'marcada',
  lapiz: 'marcada',
  mitad: 'marcada',
  aspa: 'marcada',
  punto: 'vacia',
  tachon: 'marcada',
};

export interface Ink {
  /** Gris de la tinta del bolígrafo (azul o negro, ya en luminancia). */
  pen: number;
}

export const PRINT_BLACK = 22;
const PRINT_OUTLINE = 77;
const PRINT_HINT = 158;

function drawFrame(c: Canvas, qrText: string): void {
  for (const m of MARKERS) {
    c.rect(m.x, m.y, MARKER_SIZE, MARKER_SIZE, PRINT_BLACK);
    const bits = markerBits(m.id);
    for (let r = 0; r < 6; r++) {
      for (let k = 0; k < 6; k++) {
        if (bits[r][k]) c.rect(m.x + (k + 1) * MARKER_CELL, m.y + (r + 1) * MARKER_CELL, MARKER_CELL, MARKER_CELL, 255);
      }
    }
  }
  const mods = qrModules(qrText);
  const cell = QR_RECT.w / mods.length;
  mods.forEach((row, r) =>
    row.forEach((on, k) => {
      if (on) c.rect(QR_RECT.x + k * cell, QR_RECT.y + r * cell, cell, cell, PRINT_BLACK);
    }),
  );
}

/** Texto impreso simulado: barras grises del tamaño de una línea de texto. */
function fakeText(c: Canvas, x: number, y: number, w: number, h: number, rng: Rng, value = PRINT_BLACK): void {
  let cx = x;
  while (cx < x + w) {
    const ww = rng.range(0.4, 1.4) * h;
    if (cx + ww > x + w) break;
    c.rect(cx, y, ww, h, value);
    cx += ww + rng.range(0.15, 0.5) * h;
  }
}

/** Trazos a mano dentro de un rectángulo (nombre, cifras escritas). */
function scribble(c: Canvas, x: number, y: number, w: number, h: number, rng: Rng, ink: number, strokes: number): void {
  for (let i = 0; i < strokes; i++) {
    c.line(rng.range(x, x + w), rng.range(y, y + h), rng.range(x, x + w), rng.range(y, y + h), rng.range(0.3, 0.5), ink);
  }
}

/** Letra pequeña dentro de la burbuja (gris claro), aproximada con un anillo y un palo. */
function hintGlyph(c: Canvas, cx: number, cy: number): void {
  c.ring(cx - 0.15, cy + 0.15, 0.55, 0.22, PRINT_HINT);
  c.line(cx + 0.45, cy - 0.5, cx + 0.45, cy + 0.75, 0.22, PRINT_HINT);
}

export function drawMark(c: Canvas, cx: number, cy: number, style: MarkStyle, ink: Ink, rng: Rng): void {
  const jx = rng.range(-0.35, 0.35);
  const jy = rng.range(-0.35, 0.35);
  const x0 = cx + jx;
  const y0 = cy + jy;
  const filled = (R: number, value: number, texture: number) => {
    const p1 = rng.range(0, 6.3);
    const p2 = rng.range(0, 6.3);
    c.shape(
      { x: x0 - R * 1.3, y: y0 - R * 1.3, w: R * 2.6, h: R * 2.6 },
      (x, y) => {
        const a = Math.atan2(y - y0, x - x0);
        const rr = R * (1 + 0.06 * Math.sin(3 * a + p1) + 0.04 * Math.sin(5 * a + p2));
        return Math.hypot(x - x0, y - y0) - rr;
      },
      (x, y) => value + texture * Math.sin(x * 7.1 + y * 3.3) * Math.cos(y * 6.7 - x * 2.1),
    );
  };
  switch (style) {
    case 'boli':
      filled(2.3 * rng.range(0.95, 1.18), ink.pen, 8);
      break;
    case 'lapiz':
      filled(2.3 * rng.range(0.95, 1.15), rng.range(105, 150), 22);
      break;
    case 'mitad': {
      // Rellena entre el 40 y el 65 % del círculo: lo que queda a un lado de una cuerda.
      const ang = rng.range(0, 6.3);
      const off = rng.range(-0.3, 0.6);
      const R = 2.25;
      c.shape(
        { x: cx - 3, y: cy - 3, w: 6, h: 6 },
        (x, y) => Math.max(Math.hypot(x - cx, y - cy) - R, (x - cx) * Math.cos(ang) + (y - cy) * Math.sin(ang) - off),
        ink.pen,
      );
      break;
    }
    case 'aspa': {
      const a = rng.range(-0.3, 0.3);
      const L = rng.range(1.9, 2.6);
      const w = rng.range(0.35, 0.6);
      for (const base of [Math.PI / 4, -Math.PI / 4]) {
        const t = base + a;
        c.line(x0 - L * Math.cos(t), y0 - L * Math.sin(t), x0 + L * Math.cos(t), y0 + L * Math.sin(t), w, ink.pen);
      }
      break;
    }
    case 'punto':
      c.disk(cx + rng.range(-1, 1), cy + rng.range(-1, 1), rng.range(0.35, 0.7), ink.pen);
      break;
    case 'tachon':
      filled(2.3 * rng.range(1, 1.2), ink.pen, 8);
      for (let i = 0; i < 4; i++) {
        c.line(cx - 3.2, cy + rng.range(-2.5, 2.5), cx + 3.2, cy + rng.range(-2.5, 2.5), rng.range(0.4, 0.7), ink.pen);
      }
      break;
  }
}

export interface SheetMarks {
  /** Estilo de marca de cada burbuja del identificador: `id[columna][cifra]`, null si vacía. */
  id: (MarkStyle | null)[][];
  /** `answers[pregunta][opción]`. */
  answers: (MarkStyle | null)[][];
}

export function renderSheet(layout: SheetLayout, qrText: string, marks: SheetMarks, ink: Ink, rng: Rng, res = 8): Canvas {
  const c = new Canvas(PAGE_W, PAGE_H, res);
  drawFrame(c, qrText);

  const h = layout.header;
  fakeText(c, h.x, h.y + 1.5, rng.range(50, h.w - 20), 3.4, rng);
  fakeText(c, h.x, h.y + 7.5, rng.range(30, 70), 2.4, rng, 115);
  const nf = layout.nameField;
  c.rect(nf.x, nf.y, nf.w, 0.3, PRINT_OUTLINE);
  c.rect(nf.x, nf.y + nf.h - 0.3, nf.w, 0.3, PRINT_OUTLINE);
  c.rect(nf.x, nf.y, 0.3, nf.h, PRINT_OUTLINE);
  c.rect(nf.x + nf.w - 0.3, nf.y, 0.3, nf.h, PRINT_OUTLINE);
  fakeText(c, nf.x + 1.5, nf.y + 1, 22, 1.6, rng, 115);
  scribble(c, nf.x + 25, nf.y + 2, rng.range(40, 95), 6, rng, ink.pen, 18);

  const id = layout.id;
  fakeText(c, id.region.x + 4, id.label.y + 1, id.region.w - 4, 2.2, rng);
  id.boxes.forEach((b, col) => {
    c.rect(b.x, b.y, b.w, 0.3, PRINT_OUTLINE);
    c.rect(b.x, b.y + b.h - 0.3, b.w, 0.3, PRINT_OUTLINE);
    c.rect(b.x, b.y, 0.3, b.h, PRINT_OUTLINE);
    c.rect(b.x + b.w - 0.3, b.y, 0.3, b.h, PRINT_OUTLINE);
    if (marks.id[col].some((m) => m)) scribble(c, b.x + 1, b.y + 1, b.w - 2, b.h - 2, rng, ink.pen, 3);
  });
  for (const col of id.bubbles) {
    for (const p of col) {
      c.ring(p.x, p.y, layout.bubbleR, 0.25, PRINT_OUTLINE);
      hintGlyph(c, p.x, p.y);
    }
  }
  for (const q of layout.questions) {
    fakeText(c, q.numberAnchor.x - (q.number >= 10 ? 3.4 : 1.8), q.numberAnchor.y - 1.1, q.number >= 10 ? 3.4 : 1.8, 2.2, rng);
    for (const p of q.options) {
      c.ring(p.x, p.y, layout.bubbleR, 0.25, PRINT_OUTLINE);
      hintGlyph(c, p.x, p.y);
    }
  }
  fakeText(c, 30, 278, 150, 2, rng, 115);
  fakeText(c, 50, 282, 110, 2, rng, 115);

  id.bubbles.forEach((col, ci) =>
    col.forEach((p, d) => {
      const m = marks.id[ci][d];
      if (m) drawMark(c, p.x, p.y, m, ink, rng);
    }),
  );
  layout.questions.forEach((q, qi) =>
    q.options.forEach((p, k) => {
      const m = marks.answers[qi][k];
      if (m) drawMark(c, p.x, p.y, m, ink, rng);
    }),
  );
  return c;
}
