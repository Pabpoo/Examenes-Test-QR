import { describe, expect, it } from 'vitest';
import { MARKERS, MARKER_QUIET, MARKER_SIZE, PAGE_H, PAGE_W, QR_QUIET, QR_RECT, type Rect } from '../src/shared/sheet/frame';
import {
  AREA_BOTTOM,
  AREA_LEFT,
  AREA_RIGHT,
  AREA_TOP,
  BUBBLE_R,
  computeAnswerSheets,
  sheetCapacity,
} from '../src/shared/sheet/layout';
import { decodeSheetCode, encodeSheetCode, randomVersionId } from '../src/shared/sheet/qr-payload';
import { interpretId, interpretQuestion } from '../src/shared/sheet/interpret';

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function bubbleRect(x: number, y: number): Rect {
  return { x: x - BUBBLE_R, y: y - BUBBLE_R, w: 2 * BUBBLE_R, h: 2 * BUBBLE_R };
}

const forbidden: Rect[] = [
  ...MARKERS.map((m) => ({
    x: m.x - MARKER_QUIET,
    y: m.y - MARKER_QUIET,
    w: MARKER_SIZE + 2 * MARKER_QUIET,
    h: MARKER_SIZE + 2 * MARKER_QUIET,
  })),
  { x: QR_RECT.x - QR_QUIET, y: QR_RECT.y - QR_QUIET, w: QR_RECT.w + 2 * QR_QUIET, h: QR_RECT.h + 2 * QR_QUIET },
];

describe('geometría de la hoja', () => {
  const configs: [number[], number][] = [];
  for (const opts of [2, 3, 4, 5, 6]) {
    for (const digits of [2, 4, 5, 6, 8]) {
      const cap = sheetCapacity(opts, digits);
      for (const n of [1, 7, 40, cap, cap + 1, 2 * cap + 3]) configs.push([Array(n).fill(opts), digits]);
    }
  }
  configs.push([[2, 6, 3, 4, 5, 2, 6, 6, 3, 4, 2, 5, 4, 3, 6, 2, 2, 4, 5, 6], 6]);

  it.each(configs.map((c, i) => [i, c] as const))('configuración %i: todo cabe, sin solapes ni zonas prohibidas', (_, [counts, digits]) => {
    const sheets = computeAnswerSheets({ optionCounts: counts, idDigits: digits });
    // Todas las preguntas aparecen una sola vez y en orden.
    const indices = sheets.flatMap((s) => s.questions.map((q) => q.index));
    expect(indices).toEqual(counts.map((_, i) => i));
    sheets.forEach((s, p) => {
      expect(s.page).toBe(p + 1);
      expect(s.pageCount).toBe(sheets.length);
      const rects: Rect[] = [
        ...s.id.bubbles.flat().map((b) => bubbleRect(b.x, b.y)),
        ...s.questions.flatMap((q) => {
          expect(q.options.length).toBe(counts[q.index]);
          return q.options.map((b) => bubbleRect(b.x, b.y));
        }),
      ];
      const eps = 1e-9;
      const outside = rects.filter(
        (r) =>
          r.x < AREA_LEFT - eps ||
          r.x + r.w > AREA_RIGHT + eps ||
          r.y < Math.min(AREA_TOP, s.id.region.y) - eps ||
          r.y + r.h > AREA_BOTTOM + eps ||
          [...forbidden, s.nameField, s.header].some((f) => overlaps(r, f)),
      );
      expect(outside).toEqual([]);
      // Ninguna burbuja se solapa con otra (con 1 mm de margen).
      let closest = Infinity;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          closest = Math.min(closest, Math.hypot(rects[i].x - rects[j].x, rects[i].y - rects[j].y));
        }
      }
      expect(closest).toBeGreaterThan(2 * BUBBLE_R + 1);
      // Las preguntas quedan por debajo de la cabecera.
      for (const q of s.questions) expect(q.options[0].y - BUBBLE_R).toBeGreaterThanOrEqual(AREA_TOP - 1e-9);
    });
  });

  it('la capacidad declarada coincide con lo que se coloca en una hoja', () => {
    for (const opts of [2, 3, 4, 5, 6]) {
      for (const digits of [2, 5, 8]) {
        const cap = sheetCapacity(opts, digits);
        expect(computeAnswerSheets({ optionCounts: Array(cap).fill(opts), idDigits: digits })).toHaveLength(1);
        expect(computeAnswerSheets({ optionCounts: Array(cap + 1).fill(opts), idDigits: digits })).toHaveLength(2);
      }
    }
  });

  it('mismos datos, misma geometría', () => {
    const input = { optionCounts: [4, 4, 5, 2, 6, 3], idDigits: 5 };
    expect(JSON.stringify(computeAnswerSheets(input))).toBe(JSON.stringify(computeAnswerSheets(input)));
  });

  it('capacidad por hoja (se anota en la especificación)', () => {
    const table = [2, 3, 4, 5, 6].map((o) => `${o} opciones: ${sheetCapacity(o, 8)} (DNI de 8 cifras), ${sheetCapacity(o, 5)} (5 cifras)`);
    console.log('Capacidad por hoja\n' + table.join('\n'));
    expect(sheetCapacity(6, 8)).toBeGreaterThanOrEqual(80);
    expect(sheetCapacity(4, 8)).toBeGreaterThanOrEqual(100);
  });

  it('rechaza configuraciones no válidas', () => {
    expect(() => computeAnswerSheets({ optionCounts: [], idDigits: 5 })).toThrow();
    expect(() => computeAnswerSheets({ optionCounts: [1], idDigits: 5 })).toThrow();
    expect(() => computeAnswerSheets({ optionCounts: [7], idDigits: 5 })).toThrow();
    expect(() => computeAnswerSheets({ optionCounts: [4], idDigits: 1 })).toThrow();
    expect(() => computeAnswerSheets({ optionCounts: [4], idDigits: 9 })).toThrow();
  });

  it('la hoja cabe en un A4', () => {
    expect(PAGE_W).toBe(210);
    expect(PAGE_H).toBe(297);
  });
});

describe('contenido del QR', () => {
  it('ida y vuelta', () => {
    const code = { versionId: randomVersionId(), model: 'C' as const, page: 2 };
    const text = encodeSheetCode(code);
    expect(text).toMatch(/^TQ1-[A-Z0-9]{8}-C2$/);
    expect(decodeSheetCode(text)).toEqual(code);
  });

  it('rechaza textos ajenos', () => {
    for (const t of ['', 'https://ejemplo.com', 'TQ1-ABC-A1', 'TQ2-ABCDEFGH-A1', 'TQ1-ABCDEFGH-E1', 'TQ1-ABCDEFGH-A0', 'tq1-abcdefgh-a1']) {
      expect(decodeSheetCode(t)).toBeNull();
    }
  });
});

describe('reglas de dudas', () => {
  it('una marca clara', () => {
    expect(interpretQuestion(['vacia', 'marcada', 'vacia'], true)).toEqual({ marked: [1], weak: [], blank: false, doubt: null });
  });
  it('en blanco no es duda', () => {
    expect(interpretQuestion(['vacia', 'vacia'], true)).toMatchObject({ blank: true, doubt: null });
  });
  it('marca débil', () => {
    expect(interpretQuestion(['vacia', 'dudosa', 'marcada'], false)).toMatchObject({ doubt: 'marca_debil', weak: [1] });
  });
  it('marcas de más solo si la pregunta espera una', () => {
    expect(interpretQuestion(['marcada', 'marcada'], true).doubt).toBe('marcas_de_mas');
    expect(interpretQuestion(['marcada', 'marcada'], false).doubt).toBeNull();
  });
  it('identificador', () => {
    const col = (d: number | null, weak = false) =>
      Array.from({ length: 10 }, (_, k) => (k === d ? (weak ? 'dudosa' : 'marcada') : 'vacia') as 'vacia' | 'marcada' | 'dudosa');
    expect(interpretId([col(1), col(2), col(0)])).toMatchObject({ code: '120', doubts: [] });
    expect(interpretId([col(1), col(null)]).doubts).toEqual([{ column: 1, reason: 'sin_marca' }]);
    expect(interpretId([col(1), col(3, true)]).doubts).toEqual([{ column: 1, reason: 'marca_debil' }]);
    const two = col(4);
    two[7] = 'marcada';
    expect(interpretId([two]).doubts).toEqual([{ column: 0, reason: 'varias_marcas' }]);
  });
});
