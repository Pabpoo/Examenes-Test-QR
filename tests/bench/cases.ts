import { MARKERS, MARKER_SIZE } from '../../src/shared/sheet/frame';
import { computeAnswerSheets, sheetCapacity, type SheetLayout } from '../../src/shared/sheet/layout';
import { encodeSheetCode, randomVersionId, type SheetCode } from '../../src/shared/sheet/qr-payload';
import { photograph, randomPhotoParams, type Photo, type PhotoParams } from './camera';
import type { Rng } from './rng';
import { PRINT_BLACK, renderSheet, type Ink, type MarkStyle, type SheetMarks } from './synth';

// Generación de casos del banco: examen aleatorio, respuestas aleatorias de un alumno y una foto deformada.

export interface QuestionTruth {
  /** La pregunta espera una sola marca (una sola correcta o criterio «cualquiera»). */
  expectsSingle: boolean;
  /** Si es true, la pregunta debe salir como dudosa (un tachón de rectificación). */
  mustDoubt: boolean;
}

export interface BenchCase {
  seed: number;
  layout: SheetLayout;
  code: SheetCode;
  marks: SheetMarks;
  questions: QuestionTruth[];
  idDigits: number[];
  photoParams: PhotoParams;
  occludedMarker: number | null;
  photo: Photo;
}

const OPTION_SETS = [[4], [4], [5], [3], [2, 3, 4, 5, 6], [6], [2]];

export function makeCase(seed: number, rng: Rng, withPhoto = true, params?: PhotoParams): BenchCase {
  const optionsPool = rng.pick(OPTION_SETS);
  const idDigitsCount = rng.int(4, 8);
  const maxOpt = Math.max(...optionsPool);
  const capacity = sheetCapacity(maxOpt, idDigitsCount);
  const nQuestions = rng.chance(0.3) ? capacity : rng.int(10, capacity);
  const optionCounts = Array.from({ length: nQuestions }, () => rng.pick(optionsPool));
  const layout = computeAnswerSheets({ optionCounts, idDigits: idDigitsCount })[0];
  const code: SheetCode = { versionId: randomVersionId(() => rng.next()), model: rng.pick(['A', 'B', 'C', 'D'] as const), page: 1 };

  const ink: Ink = { pen: rng.chance(0.5) ? rng.range(20, 45) : rng.range(50, 80) };
  const pencilSheet = rng.chance(0.1);
  const mainStyle: MarkStyle = pencilSheet ? 'lapiz' : 'boli';

  const idDigits = Array.from({ length: idDigitsCount }, () => rng.int(0, 9));
  const idMarks: (MarkStyle | null)[][] = idDigits.map((d) =>
    Array.from({ length: 10 }, (_, k) => (k === d ? (rng.chance(0.97) ? mainStyle : rng.pick(['mitad', 'aspa'] as const)) : null)),
  );

  const questions: QuestionTruth[] = [];
  const answers: (MarkStyle | null)[][] = layout.questions.map((q) => {
    const n = q.options.length;
    const row: (MarkStyle | null)[] = new Array(n).fill(null);
    const expectsSingle = rng.chance(0.8);
    let mustDoubt = false;
    const r = rng.next();
    const pickOpt = () => rng.int(0, n - 1);
    if (r < 0.07) {
      // En blanco.
    } else if (r < 0.75) {
      row[pickOpt()] = mainStyle;
    } else if (r < 0.82 && !expectsSingle) {
      const [a, b] = rng.shuffle([...Array(n).keys()]);
      row[a] = mainStyle;
      row[b] = mainStyle;
    } else if (r < 0.88 && expectsSingle && n >= 2) {
      // Rectificación: una tachada y otra buena.
      const [a, b] = rng.shuffle([...Array(n).keys()]);
      row[a] = 'tachon';
      row[b] = mainStyle;
      mustDoubt = true;
    } else {
      row[pickOpt()] = rng.pick(['mitad', 'aspa', 'punto', 'lapiz'] as const);
    }
    questions.push({ expectsSingle, mustDoubt });
    return row;
  });

  const marks: SheetMarks = { id: idMarks, answers };
  const flat = renderSheet(layout, encodeSheetCode(code), marks, ink, rng);

  // Un marcador tapado (dedo, grapa) en parte de los casos.
  let occludedMarker: number | null = null;
  if (rng.chance(0.15)) {
    occludedMarker = rng.int(0, 3);
    const m = MARKERS[occludedMarker];
    flat.disk(m.x + MARKER_SIZE / 2 + rng.range(-3, 3), m.y + MARKER_SIZE / 2 + rng.range(-3, 3), rng.range(9, 13), rng.range(150, 200));
  } else if (rng.chance(0.2)) {
    // Grapa cerca de la esquina superior izquierda, sin tapar el marcador.
    flat.line(3, 4, 9, 6, 0.8, PRINT_BLACK);
  }

  const photoParams = params ?? randomPhotoParams(rng);
  const photo = withPhoto ? photograph(flat, photoParams, rng) : (undefined as unknown as Photo);
  return { seed, layout, code, marks, questions, idDigits, photoParams, occludedMarker, photo };
}
