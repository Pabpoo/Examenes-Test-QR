import jpeg from 'jpeg-js';
import { PAGE_H, PAGE_W } from '../../src/shared/sheet/frame';
import { applyHomography, invert, type Homography } from '../../src/scanner/homography';
import type { RgbaImage } from '../../src/scanner/image';
import type { Canvas } from './raster';
import type { Rng } from './rng';

// «Fotografía» una hoja plana: perspectiva, giro, luz, sombra, papel combado, desenfoque, ruido y JPEG.

export interface PhotoParams {
  width: number;
  height: number;
  /** Escala aproximada de la hoja en la foto. */
  pxPerMm: number;
  /** Giro en el plano de la foto (radianes). */
  roll: number;
  /** Inclinación de la cámara respecto a la hoja (radianes). */
  tiltX: number;
  tiltY: number;
  blurSigma: number;
  noise: number;
  jpegQuality: number | null;
  /** Rango de la iluminación (factor mínimo y máximo sobre la hoja). */
  light: [number, number];
  shadow: { strength: number; softness: number } | null;
  /** Amplitud (mm) del combado del papel. */
  bend: number;
  /** Nivel de negro y de blanco de la cámara (contraste). */
  black: number;
  white: number;
}

export function randomPhotoParams(rng: Rng): PhotoParams {
  const sizes: [number, number][] = [
    [1080, 1920],
    [1080, 1920],
    [1440, 2560],
    [1920, 1080],
    [2250, 3000],
  ];
  const [width, height] = rng.pick(sizes);
  // Que la hoja ocupe entre el 55 % y el 92 % del lado útil de la foto.
  const landscape = width > height;
  const fit = landscape ? Math.min(width / PAGE_H, height / PAGE_W) : Math.min(width / PAGE_W, height / PAGE_H);
  const deg = Math.PI / 180;
  return {
    width,
    height,
    pxPerMm: fit * rng.range(0.55, 0.9),
    roll: rng.chance(0.25) ? rng.range(0, 2 * Math.PI) : (landscape ? Math.PI / 2 : 0) + rng.range(-12, 12) * deg + (rng.chance(0.15) ? Math.PI : 0),
    tiltX: rng.range(-30, 30) * deg,
    tiltY: rng.range(-30, 30) * deg * (rng.chance(0.5) ? 0.4 : 1),
    blurSigma: rng.range(0.3, 1.6),
    noise: rng.range(1, 7),
    jpegQuality: rng.chance(0.85) ? rng.int(55, 92) : null,
    light: rng.chance(0.6) ? [rng.range(0.55, 0.85), 1] : [0.9, 1],
    shadow: rng.chance(0.3) ? { strength: rng.range(0.55, 0.85), softness: rng.range(4, 40) } : null,
    bend: rng.chance(0.35) ? rng.range(0.2, 0.9) : 0,
    black: rng.range(8, 40),
    white: rng.range(185, 250),
  };
}

/** Homografía hoja (mm) → foto (px) de una cámara con esa pose. Reduce la escala hasta que la hoja quepa. */
export function poseHomography(p: PhotoParams, rng: Rng): Homography {
  let scale = p.pxPerMm;
  for (let attempt = 0; attempt < 30; attempt++) {
    const D = 450;
    const f = scale * D;
    const [cx, sx] = [Math.cos(p.tiltX), Math.sin(p.tiltX)];
    const [cy, sy] = [Math.cos(p.tiltY), Math.sin(p.tiltY)];
    const [cz, sz] = [Math.cos(p.roll), Math.sin(p.roll)];
    // R = Rz · Rx · Ry
    const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
    const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
    const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
    const mul = (a: number[], b: number[]) => {
      const o = new Array(9).fill(0);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
      return o;
    };
    const R = mul(Rz, mul(Rx, Ry));
    const r1 = [R[0], R[3], R[6]];
    const r2 = [R[1], R[4], R[7]];
    const t = [0 - (PAGE_W / 2) * r1[0] - (PAGE_H / 2) * r2[0], 0 - (PAGE_W / 2) * r1[1] - (PAGE_H / 2) * r2[1], D - (PAGE_W / 2) * r1[2] - (PAGE_H / 2) * r2[2]];
    const ox = p.width / 2 + rng.range(-0.08, 0.08) * p.width;
    const oy = p.height / 2 + rng.range(-0.08, 0.08) * p.height;
    const h = new Float64Array([
      f * r1[0] + ox * r1[2], f * r2[0] + ox * r2[2], f * t[0] + ox * t[2],
      f * r1[1] + oy * r1[2], f * r2[1] + oy * r2[2], f * t[1] + oy * t[2],
      r1[2], r2[2], t[2],
    ]);
    for (let k = 0; k < 9; k++) h[k] /= t[2];
    const corners = [applyHomography(h, 0, 0), applyHomography(h, PAGE_W, 0), applyHomography(h, PAGE_W, PAGE_H), applyHomography(h, 0, PAGE_H)];
    const m = 0.02;
    if (corners.every((c) => c.x > p.width * m && c.x < p.width * (1 - m) && c.y > p.height * m && c.y < p.height * (1 - m))) {
      return h;
    }
    scale *= 0.93;
  }
  throw new Error('No se pudo encajar la hoja en la foto');
}

/** Desenfoque gaussiano separable con núcleo exacto. */
function gaussianBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma < 0.2) return src;
  const r = Math.ceil(3 * sigma);
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += k[i + r] * src[row + Math.min(w - 1, Math.max(0, x + i))];
      tmp[row + x] = acc;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = acc;
    }
  }
  return out;
}

export interface Photo {
  image: RgbaImage;
  sheetToImage: Homography;
}

export function photograph(flat: Canvas, p: PhotoParams, rng: Rng): Photo {
  const H = poseHomography(p, rng);
  const inv = invert(H)!;
  const { width: W, height: Ht } = p;
  const out = new Float32Array(W * Ht);
  const res = flat.res;
  const table = rng.range(40, 140);
  const bendPhase = rng.range(0, 6.3);
  const lightDir = rng.range(0, 2 * Math.PI);
  const [lmin, lmax] = p.light;
  const shadowAngle = rng.range(0, 2 * Math.PI);
  const shadowOffset = rng.range(-0.3, 0.3) * Math.min(W, Ht);
  const ss = 2;

  const sampleFlat = (mx: number, my: number): number => {
    const x = mx * res - 0.5;
    const y = my * res - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 >= flat.width - 1 || y0 >= flat.height - 1) return 255;
    const fx = x - x0;
    const fy = y - y0;
    const d = flat.data;
    const i = y0 * flat.width + x0;
    return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + flat.width] * (1 - fx) + d[i + flat.width + 1] * fx) * fy;
  };

  for (let v = 0; v < Ht; v++) {
    for (let u = 0; u < W; u++) {
      let acc = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = u + (sx + 0.5) / ss;
          const py = v + (sy + 0.5) / ss;
          const wz = inv[6] * px + inv[7] * py + inv[8];
          let mx = (inv[0] * px + inv[1] * py + inv[2]) / wz;
          let my = (inv[3] * px + inv[4] * py + inv[5]) / wz;
          if (mx < 0 || my < 0 || mx > PAGE_W || my > PAGE_H) {
            acc += table + 25 * Math.sin(px * 0.05) * Math.cos(py * 0.04);
            continue;
          }
          if (p.bend > 0) {
            mx += p.bend * Math.sin((Math.PI * my) / PAGE_H + bendPhase);
            my += p.bend * 0.6 * Math.sin((Math.PI * mx) / PAGE_W + bendPhase * 1.7);
          }
          acc += sampleFlat(mx, my);
        }
      }
      let val = acc / (ss * ss);
      // Luz: degradado lineal y, a veces, una sombra con borde suave.
      const t = ((u - W / 2) * Math.cos(lightDir) + (v - Ht / 2) * Math.sin(lightDir)) / Math.max(W, Ht) + 0.5;
      let light = lmin + (lmax - lmin) * Math.min(1, Math.max(0, t));
      if (p.shadow) {
        const d = (u - W / 2) * Math.cos(shadowAngle) + (v - Ht / 2) * Math.sin(shadowAngle) - shadowOffset;
        const k = 1 / (1 + Math.exp(-d / p.shadow.softness));
        light *= 1 - (1 - p.shadow.strength) * k;
      }
      val = p.black + (val / 255) * (p.white - p.black) * light;
      out[v * W + u] = val;
    }
  }

  const blurred = gaussianBlur(out, W, Ht, p.blurSigma);
  const data = new Uint8ClampedArray(W * Ht * 4);
  for (let i = 0, j = 0; i < blurred.length; i++, j += 4) {
    const v = blurred[i] + p.noise * rng.gauss();
    // Un poco de color para que la conversión a gris del escáner haga algo.
    data[j] = v * 1.02;
    data[j + 1] = v;
    data[j + 2] = v * 0.96;
    data[j + 3] = 255;
  }
  let image: RgbaImage = { width: W, height: Ht, data };
  if (p.jpegQuality !== null) {
    const enc = jpeg.encode({ width: W, height: Ht, data: Buffer.from(data.buffer) }, p.jpegQuality);
    const dec = jpeg.decode(enc.data, { useTArray: true, formatAsRGBA: true });
    image = { width: dec.width, height: dec.height, data: dec.data };
  }
  return { image, sheetToImage: H };
}
