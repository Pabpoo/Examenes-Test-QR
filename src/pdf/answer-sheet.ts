import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  MARKER_CELL,
  MARKERS,
  MARKER_SIZE,
  PAGE_H,
  PAGE_W,
  QR_RECT,
  markerBits,
} from '../shared/sheet/frame';
import type { SheetLayout } from '../shared/sheet/layout';
import { encodeSheetCode, type ModelLetter } from '../shared/sheet/qr-payload';
import { qrModules } from '../shared/sheet/qr-matrix';

// Dibuja las hojas de respuestas con pdf-lib. Todo sale de la geometría (mm); aquí solo se pasa a puntos PDF,
// cuyo origen está abajo a la izquierda.

const PT = 72 / 25.4;
const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const INK = rgb(0.1, 0.1, 0.1);
const OUTLINE = rgb(0.3, 0.3, 0.3);
const HINT = rgb(0.62, 0.62, 0.62);
const SOFT = rgb(0.45, 0.45, 0.45);

export interface FontBytes {
  regular: Uint8Array | ArrayBuffer;
  bold: Uint8Array | ArrayBuffer;
}

export interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

export interface AnswerSheetInfo {
  title: string;
  subject?: string;
  versionId: string;
  model: ModelLetter;
  /** Con un solo modelo no se imprime el recuadro grande con la letra. */
  showModel: boolean;
  /** Texto sobre el bloque de identificación, p. ej. «Últimas 5 cifras del DNI». */
  idLabel: string;
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export async function embedFonts(doc: PDFDocument, bytes: FontBytes): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const [regular, bold] = await Promise.all([
    doc.embedFont(bytes.regular, { subset: true }),
    doc.embedFont(bytes.bold, { subset: true }),
  ]);
  return { regular, bold };
}

class Painter {
  constructor(
    private page: PDFPage,
    private fonts: Fonts,
  ) {}

  private y(mm: number): number {
    return (PAGE_H - mm) * PT;
  }

  rect(x: number, y: number, w: number, h: number, color = BLACK): void {
    this.page.drawRectangle({ x: x * PT, y: this.y(y + h), width: w * PT, height: h * PT, color });
  }

  frame(x: number, y: number, w: number, h: number, color = OUTLINE, width = 0.25): void {
    this.page.drawRectangle({
      x: x * PT,
      y: this.y(y + h),
      width: w * PT,
      height: h * PT,
      borderColor: color,
      borderWidth: width * PT,
    });
  }

  circle(cx: number, cy: number, r: number, color = OUTLINE, width = 0.25): void {
    this.page.drawCircle({ x: cx * PT, y: this.y(cy), size: r * PT, borderColor: color, borderWidth: width * PT });
  }

  /** Texto con la línea base en `y`. `align` respecto a `x`. */
  text(
    s: string,
    x: number,
    y: number,
    size: number,
    opts: { bold?: boolean; color?: ReturnType<typeof rgb>; align?: 'left' | 'center' | 'right'; maxW?: number } = {},
  ): void {
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    let str = s;
    if (opts.maxW !== undefined) str = fit(str, font, size, opts.maxW);
    const w = font.widthOfTextAtSize(str, size) / PT;
    const dx = opts.align === 'center' ? -w / 2 : opts.align === 'right' ? -w : 0;
    this.page.drawText(str, { x: (x + dx) * PT, y: this.y(y), size, font, color: opts.color ?? INK });
  }

  /** Texto centrado verticalmente en `cy` (por la altura de las mayúsculas). */
  textMiddle(s: string, cx: number, cy: number, size: number, color: ReturnType<typeof rgb>, bold = false): void {
    const font = bold ? this.fonts.bold : this.fonts.regular;
    const capMm = (font.heightAtSize(size, { descender: false }) / PT) * 0.72;
    this.text(s, cx, cy + capMm / 2, size, { color, align: 'center', bold });
  }
}

function fit(s: string, font: PDFFont, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(s, size) / PT <= maxW) return s;
  let out = s;
  while (out.length > 1 && font.widthOfTextAtSize(out + '…', size) / PT > maxW) out = out.slice(0, -1);
  return out.trimEnd() + '…';
}

function drawMarkers(p: Painter): void {
  for (const m of MARKERS) {
    p.rect(m.x, m.y, MARKER_SIZE, MARKER_SIZE, BLACK);
    const bits = markerBits(m.id);
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        if (bits[r][c]) p.rect(m.x + (c + 1) * MARKER_CELL, m.y + (r + 1) * MARKER_CELL, MARKER_CELL, MARKER_CELL, WHITE);
      }
    }
  }
}

function drawQr(p: Painter, text: string): void {
  const mods = qrModules(text);
  const n = mods.length;
  const cell = QR_RECT.w / n;
  // Une los módulos negros consecutivos de cada fila en un solo rectángulo; un pequeño solape evita líneas
  // blancas entre módulos en algunos visores.
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!mods[r][c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < n && mods[r][c]) c++;
      p.rect(QR_RECT.x + start * cell, QR_RECT.y + r * cell, (c - start) * cell, cell + 0.02, BLACK);
    }
  }
}

function drawSheet(p: Painter, layout: SheetLayout, info: AnswerSheetInfo): void {
  drawMarkers(p);
  drawQr(p, encodeSheetCode({ versionId: info.versionId, model: info.model, page: layout.page }));

  // Cabecera.
  const h = layout.header;
  const modelBoxW = info.showModel ? 16 : 0;
  const textW = h.w - modelBoxW - (info.showModel ? 3 : 0);
  p.text(info.title, h.x, h.y + 4.6, 12, { bold: true, maxW: textW });
  const sub: string[] = [];
  if (info.subject) sub.push(info.subject);
  if (info.showModel) sub.push(`Modelo ${info.model}`);
  if (layout.pageCount > 1) sub.push(`Hoja ${layout.page} de ${layout.pageCount}`);
  if (sub.length) p.text(sub.join('  ·  '), h.x, h.y + 10, 8.5, { color: SOFT, maxW: textW });
  if (info.showModel) {
    const bx = h.x + h.w - modelBoxW;
    p.frame(bx, h.y, modelBoxW, 14, INK, 0.5);
    p.text('MODELO', bx + modelBoxW / 2, h.y + 3.4, 5.5, { align: 'center', color: SOFT, bold: true });
    p.text(info.model, bx + modelBoxW / 2, h.y + 12.2, 22, { align: 'center', bold: true });
  }

  // Nombre.
  const nf = layout.nameField;
  p.frame(nf.x, nf.y, nf.w, nf.h, OUTLINE, 0.3);
  p.text('Apellidos y nombre', nf.x + 1.5, nf.y + 3, 6.5, { color: SOFT });

  // Identificación.
  const id = layout.id;
  p.text(info.idLabel, id.region.x + id.region.w, id.label.y + 3.4, 7, {
    bold: true,
    align: 'right',
    maxW: id.region.w,
  });
  for (const b of id.boxes) p.frame(b.x, b.y, b.w, b.h, OUTLINE, 0.3);
  for (const col of id.bubbles) {
    col.forEach((c, d) => {
      p.circle(c.x, c.y, layout.bubbleR);
      p.textMiddle(String(d), c.x, c.y, 6.5, HINT);
    });
  }

  // Respuestas.
  for (const q of layout.questions) {
    p.text(String(q.number), q.numberAnchor.x, q.numberAnchor.y + 1.1, 8, { bold: true, align: 'right' });
    q.options.forEach((c, k) => {
      p.circle(c.x, c.y, layout.bubbleR);
      p.textMiddle(LETTERS[k], c.x, c.y - 0.15, 6.5, HINT);
    });
  }

  // Instrucciones.
  p.text(
    'Rellena el círculo entero con bolígrafo azul o negro. Para corregir, tacha la marca equivocada y rellena la buena.',
    PAGE_W / 2,
    280.5,
    7,
    { align: 'center', color: SOFT, maxW: 150 },
  );
  p.text('No dobles la hoja ni escribas cerca de los cuadrados de las esquinas.', PAGE_W / 2, 284, 7, {
    align: 'center',
    color: SOFT,
    maxW: 150,
  });
}

/** Añade al documento una página por cada hoja de respuestas. */
export function addAnswerSheets(doc: PDFDocument, fonts: Fonts, layouts: SheetLayout[], info: AnswerSheetInfo): void {
  for (const layout of layouts) {
    const page = doc.addPage([PAGE_W * PT, PAGE_H * PT]);
    drawSheet(new Painter(page, fonts), layout, info);
  }
}

/** PDF con solo las hojas de respuestas. */
export async function buildAnswerSheetPdf(
  layouts: SheetLayout[],
  info: AnswerSheetInfo,
  fontBytes: FontBytes,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${info.title} - hoja de respuestas`);
  doc.setCreator('Exámenes Test QR');
  const fonts = await embedFonts(doc, fontBytes);
  addAnswerSheets(doc, fonts, layouts, info);
  return doc.save();
}
