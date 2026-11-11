import { FRAME_ID, PAGE_H, PAGE_W, QR_QUIET, QR_RECT, type Point, type Rect } from './frame';

// Geometría de las hojas de respuestas: única fuente de posiciones (en mm) para el PDF, el escáner y las pruebas.
// El resultado se guarda con cada versión del examen, de modo que el escáner lee siempre con la geometría que se
// imprimió aunque este código cambie después.

export const LAYOUT_VERSION = 1;

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;
export const MIN_ID_DIGITS = 2;
export const MAX_ID_DIGITS = 8;
export const MAX_SHEETS = 9;

export const BUBBLE_R = 2.3;
export const PITCH_X = 6.5;
export const PITCH_Y = 6.2;
/** Cada cuántas filas se deja un hueco para que el alumno no se pierda. */
export const GROUP_ROWS = 5;
export const GROUP_GAP = 2;
/** Ancho reservado para el número de pregunta a la izquierda de las burbujas. */
export const NUMBER_W = 8;
export const COLUMN_GAP = 5;

/** Área útil para respuestas: entre la cabecera y los marcadores de abajo, dentro de los márgenes. */
export const AREA_LEFT = 14;
export const AREA_RIGHT = PAGE_W - 14;
/** Por debajo del margen blanco del QR (que acaba en y = 44). */
export const AREA_TOP = 45;
export const AREA_BOTTOM = 268;

/** Bloque de identificación: arriba a la derecha, bajo el QR. */
const ID_TOP = QR_RECT.y + QR_RECT.h + QR_QUIET;
const ID_LABEL_H = 5;
const ID_BOX_H = 6;
const ID_MIN_W = 40;
const ID_GAP_BELOW = 6;

export const HEADER: Rect = { x: 28, y: 10, w: 110, h: 15 };
export const NAME_FIELD: Rect = { x: AREA_LEFT, y: 28, w: 124, h: 9 };

export interface QuestionSlot {
  /** Posición de la pregunta en el orden impreso del modelo, empezando en 0. */
  index: number;
  /** Número impreso (index + 1). */
  number: number;
  /** Punto donde termina, alineado a la derecha, el número impreso. */
  numberAnchor: Point;
  /** Centro de cada burbuja, en orden a, b, c… */
  options: Point[];
}

export interface IdLayout {
  digits: number;
  region: Rect;
  label: Rect;
  /** Casilla de cada columna para escribir la cifra a mano. */
  boxes: Rect[];
  /** `bubbles[columna][cifra]`: centro de la burbuja de la cifra 0 a 9 de cada columna. */
  bubbles: Point[][];
}

export interface SheetLayout {
  frame: typeof FRAME_ID;
  layoutVersion: typeof LAYOUT_VERSION;
  page: number;
  pageCount: number;
  bubbleR: number;
  header: Rect;
  nameField: Rect;
  id: IdLayout;
  questions: QuestionSlot[];
}

export interface LayoutInput {
  /** Número de opciones de cada pregunta, en el orden impreso del modelo. */
  optionCounts: number[];
  /** Cifras del identificador del alumno. */
  idDigits: number;
}

interface Column {
  x: number;
  top: number;
  rows: number;
}

function validate(input: LayoutInput): void {
  const { optionCounts, idDigits } = input;
  if (!Number.isInteger(idDigits) || idDigits < MIN_ID_DIGITS || idDigits > MAX_ID_DIGITS) {
    throw new Error(`El identificador debe tener entre ${MIN_ID_DIGITS} y ${MAX_ID_DIGITS} cifras.`);
  }
  if (optionCounts.length === 0) throw new Error('El examen no tiene preguntas.');
  optionCounts.forEach((n, i) => {
    if (!Number.isInteger(n) || n < MIN_OPTIONS || n > MAX_OPTIONS) {
      throw new Error(`La pregunta ${i + 1} tiene ${n} opciones; deben ser entre ${MIN_OPTIONS} y ${MAX_OPTIONS}.`);
    }
  });
}

/** Alto que ocupan `rows` filas, contando los huecos entre grupos. */
export function rowsHeight(rows: number): number {
  if (rows <= 0) return 0;
  return rows * PITCH_Y + Math.floor((rows - 1) / GROUP_ROWS) * GROUP_GAP;
}

function rowsThatFit(height: number): number {
  let rows = 0;
  while (rowsHeight(rows + 1) <= height + 1e-9) rows++;
  return rows;
}

function rowCenterY(top: number, row: number): number {
  return top + PITCH_Y / 2 + row * PITCH_Y + Math.floor(row / GROUP_ROWS) * GROUP_GAP;
}

export function columnWidth(options: number): number {
  return NUMBER_W + options * PITCH_X;
}

/**
 * El bloque va arriba a la derecha y debajo queda una columna corta de respuestas. Se le da al menos el ancho de
 * una columna para que ese hueco no se desaproveche.
 */
function idLayout(digits: number, maxOptions: number): IdLayout {
  const blockW = digits * PITCH_X;
  const regionW = Math.max(blockW, ID_MIN_W, columnWidth(maxOptions));
  const regionX = AREA_RIGHT - regionW;
  const label: Rect = { x: regionX, y: ID_TOP, w: regionW, h: ID_LABEL_H };
  const boxTop = ID_TOP + ID_LABEL_H;
  const bubbleTop = boxTop + ID_BOX_H + 1;
  const boxes: Rect[] = [];
  const bubbles: Point[][] = [];
  for (let c = 0; c < digits; c++) {
    const cx = AREA_RIGHT - blockW + PITCH_X / 2 + c * PITCH_X;
    boxes.push({ x: cx - 2.7, y: boxTop, w: 5.4, h: ID_BOX_H });
    const col: Point[] = [];
    for (let d = 0; d < 10; d++) col.push({ x: cx, y: bubbleTop + PITCH_Y / 2 + d * PITCH_Y });
    bubbles.push(col);
  }
  const bottom = bubbleTop + 10 * PITCH_Y;
  return { digits, region: { x: regionX, y: ID_TOP, w: regionW, h: bottom - ID_TOP }, label, boxes, bubbles };
}

/** Columnas de respuestas de una hoja, en el orden en que se rellenan. */
function columnsFor(maxOptions: number, id: IdLayout): Column[] {
  const colW = columnWidth(maxOptions);
  const regions: Rect[] = [
    // Todo el alto, a la izquierda del bloque de identificación.
    { x: AREA_LEFT, y: AREA_TOP, w: id.region.x - COLUMN_GAP - AREA_LEFT, h: AREA_BOTTOM - AREA_TOP },
    // Debajo del bloque de identificación.
    {
      x: id.region.x,
      y: id.region.y + id.region.h + ID_GAP_BELOW,
      w: AREA_RIGHT - id.region.x,
      h: AREA_BOTTOM - (id.region.y + id.region.h + ID_GAP_BELOW),
    },
  ];
  const columns: Column[] = [];
  for (const r of regions) {
    const n = Math.floor((r.w + COLUMN_GAP) / (colW + COLUMN_GAP));
    const rows = rowsThatFit(r.h);
    if (n <= 0 || rows <= 0) continue;
    const gap = n > 1 ? Math.min((r.w - n * colW) / (n - 1), 3 * COLUMN_GAP) : 0;
    for (let i = 0; i < n; i++) columns.push({ x: r.x + i * (colW + gap), top: r.y, rows });
  }
  return columns;
}

/** Cuántas preguntas caben en una hoja con ese máximo de opciones y ese identificador. */
export function sheetCapacity(maxOptions: number, idDigits: number): number {
  return columnsFor(maxOptions, idLayout(idDigits, maxOptions)).reduce((s, c) => s + c.rows, 0);
}

/** Reparte `n` preguntas entre las columnas, equilibrando para no dejar una columna larga y el resto vacías. */
function distribute(n: number, columns: Column[]): number[] {
  let needed = 0;
  let acc = 0;
  while (acc < n && needed < columns.length) acc += columns[needed++].rows;
  let target = Math.ceil(n / Math.max(needed, 1));
  target = Math.ceil(target / GROUP_ROWS) * GROUP_ROWS;
  const counts = columns.map(() => 0);
  let left = n;
  for (let i = 0; i < columns.length && left > 0; i++) {
    counts[i] = Math.min(columns[i].rows, target, left);
    left -= counts[i];
  }
  for (let i = 0; i < columns.length && left > 0; i++) {
    const extra = Math.min(columns[i].rows - counts[i], left);
    counts[i] += extra;
    left -= extra;
  }
  if (left > 0) throw new Error('Las preguntas no caben en la hoja.');
  return counts;
}

/**
 * Calcula las hojas de respuestas de un modelo. Si las preguntas no caben en una hoja, se reparten por igual entre
 * las necesarias; cada hoja lleva su propio bloque de identificación.
 */
export function computeAnswerSheets(input: LayoutInput): SheetLayout[] {
  validate(input);
  const { optionCounts, idDigits } = input;
  const maxOptions = Math.max(...optionCounts);
  const id = idLayout(idDigits, maxOptions);
  const columns = columnsFor(maxOptions, id);
  const capacity = columns.reduce((s, c) => s + c.rows, 0);
  const pageCount = Math.ceil(optionCounts.length / capacity);
  if (pageCount > MAX_SHEETS) {
    throw new Error(`El examen necesitaría ${pageCount} hojas de respuestas; el máximo es ${MAX_SHEETS}.`);
  }
  const perPage = Math.ceil(optionCounts.length / pageCount);

  const sheets: SheetLayout[] = [];
  for (let p = 0; p < pageCount; p++) {
    const first = p * perPage;
    const last = Math.min(first + perPage, optionCounts.length);
    const counts = distribute(last - first, columns);
    const questions: QuestionSlot[] = [];
    let index = first;
    counts.forEach((count, ci) => {
      const col = columns[ci];
      for (let row = 0; row < count; row++, index++) {
        const cy = rowCenterY(col.top, row);
        const options: Point[] = [];
        for (let k = 0; k < optionCounts[index]; k++) {
          options.push({ x: col.x + NUMBER_W + PITCH_X / 2 + k * PITCH_X, y: cy });
        }
        questions.push({ index, number: index + 1, numberAnchor: { x: col.x + NUMBER_W - 1.2, y: cy }, options });
      }
    });
    sheets.push({
      frame: FRAME_ID,
      layoutVersion: LAYOUT_VERSION,
      page: p + 1,
      pageCount,
      bubbleR: BUBBLE_R,
      header: HEADER,
      nameField: NAME_FIELD,
      id: structuredClone(id),
      questions,
    });
  }
  return sheets;
}

/** Todas las burbujas de una hoja (identificador y respuestas), útil para pruebas y para pintar la lectura. */
export function allBubbles(layout: SheetLayout): Point[] {
  return [...layout.id.bubbles.flat(), ...layout.questions.flatMap((q) => q.options)];
}

export { PAGE_H, PAGE_W };
