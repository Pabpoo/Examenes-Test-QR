import regularUrl from './fonts/NotoSans-Regular.ttf?url';
import boldUrl from './fonts/NotoSans-Bold.ttf?url';
import type { FontBytes } from './answer-sheet';

// Fuentes del PDF en el navegador. Noto Sans (licencia OFL, ver fonts/OFL.txt) cubre símbolos como ≥, ≤ o µ que
// las fuentes estándar del PDF no tienen.

let cache: Promise<FontBytes> | null = null;

export function loadFonts(): Promise<FontBytes> {
  cache ??= Promise.all([fetch(regularUrl), fetch(boldUrl)]).then(async ([r, b]) => {
    if (!r.ok || !b.ok) throw new Error('No se pudieron cargar las fuentes del PDF.');
    return { regular: await r.arrayBuffer(), bold: await b.arrayBuffer() };
  });
  return cache;
}
