import QRCode from 'qrcode';
import { QR_ERROR_LEVEL } from './frame';

/**
 * Módulos del QR de una hoja (`true` = negro), sin margen. Siempre versión 1 y modo alfanumérico, para que el
 * tamaño del módulo sea fijo y grande.
 */
export function qrModules(text: string): boolean[][] {
  const qr = QRCode.create([{ data: text, mode: 'alphanumeric' }], {
    errorCorrectionLevel: QR_ERROR_LEVEL,
    version: 1,
  });
  const size = qr.modules.size;
  const rows: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(Boolean(qr.modules.get(r, c)));
    rows.push(row);
  }
  return rows;
}
