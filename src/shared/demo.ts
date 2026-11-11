import { computeAnswerSheets, type SheetLayout } from './sheet/layout';
import { interpretId, interpretQuestion, type BubbleState, type QuestionReading } from './sheet/interpret';
import type { SheetCode } from './sheet/qr-payload';

// Hojas de prueba de la fase 0. Están en el código, así que el ordenador que imprime y el móvil que escanea las
// conocen sin base de datos. Cada una trae un plan de relleno: qué debe marcar quien la rellene, para que la app
// compare lo que lee con lo que debería haber y cuente los errores.

export type PlanStep =
  | { kind: 'una'; option: number }
  | { kind: 'varias'; options: number[] }
  | { kind: 'blanco' }
  | { kind: 'aspa'; option: number }
  | { kind: 'rectifica'; crossed: number; option: number };

export interface DemoSheet {
  versionId: string;
  title: string;
  /** Cómo rellenarla (bolígrafo, lápiz…). */
  instructions: string;
  idDigits: number;
  idLabel: string;
  code: string;
  optionCounts: number[];
  plan: PlanStep[];
}

const LETTERS = 'abcdef';

/** Generador determinista, para que el plan sea siempre el mismo. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePlan(optionCounts: number[], seed: number, mix: { varias: number; blanco: number; aspa: number; rectifica: number }): PlanStep[] {
  const rnd = seeded(seed);
  const pick = (n: number) => Math.floor(rnd() * n);
  return optionCounts.map((n) => {
    const r = rnd();
    let acc = mix.blanco;
    if (r < acc) return { kind: 'blanco' };
    acc += mix.varias;
    if (r < acc && n >= 3) {
      const a = pick(n);
      let b = pick(n - 1);
      if (b >= a) b++;
      return { kind: 'varias', options: [a, b].sort((x, y) => x - y) };
    }
    acc += mix.aspa;
    if (r < acc) return { kind: 'aspa', option: pick(n) };
    acc += mix.rectifica;
    if (r < acc) {
      const crossed = pick(n);
      let option = pick(n - 1);
      if (option >= crossed) option++;
      return { kind: 'rectifica', crossed, option };
    }
    return { kind: 'una', option: pick(n) };
  });
}

function repeat(n: number, value: number): number[] {
  return Array.from({ length: n }, () => value);
}

function mixed(n: number, seed: number): number[] {
  const rnd = seeded(seed);
  return Array.from({ length: n }, () => 2 + Math.floor(rnd() * 5));
}

const NORMAL = { varias: 0.06, blanco: 0.08, aspa: 0.04, rectifica: 0.04 };

export const DEMO_SHEETS: DemoSheet[] = [
  {
    versionId: 'PRUEBA01',
    title: 'Prueba 1 · 40 preguntas, 4 opciones',
    instructions: 'Rellena con bolígrafo azul.',
    idDigits: 5,
    idLabel: 'Últimas 5 cifras del DNI',
    code: '20481',
    optionCounts: repeat(40, 4),
    plan: makePlan(repeat(40, 4), 101, NORMAL),
  },
  {
    versionId: 'PRUEBA02',
    title: 'Prueba 2 · 60 preguntas, 4 opciones',
    instructions: 'Rellena con bolígrafo negro.',
    idDigits: 8,
    idLabel: 'DNI sin letra',
    code: '45127736',
    optionCounts: repeat(60, 4),
    plan: makePlan(repeat(60, 4), 202, NORMAL),
  },
  {
    versionId: 'PRUEBA03',
    title: 'Prueba 3 · 80 preguntas, 6 opciones',
    instructions: 'Rellena con lápiz, apretando como lo haría un alumno.',
    idDigits: 8,
    idLabel: 'DNI sin letra',
    code: '09382215',
    optionCounts: repeat(80, 6),
    plan: makePlan(repeat(80, 6), 303, NORMAL),
  },
  {
    versionId: 'PRUEBA04',
    title: 'Prueba 4 · 30 preguntas, de 2 a 6 opciones',
    instructions: 'Rellena con bolígrafo azul, a veces sin llenar del todo el círculo.',
    idDigits: 4,
    idLabel: 'Número de lista',
    code: '0317',
    optionCounts: mixed(30, 404),
    plan: makePlan(mixed(30, 404), 405, NORMAL),
  },
  {
    versionId: 'PRUEBA05',
    title: 'Prueba 5 · 50 preguntas con aspas y tachones',
    instructions: 'Rellena con bolígrafo negro. Esta hoja tiene muchas aspas y rectificaciones.',
    idDigits: 6,
    idLabel: 'Últimas 6 cifras del DNI',
    code: '771204',
    optionCounts: repeat(50, 5),
    plan: makePlan(repeat(50, 5), 505, { varias: 0.06, blanco: 0.06, aspa: 0.18, rectifica: 0.18 }),
  },
];

const BY_ID = new Map(DEMO_SHEETS.map((d) => [d.versionId, d]));
const LAYOUTS = new Map<string, SheetLayout[]>();

export function demoSheet(versionId: string): DemoSheet | undefined {
  return BY_ID.get(versionId);
}

export function demoLayouts(demo: DemoSheet): SheetLayout[] {
  let l = LAYOUTS.get(demo.versionId);
  if (!l) {
    l = computeAnswerSheets({ optionCounts: demo.optionCounts, idDigits: demo.idDigits });
    LAYOUTS.set(demo.versionId, l);
  }
  return l;
}

/** Resolutor de geometría para el escáner: solo conoce las hojas de prueba. */
export function resolveDemoLayout(code: SheetCode): SheetLayout | null {
  const demo = demoSheet(code.versionId);
  if (!demo) return null;
  return demoLayouts(demo)[code.page - 1] ?? null;
}

/** Texto de un paso del plan, para imprimirlo. */
export function planText(step: PlanStep): string {
  switch (step.kind) {
    case 'una':
      return LETTERS[step.option];
    case 'varias':
      return step.options.map((o) => LETTERS[o]).join(' y ');
    case 'blanco':
      return 'en blanco';
    case 'aspa':
      return `aspa en ${LETTERS[step.option]}`;
    case 'rectifica':
      return `${LETTERS[step.crossed]} tachada, luego ${LETTERS[step.option]}`;
  }
}

/** La pregunta espera una sola marca salvo cuando el plan pide varias. */
export function planExpectsSingle(step: PlanStep): boolean {
  return step.kind !== 'varias';
}

/** Opciones que deben leerse como marcadas si la pregunta no sale dudosa. */
function expectedMarked(step: PlanStep): number[] | null {
  switch (step.kind) {
    case 'una':
    case 'aspa':
      return [step.option];
    case 'varias':
      return step.options;
    case 'blanco':
      return [];
    case 'rectifica':
      return null; // Debe salir dudosa.
  }
}

export type PlanCheck = 'bien' | 'duda' | 'error';

export interface PlanComparison {
  questions: { number: number; check: PlanCheck; reading: QuestionReading; expected: string }[];
  id: { read: string | null; expected: string; check: PlanCheck };
  errors: number;
  doubts: number;
}

/**
 * Compara una lectura con el plan de la hoja. Error: lo leído no coincide con el plan y la pregunta no ha salido
 * dudosa (es decir, el profesor no se habría enterado).
 */
export function compareWithPlan(
  demo: DemoSheet,
  layout: SheetLayout,
  answers: BubbleState[][],
  idStates: BubbleState[][],
): PlanComparison {
  const questions = layout.questions.map((q, i) => {
    const step = demo.plan[q.index];
    const reading = interpretQuestion(answers[i], planExpectsSingle(step));
    const exp = expectedMarked(step);
    let check: PlanCheck;
    if (reading.doubt) check = 'duda';
    else if (exp === null) check = 'error';
    else check = exp.length === reading.marked.length && exp.every((o, k) => reading.marked[k] === o) ? 'bien' : 'error';
    return { number: q.number, check, reading, expected: planText(step) };
  });
  const id = interpretId(idStates);
  const idCheck: PlanCheck = id.code === null ? 'duda' : id.code === demo.code ? 'bien' : 'error';
  const all = [...questions.map((q) => q.check), idCheck];
  return {
    questions,
    id: { read: id.code, expected: demo.code, check: idCheck },
    errors: all.filter((c) => c === 'error').length,
    doubts: all.filter((c) => c === 'duda').length,
  };
}
