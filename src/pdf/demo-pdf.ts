import { PDFDocument, rgb } from 'pdf-lib';
import { demoLayouts, planText, type DemoSheet } from '../shared/demo';
import { PAGE_H, PAGE_W } from '../shared/sheet/frame';
import { addAnswerSheets, embedFonts, type FontBytes } from './answer-sheet';

const PT = 72 / 25.4;

/** PDF de una hoja de prueba: la hoja de respuestas y una página con el plan de relleno. */
export async function buildDemoPdf(demo: DemoSheet, fontBytes: FontBytes): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(demo.title);
  doc.setCreator('Exámenes Test QR');
  const fonts = await embedFonts(doc, fontBytes);
  addAnswerSheets(doc, fonts, demoLayouts(demo), {
    title: demo.title,
    subject: 'Hoja de prueba del escáner',
    versionId: demo.versionId,
    model: 'A',
    showModel: false,
    idLabel: demo.idLabel,
  });

  const page = doc.addPage([PAGE_W * PT, PAGE_H * PT]);
  const ink = rgb(0.1, 0.1, 0.1);
  const soft = rgb(0.4, 0.4, 0.4);
  const text = (s: string, x: number, y: number, size: number, bold = false, color = ink) =>
    page.drawText(s, { x: x * PT, y: (PAGE_H - y) * PT, size, font: bold ? fonts.bold : fonts.regular, color });

  text(`Plan de relleno · ${demo.title}`, 20, 22, 14, true);
  text(demo.instructions, 20, 30, 10);
  text(`Identificador: ${demo.code}`, 20, 37, 10, true);
  text(
    '«Aspa»: una X sobre la burbuja, sin rellenarla. «Táchala»: rellena la primera y haz un tachón encima, como haría',
    20,
    45,
    8.5,
    false,
    soft,
  );
  text('un alumno al cambiar de respuesta. Si te equivocas al rellenar, apúntalo para saber qué foto revisar.', 20, 49.5, 8.5, false, soft);

  const perColumn = Math.ceil(demo.plan.length / 3);
  demo.plan.forEach((step, i) => {
    const col = Math.floor(i / perColumn);
    const row = i % perColumn;
    const x = 20 + col * 60;
    const y = 60 + row * 7.6;
    text(`${i + 1}.`, x, y, 9, true);
    text(planText(step), x + 9, y, 9, false, step.kind === 'una' ? ink : rgb(0.6, 0.15, 0.1));
  });
  return doc.save();
}
