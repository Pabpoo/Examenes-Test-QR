// Imágenes en memoria sin DOM, para que el escáner funcione igual en el navegador, en un Web Worker y en Node.

export interface RgbaImage {
  width: number;
  height: number;
  /** RGBA, 4 bytes por píxel (como ImageData). */
  data: Uint8ClampedArray | Uint8Array;
}

/** Imagen en gris con valores de 0 (negro) a 255 (blanco). */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export function rgbaToGray(img: RgbaImage): GrayImage {
  const { width, height, data } = img;
  const out = new Float32Array(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = luminance(data[i], data[i + 1], data[i + 2]);
  return { width, height, data: out };
}

/**
 * Reduce la imagen en gris para que su lado mayor no pase de `maxSide`, promediando los píxeles que caen en cada
 * píxel de salida. Devuelve también la escala aplicada (salida / entrada).
 */
export function downscaleToGray(img: RgbaImage, maxSide: number): { image: GrayImage; scale: number } {
  const { width, height, data } = img;
  const factor = Math.max(width, height) / maxSide;
  if (factor <= 1) return { image: rgbaToGray(img), scale: 1 };
  const w = Math.max(1, Math.round(width / factor));
  const h = Math.max(1, Math.round(height / factor));
  const fx = width / w;
  const fy = height / h;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let sum = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          sum += luminance(data[i], data[i + 1], data[i + 2]);
          n++;
        }
      }
      out[y * w + x] = sum / n;
    }
  }
  return { image: { width: w, height: h, data: out }, scale: w / width };
}

/** Recorta un rectángulo (en píxeles) de una imagen en gris. */
export function cropGray(img: GrayImage, x: number, y: number, w: number, h: number): GrayImage {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.width, Math.ceil(x + w));
  const y1 = Math.min(img.height, Math.ceil(y + h));
  const cw = Math.max(0, x1 - x0);
  const ch = Math.max(0, y1 - y0);
  const out = new Float32Array(cw * ch);
  for (let yy = 0; yy < ch; yy++) {
    out.set(img.data.subarray((y0 + yy) * img.width + x0, (y0 + yy) * img.width + x0 + cw), yy * cw);
  }
  return { width: cw, height: ch, data: out };
}

export function grayToRgba(img: GrayImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let j = 0, i = 0; j < img.data.length; j++, i += 4) {
    const v = img.data[j];
    out[i] = v;
    out[i + 1] = v;
    out[i + 2] = v;
    out[i + 3] = 255;
  }
  return out;
}
