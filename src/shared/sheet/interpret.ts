// Reglas que convierten el estado de cada burbuja en respuestas y dudas. Principio: mejor una duda que un error;
// nada ambiguo se da por bueno sin que lo vea el profesor.

export type BubbleState = 'vacia' | 'marcada' | 'dudosa';

export type QuestionDoubt = 'marca_debil' | 'marcas_de_mas';

export interface QuestionReading {
  /** Opciones dadas por marcadas (índices 0 = a). */
  marked: number[];
  /** Opciones con marca dudosa. */
  weak: number[];
  /** Sin ninguna marca ni rastro. */
  blank: boolean;
  doubt: QuestionDoubt | null;
}

/**
 * @param expectsSingle la pregunta espera una sola marca: tiene una única correcta, o varias con el criterio
 *   «cualquiera».
 */
export function interpretQuestion(states: BubbleState[], expectsSingle: boolean): QuestionReading {
  const marked: number[] = [];
  const weak: number[] = [];
  states.forEach((s, i) => {
    if (s === 'marcada') marked.push(i);
    else if (s === 'dudosa') weak.push(i);
  });
  let doubt: QuestionDoubt | null = null;
  if (weak.length > 0) doubt = 'marca_debil';
  else if (expectsSingle && marked.length > 1) doubt = 'marcas_de_mas';
  return { marked, weak, blank: marked.length === 0 && weak.length === 0, doubt };
}

export type IdColumnDoubt = 'sin_marca' | 'varias_marcas' | 'marca_debil';

export interface IdReading {
  /** Código leído, solo si todas las columnas son claras. */
  code: string | null;
  /** Cifra leída en cada columna (null si no está clara). */
  digits: (number | null)[];
  doubts: { column: number; reason: IdColumnDoubt }[];
}

export function interpretId(columns: BubbleState[][]): IdReading {
  const digits: (number | null)[] = [];
  const doubts: IdReading['doubts'] = [];
  columns.forEach((col, c) => {
    const marked = col.flatMap((s, d) => (s === 'marcada' ? [d] : []));
    const weak = col.some((s) => s === 'dudosa');
    if (weak) doubts.push({ column: c, reason: 'marca_debil' });
    else if (marked.length === 0) doubts.push({ column: c, reason: 'sin_marca' });
    else if (marked.length > 1) doubts.push({ column: c, reason: 'varias_marcas' });
    digits.push(!weak && marked.length === 1 ? marked[0] : null);
  });
  const code = doubts.length === 0 ? digits.join('') : null;
  return { code, digits, doubts };
}

export const QUESTION_DOUBT_TEXT: Record<QuestionDoubt, string> = {
  marca_debil: 'Hay una marca poco clara: puede ser una marca a medias, un aspa o un borrón.',
  marcas_de_mas: 'Hay más de una opción marcada y la pregunta solo admite una. Puede que el alumno rectificara.',
};

export const ID_DOUBT_TEXT: Record<IdColumnDoubt, string> = {
  sin_marca: 'Una cifra del identificador no tiene ninguna burbuja marcada.',
  varias_marcas: 'Una cifra del identificador tiene varias burbujas marcadas.',
  marca_debil: 'Una cifra del identificador tiene una marca poco clara.',
};
