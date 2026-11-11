import { AR } from './vendor/aruco/aruco.js';
import { CV } from './vendor/aruco/cv.js';
import type { GrayImage } from './image';
import type { Point } from '../shared/sheet/frame';

export interface DetectedMarker {
  id: number;
  /**
   * Esquinas del cuadrado negro en coordenadas de la imagen recibida, en el orden del propio marcador: superior
   * izquierda, superior derecha, inferior derecha, inferior izquierda (sea cual sea el giro de la foto).
   */
  corners: [Point, Point, Point, Point];
  hamming: number;
}

/**
 * Máximo de bits erróneos aceptados (estrictamente menor que este valor). El diccionario 36h12 separa sus códigos
 * al menos 12 bits; aceptar hasta 3 deja mucho margen frente a confundir otro dibujo (el QR, texto) con un marcador.
 */
const MAX_HAMMING = 4;
const VALID_IDS = new Set([0, 1, 2, 3]);

function toCvImage(img: GrayImage) {
  const data = new Uint8ClampedArray(img.width * img.height);
  for (let i = 0; i < data.length; i++) data[i] = img.data[i];
  return new CV.Image(img.width, img.height, data);
}

function detectOnce(grey: ReturnType<typeof toCvImage>, kernel: number) {
  const det = new AR.Detector({ dictionaryName: 'ARUCO_MIP_36h12', maxHammingDistance: MAX_HAMMING });
  det.thres = new CV.Image(grey.width, grey.height, new Uint8ClampedArray(grey.width * grey.height));
  CV.adaptiveThreshold(grey, det.thres, kernel, 7);
  det.contours = CV.findContours(det.thres, det.binary);
  let candidates = det.findCandidates(det.contours, grey.width * 0.01, 0.05, 10);
  candidates = det.clockwiseCorners(candidates);
  candidates = det.notTooNear(candidates, 10);
  return det.findMarkers(grey, candidates, 49);
}

function perimeter(c: Point[]): number {
  let p = 0;
  for (let i = 0; i < c.length; i++) p += Math.hypot(c[(i + 1) % 4].x - c[i].x, c[(i + 1) % 4].y - c[i].y);
  return p;
}

/**
 * Busca los marcadores 0 a 3 en una imagen en gris (ya reducida). Prueba dos tamaños de ventana del umbral
 * adaptativo y se queda, para cada id, con la detección de menos errores y mayor tamaño.
 */
export function detectMarkers(img: GrayImage): DetectedMarker[] {
  const grey = toCvImage(img);
  const best = new Map<number, DetectedMarker>();
  for (const kernel of [2, 5]) {
    for (const m of detectOnce(grey, kernel)) {
      if (!VALID_IDS.has(m.id) || m.corners.length !== 4) continue;
      const corners = m.corners.map((c) => ({ x: c.x, y: c.y })) as DetectedMarker['corners'];
      const cand: DetectedMarker = { id: m.id, corners, hamming: m.hammingDistance };
      const prev = best.get(m.id);
      if (
        !prev ||
        cand.hamming < prev.hamming ||
        (cand.hamming === prev.hamming && perimeter(cand.corners) > perimeter(prev.corners))
      ) {
        best.set(m.id, cand);
      }
    }
    if (best.size === 4) break;
  }
  return [...best.values()].sort((a, b) => a.id - b.id);
}
