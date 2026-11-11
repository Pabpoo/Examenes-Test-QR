import { interpretId, interpretQuestion } from '../../src/shared/sheet/interpret';
import { scanSheet, type ScanOptions } from '../../src/scanner/scan';
import { applyHomography } from '../../src/scanner/homography';
import type { BenchCase } from './cases';
import { TRUTH_OF, type MarkStyle } from './synth';

// Compara la lectura del escáner con lo que se rellenó. Error silencioso: una burbuja leída distinta de la realidad
// sin que la pregunta (o el identificador) quede marcada como dudosa.

export interface CaseResult {
  seed: number;
  ok: boolean;
  failure?: string;
  silentErrors: string[];
  /** Burbujas rellenas con bolígrafo (marcas claras) y cuántas acabaron como dudosas. */
  penMarks: number;
  penToDoubt: number;
  /** Burbujas vacías y cuántas acabaron como dudosas. */
  empties: number;
  emptyToDoubt: number;
  questions: number;
  questionsDoubt: number;
  idDoubt: boolean;
  ms: number;
  pxPerMm: number;
  edgeMm?: number;
  /** Peor error de posición de una burbuja con la homografía, y tras el ajuste local (mm). */
  alignInitialMm?: number;
  alignFinalMm?: number;
}

export function evaluateCase(c: BenchCase, options: ScanOptions = {}): CaseResult {
  const t0 = performance.now();
  const res = scanSheet(c.photo.image, (code) => (code.versionId === c.code.versionId ? c.layout : null), options);
  const ms = performance.now() - t0;
  const base: CaseResult = {
    seed: c.seed,
    ok: res.ok,
    silentErrors: [],
    penMarks: 0,
    penToDoubt: 0,
    empties: 0,
    emptyToDoubt: 0,
    questions: c.layout.questions.length,
    questionsDoubt: 0,
    idDoubt: false,
    ms,
    pxPerMm: c.photoParams.pxPerMm,
  };
  if (!res.ok) return { ...base, failure: `${res.code}: ${res.message}` };
  base.edgeMm = res.quality.edgeMm;

  // Error de alineación (mm): dónde mide el escáner cada burbuja frente a dónde está de verdad en la foto. Sin
  // contar el papel combado, que el simulador no refleja en la homografía verdadera.
  if (c.photoParams.bend === 0) {
    const trueH = c.photo.sheetToImage;
    const scale = res.quality.pxPerMm;
    let initial = 0;
    let final = 0;
    const all = [...c.layout.id.bubbles.flat(), ...c.layout.questions.flatMap((q) => q.options)];
    const reads = [...res.id.flat(), ...res.answers.flat()];
    all.forEach((p, i) => {
      const t = applyHomography(trueH, p.x, p.y);
      const e0 = applyHomography(res.sheetToImage, p.x, p.y);
      const e1 = applyHomography(res.sheetToImage, reads[i].at.x, reads[i].at.y);
      initial = Math.max(initial, Math.hypot(t.x - e0.x, t.y - e0.y) / scale);
      final = Math.max(final, Math.hypot(t.x - e1.x, t.y - e1.y) / scale);
    });
    base.alignInitialMm = initial;
    base.alignFinalMm = final;
  }

  if (res.code.versionId !== c.code.versionId || res.code.model !== c.code.model || res.code.page !== c.code.page) {
    base.silentErrors.push(`QR leído como ${JSON.stringify(res.code)}`);
  }

  const count = (style: MarkStyle | null, state: string) => {
    if (style === 'boli') {
      base.penMarks++;
      if (state === 'dudosa') base.penToDoubt++;
    } else if (style === null) {
      base.empties++;
      if (state === 'dudosa') base.emptyToDoubt++;
    }
  };

  // Identificador.
  const id = interpretId(res.id.map((col) => col.map((b) => b.state)));
  base.idDoubt = id.doubts.length > 0;
  res.id.forEach((col, ci) => col.forEach((b, d) => count(c.marks.id[ci][d], b.state)));
  if (id.code !== null && id.code !== c.idDigits.join('')) {
    base.silentErrors.push(`identificador leído ${id.code}, real ${c.idDigits.join('')}`);
  }

  // Respuestas.
  res.answers.forEach((row, qi) => {
    const truth = c.questions[qi];
    const marks = c.marks.answers[qi];
    const reading = interpretQuestion(
      row.map((b) => b.state),
      truth.expectsSingle,
    );
    row.forEach((b, k) => count(marks[k], b.state));
    if (reading.doubt) {
      base.questionsDoubt++;
      return;
    }
    if (truth.mustDoubt) {
      base.silentErrors.push(`pregunta ${qi + 1}: rectificación no detectada`);
      return;
    }
    row.forEach((b, k) => {
      const style = marks[k];
      const expected = style ? TRUTH_OF[style] : 'vacia';
      if (b.state !== expected) {
        base.silentErrors.push(
          `pregunta ${qi + 1} opción ${k + 1}: ${style ?? 'vacía'} leída como ${b.state} (relleno ${b.fill.toFixed(2)})`,
        );
      }
    });
  });
  return base;
}

export interface Summary {
  cases: number;
  failures: { seed: number; reason: string }[];
  silentErrors: { seed: number; error: string }[];
  penMarks: number;
  penToDoubt: number;
  empties: number;
  emptyToDoubt: number;
  questions: number;
  questionsDoubt: number;
  idDoubts: number;
  msMedian: number;
  msMax: number;
  /** Mediana, percentil 95 y máximo. */
  alignInitial: [number, number, number];
  alignFinal: [number, number, number];
}

function stats(values: number[]): [number, number, number] {
  if (values.length === 0) return [0, 0, 0];
  const s = [...values].sort((a, b) => a - b);
  return [s[s.length >> 1], s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], s[s.length - 1]];
}

export function summarize(results: CaseResult[]): Summary {
  const ms = results.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
  const sum = (f: (r: CaseResult) => number) => results.reduce((s, r) => s + f(r), 0);
  return {
    cases: results.length,
    failures: results.filter((r) => !r.ok).map((r) => ({ seed: r.seed, reason: r.failure ?? '' })),
    silentErrors: results.flatMap((r) => r.silentErrors.map((error) => ({ seed: r.seed, error }))),
    penMarks: sum((r) => r.penMarks),
    penToDoubt: sum((r) => r.penToDoubt),
    empties: sum((r) => r.empties),
    emptyToDoubt: sum((r) => r.emptyToDoubt),
    questions: sum((r) => r.questions),
    questionsDoubt: sum((r) => r.questionsDoubt),
    idDoubts: results.filter((r) => r.idDoubt).length,
    msMedian: ms.length ? ms[ms.length >> 1] : 0,
    msMax: ms.length ? ms[ms.length - 1] : 0,
    alignInitial: stats(results.flatMap((r) => (r.alignInitialMm === undefined ? [] : [r.alignInitialMm]))),
    alignFinal: stats(results.flatMap((r) => (r.alignFinalMm === undefined ? [] : [r.alignFinalMm]))),
  };
}

export function formatSummary(s: Summary): string {
  const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(2) : '0.00') + ' %';
  const lines = [
    `Casos: ${s.cases}`,
    `Hojas no leídas: ${s.failures.length} (${pct(s.failures.length, s.cases)})`,
    `Errores silenciosos: ${s.silentErrors.length}`,
    `Marcas de bolígrafo enviadas a duda: ${s.penToDoubt} de ${s.penMarks} (${pct(s.penToDoubt, s.penMarks)})`,
    `Burbujas vacías enviadas a duda: ${s.emptyToDoubt} de ${s.empties} (${pct(s.emptyToDoubt, s.empties)})`,
    `Preguntas dudosas: ${s.questionsDoubt} de ${s.questions} (${pct(s.questionsDoubt, s.questions)})`,
    `Hojas con el identificador dudoso: ${s.idDoubts}`,
    `Tiempo de lectura (Node): mediana ${s.msMedian.toFixed(0)} ms, máximo ${s.msMax.toFixed(0)} ms`,
    `Alineación con la homografía (mm, peor burbuja de cada hoja): mediana ${s.alignInitial[0].toFixed(2)}, p95 ${s.alignInitial[1].toFixed(2)}, máximo ${s.alignInitial[2].toFixed(2)}`,
    `Alineación tras el ajuste local (mm): mediana ${s.alignFinal[0].toFixed(2)}, p95 ${s.alignFinal[1].toFixed(2)}, máximo ${s.alignFinal[2].toFixed(2)}`,
  ];
  const reasons = new Map<string, number>();
  for (const f of s.failures) reasons.set(f.reason, (reasons.get(f.reason) ?? 0) + 1);
  for (const [r, n] of reasons) lines.push(`  · ${n} × ${r}`);
  for (const e of s.silentErrors.slice(0, 30)) lines.push(`  ! semilla ${e.seed}: ${e.error}`);
  return lines.join('\n');
}
