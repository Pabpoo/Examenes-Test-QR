// Marco «TQ1»: los elementos fijos de toda hoja de respuestas. El escáner los necesita antes de saber qué examen
// es, así que no dependen de nada del examen. Todas las medidas en milímetros, origen arriba a la izquierda de un A4
// vertical. Cambiar algo de aquí obliga a crear un marco nuevo (TQ2) y mantener la lectura del anterior.

export const FRAME_ID = 'TQ1';

export const PAGE_W = 210;
export const PAGE_H = 297;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Lado del cuadrado negro del marcador (8 × 8 celdas: borde negro y 6 × 6 de datos). */
export const MARKER_SIZE = 14;
export const MARKER_CELLS = 8;
export const MARKER_CELL = MARKER_SIZE / MARKER_CELLS;
/** Margen blanco que debe quedar libre alrededor de cada marcador. */
export const MARKER_QUIET = 3;

export type MarkerId = 0 | 1 | 2 | 3;

export interface MarkerSpec {
  id: MarkerId;
  /** Esquina superior izquierda del cuadrado negro. */
  x: number;
  y: number;
}

/** 0 arriba izquierda (zona de grapa), 1 arriba derecha, 2 abajo derecha, 3 abajo izquierda. */
export const MARKERS: readonly MarkerSpec[] = [
  { id: 0, x: 10, y: 10 },
  { id: 1, x: PAGE_W - 10 - MARKER_SIZE, y: 10 },
  { id: 2, x: PAGE_W - 10 - MARKER_SIZE, y: PAGE_H - 10 - MARKER_SIZE },
  { id: 3, x: 10, y: PAGE_H - 10 - MARKER_SIZE },
];

/**
 * Esquinas del cuadrado negro de un marcador, en el sentido de las agujas del reloj empezando por la superior
 * izquierda del propio marcador (que se imprime sin girar).
 */
export function markerCorners(m: MarkerSpec): [Point, Point, Point, Point] {
  const s = MARKER_SIZE;
  return [
    { x: m.x, y: m.y },
    { x: m.x + s, y: m.y },
    { x: m.x + s, y: m.y + s },
    { x: m.x, y: m.y + s },
  ];
}

/**
 * QR: versión 1 (21 × 21 módulos), corrección Q, en modo alfanumérico. 30 mm (módulos de 1,43 mm): con 24 mm
 * fallaba en fotos de poca resolución del banco sintético.
 */
export const QR_RECT: Rect = { x: 144, y: 10, w: 30, h: 30 };
export const QR_QUIET = 4;
export const QR_ERROR_LEVEL = 'Q' as const;

/**
 * Códigos del diccionario ARUCO_MIP_36h12 para los identificadores 0 a 3, tal como los usa el detector
 * (src/scanner/vendor/aruco). 36 bits por fila y en orden de lectura; un 1 es una celda blanca.
 */
const ARUCO_CODES = [0xd2b63a09d, 0x6001134e5, 0x1206fbe72, 0xff8ad6cb4];

/** Matriz 6 × 6 de datos del marcador: `true` = celda blanca. */
export function markerBits(id: MarkerId): boolean[][] {
  const bits = ARUCO_CODES[id].toString(2).padStart(36, '0');
  const rows: boolean[][] = [];
  for (let r = 0; r < 6; r++) {
    rows.push([...bits.slice(r * 6, r * 6 + 6)].map((b) => b === '1'));
  }
  return rows;
}
