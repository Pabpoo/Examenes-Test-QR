import { FRAME_ID } from './frame';

// Contenido del QR de cada hoja: `TQ1-<id de versión>-<modelo><hoja>`, p. ej. `TQ1-K3F9X2AB-A1`.
// Solo identifica la hoja. Nunca lleva la clave ni un enlace: cualquier móvil puede leer un QR.

export const MODELS = ['A', 'B', 'C', 'D'] as const;
export type ModelLetter = (typeof MODELS)[number];

export interface SheetCode {
  versionId: string;
  model: ModelLetter;
  /** Número de hoja de respuestas, empezando en 1. */
  page: number;
}

const VERSION_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const VERSION_RE = /^[A-Z0-9]{8}$/;
const CODE_RE = /^TQ1-([A-Z0-9]{8})-([A-D])([1-9])$/;

export function encodeSheetCode(code: SheetCode): string {
  if (!VERSION_RE.test(code.versionId)) throw new Error(`Id de versión no válido: ${code.versionId}`);
  if (!MODELS.includes(code.model)) throw new Error(`Modelo no válido: ${code.model}`);
  if (!Number.isInteger(code.page) || code.page < 1 || code.page > 9) throw new Error(`Hoja no válida: ${code.page}`);
  return `${FRAME_ID}-${code.versionId}-${code.model}${code.page}`;
}

export function decodeSheetCode(text: string): SheetCode | null {
  const m = CODE_RE.exec(text.trim());
  if (!m) return null;
  return { versionId: m[1], model: m[2] as ModelLetter, page: Number(m[3]) };
}

/** Id de versión aleatorio de 8 caracteres sin letras ni cifras que se confundan (0/O, 1/I). */
export function randomVersionId(random: () => number = Math.random): string {
  let id = '';
  for (let i = 0; i < 8; i++) id += VERSION_ALPHABET[Math.floor(random() * VERSION_ALPHABET.length)];
  return id;
}
