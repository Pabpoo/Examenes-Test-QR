import type { GrayImage } from './image';

/**
 * Corrige sombras y degradados: estima el blanco del papel por bloques (un percentil alto de cada bloque, porque
 * en cualquier zona de la hoja la mayor parte es papel), lo suaviza e interpola, y divide cada píxel por él.
 * Devuelve valores donde el papel vale ≈ 1 y la tinta negra ≈ 0.
 */
export function normalizeIllumination(img: GrayImage, blockPx = 48, percentile = 0.9): GrayImage {
  const { width, height, data } = img;
  const bw = Math.ceil(width / blockPx);
  const bh = Math.ceil(height / blockPx);
  const bg = new Float32Array(bw * bh);
  const hist = new Uint32Array(256);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      hist.fill(0);
      const x0 = bx * blockPx;
      const y0 = by * blockPx;
      const x1 = Math.min(width, x0 + blockPx);
      const y1 = Math.min(height, y0 + blockPx);
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = data[y * width + x];
          hist[v <= 0 ? 0 : v >= 255 ? 255 : v | 0]++;
          n++;
        }
      }
      const target = n * percentile;
      let acc = 0;
      let k = 0;
      for (; k < 255; k++) {
        acc += hist[k];
        if (acc >= target) break;
      }
      bg[by * bw + bx] = k + 0.5;
    }
  }

  // Mediana 3 × 3 para quitar bloques raros (un marcador, el QR, una zona muy rellena).
  const smooth = new Float32Array(bg.length);
  const win: number[] = [];
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      win.length = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = bx + dx;
          const y = by + dy;
          if (x >= 0 && y >= 0 && x < bw && y < bh) win.push(bg[y * bw + x]);
        }
      }
      win.sort((a, b) => a - b);
      smooth[by * bw + bx] = win[win.length >> 1];
    }
  }
  const sorted = Array.from(smooth).sort((a, b) => a - b);
  const floor = Math.max(8, sorted[sorted.length >> 1] * 0.25);

  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(Math.max((y + 0.5) / blockPx - 0.5, 0), bh - 1);
    const y0 = Math.floor(gy);
    const y1 = Math.min(y0 + 1, bh - 1);
    const fy = gy - y0;
    for (let x = 0; x < width; x++) {
      const gx = Math.min(Math.max((x + 0.5) / blockPx - 0.5, 0), bw - 1);
      const x0 = Math.floor(gx);
      const x1 = Math.min(x0 + 1, bw - 1);
      const fx = gx - x0;
      const b =
        (smooth[y0 * bw + x0] * (1 - fx) + smooth[y0 * bw + x1] * fx) * (1 - fy) +
        (smooth[y1 * bw + x0] * (1 - fx) + smooth[y1 * bw + x1] * fx) * fy;
      const v = data[y * width + x] / Math.max(b, floor);
      out[y * width + x] = v > 1.5 ? 1.5 : v;
    }
  }
  return { width, height, data: out };
}
