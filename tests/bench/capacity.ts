import { sheetCapacity } from '../../src/shared/sheet/layout';
for (const o of [2, 3, 4, 5, 6]) console.log(`${o} opciones: ${sheetCapacity(o, 8)} (8 cifras) · ${sheetCapacity(o, 5)} (5 cifras) · ${sheetCapacity(o, 2)} (2 cifras)`);
