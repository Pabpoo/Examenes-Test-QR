import { PAGE_H, PAGE_W } from '../shared/sheet/frame';
import { applyHomography, type Homography } from './homography';
import type { GrayImage } from './image';

/** Resolución de la hoja enderezada, en píxeles por milímetro. */
export const RECT_SCALE = 6;

export function bilinear(img: GrayImage, x: number, y: number): number {
  const { width, height, data } = img;
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x > width - 1) x = width - 1;
  if (y > height - 1) y = height - 1;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < width ? x0 + 1 : x0;
  const y1 = y0 + 1 < height ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const a = data[y0 * width + x0];
  const b = data[y0 * width + x1];
  const c = data[y1 * width + x0];
  const d = data[y1 * width + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Píxeles de la imagen por milímetro de hoja, medidos en el centro de la hoja. */
export function imageScaleAtCenter(h: Homography): number {
  const c = applyHomography(h, PAGE_W / 2, PAGE_H / 2);
  const dx = applyHomography(h, PAGE_W / 2 + 1, PAGE_H / 2);
  const dy = applyHomography(h, PAGE_W / 2, PAGE_H / 2 + 1);
  return Math.sqrt(Math.hypot(dx.x - c.x, dx.y - c.y) * Math.hypot(dy.x - c.x, dy.y - c.y));
}

/**
 * Endereza la hoja: genera una imagen de la hoja entera a `scale` px/mm muestreando la foto con la homografía
 * hoja → foto. Si la foto tiene mucha más resolución que la salida, promedia varias muestras por píxel.
 */
export function rectify(src: GrayImage, sheetToImage: Homography, scale = RECT_SCALE): GrayImage {
  const w = Math.round(PAGE_W * scale);
  const h = Math.round(PAGE_H * scale);
  const out = new Float32Array(w * h);
  // Si la foto tiene mucha más resolución que la salida, se reduce antes por bloques (lectura secuencial, rápida)
  // para que cada píxel de salida promedie la zona que le corresponde.
  const factor = Math.floor(imageScaleAtCenter(sheetToImage) / scale / 0.9);
  let source = src;
  let H = sheetToImage;
  if (factor >= 2) {
    source = shrink(src, factor);
    const k = 1 / factor;
    H = new Float64Array([H[0] * k, H[1] * k, H[2] * k, H[3] * k, H[4] * k, H[5] * k, H[6], H[7], H[8]]);
  }
  const inv = 1 / scale;
  const { width: sw, height: sh, data: sd } = source;
  const maxX = sw - 1;
  const maxY = sh - 1;
  const ax = H[0] * inv;
  const ay = H[3] * inv;
  const az = H[6] * inv;
  // Los numeradores y el denominador de la homografía son lineales en x: se avanzan sumando por columnas.
  for (let v = 0; v < h; v++) {
    const row = v * w;
    const my = (v + 0.5) * inv;
    const mx0 = 0.5 * inv;
    let nx = H[0] * mx0 + H[1] * my + H[2];
    let ny = H[3] * mx0 + H[4] * my + H[5];
    let nz = H[6] * mx0 + H[7] * my + H[8];
    for (let u = 0; u < w; u++) {
      let x = nx / nz - 0.5;
      let y = ny / nz - 0.5;
      if (x < 0) x = 0;
      else if (x > maxX) x = maxX;
      if (y < 0) y = 0;
      else if (y > maxY) y = maxY;
      const x0 = x | 0;
      const y0 = y | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0;
      const y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = x - x0;
      const fy = y - y0;
      const i0 = y0 * sw;
      const i1 = y1 * sw;
      const top = sd[i0 + x0] + (sd[i0 + x1] - sd[i0 + x0]) * fx;
      const bottom = sd[i1 + x0] + (sd[i1 + x1] - sd[i1 + x0]) * fx;
      out[row + u] = top + (bottom - top) * fy;
      nx += ax;
      ny += ay;
      nz += az;
    }
  }
  return { width: w, height: h, data: out };
}

/** Reduce una imagen en gris promediando bloques de `f` × `f` píxeles. */
function shrink(img: GrayImage, f: number): GrayImage {
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const out = new Float32Array(w * h);
  const { width, data } = img;
  const norm = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    const orow = y * w;
    for (let dy = 0; dy < f; dy++) {
      const irow = (y * f + dy) * width;
      for (let x = 0; x < w; x++) {
        let s = 0;
        const i = irow + x * f;
        for (let dx = 0; dx < f; dx++) s += data[i + dx];
        out[orow + x] += s;
      }
    }
    for (let x = 0; x < w; x++) out[orow + x] *= norm;
  }
  return { width: w, height: h, data: out };
}
