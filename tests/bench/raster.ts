// Rasterizador mínimo en gris (0–255) para dibujar hojas sintéticas. Coordenadas en mm; `res` px/mm.

export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;

  constructor(
    readonly widthMm: number,
    readonly heightMm: number,
    readonly res: number,
    background = 255,
  ) {
    this.width = Math.round(widthMm * res);
    this.height = Math.round(heightMm * res);
    this.data = new Float32Array(this.width * this.height).fill(background);
  }

  private blend(i: number, value: number, cov: number): void {
    if (cov <= 0) return;
    const c = cov >= 1 ? 1 : cov;
    this.data[i] = this.data[i] * (1 - c) + value * c;
  }

  /** Rectángulo con bordes suavizados (cobertura exacta en x e y). */
  rect(x: number, y: number, w: number, h: number, value: number): void {
    const r = this.res;
    const x0 = x * r;
    const y0 = y * r;
    const x1 = (x + w) * r;
    const y1 = (y + h) * r;
    for (let py = Math.max(0, Math.floor(y0)); py < Math.min(this.height, Math.ceil(y1)); py++) {
      const cy = Math.min(py + 1, y1) - Math.max(py, y0);
      for (let px = Math.max(0, Math.floor(x0)); px < Math.min(this.width, Math.ceil(x1)); px++) {
        const cx = Math.min(px + 1, x1) - Math.max(px, x0);
        this.blend(py * this.width + px, value, cx * cy);
      }
    }
  }

  /**
   * Forma definida por una función de distancia con signo (mm, negativa dentro). Recorre solo la caja dada.
   */
  shape(
    box: { x: number; y: number; w: number; h: number },
    sdf: (x: number, y: number) => number,
    value: number | ((x: number, y: number) => number),
  ): void {
    const r = this.res;
    const half = 0.5 / r;
    for (let py = Math.max(0, Math.floor(box.y * r)); py < Math.min(this.height, Math.ceil((box.y + box.h) * r)); py++) {
      const my = (py + 0.5) / r;
      for (let px = Math.max(0, Math.floor(box.x * r)); px < Math.min(this.width, Math.ceil((box.x + box.w) * r)); px++) {
        const mx = (px + 0.5) / r;
        const d = sdf(mx, my);
        const cov = 0.5 - d / (2 * half);
        if (cov <= 0) continue;
        const v = typeof value === 'number' ? value : value(mx, my);
        this.blend(py * this.width + px, v, cov);
      }
    }
  }

  disk(cx: number, cy: number, radius: number, value: number): void {
    this.shape({ x: cx - radius - 1, y: cy - radius - 1, w: 2 * radius + 2, h: 2 * radius + 2 }, (x, y) => Math.hypot(x - cx, y - cy) - radius, value);
  }

  ring(cx: number, cy: number, radius: number, width: number, value: number): void {
    const R = radius + width;
    this.shape({ x: cx - R - 1, y: cy - R - 1, w: 2 * R + 2, h: 2 * R + 2 }, (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - radius) - width / 2, value);
  }

  /** Trazo recto de grosor `width` con extremos redondeados. */
  line(x0: number, y0: number, x1: number, y1: number, width: number, value: number): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    const pad = width + 1;
    this.shape(
      { x: Math.min(x0, x1) - pad, y: Math.min(y0, y1) - pad, w: Math.abs(dx) + 2 * pad, h: Math.abs(dy) + 2 * pad },
      (x, y) => {
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
        return Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)) - width / 2;
      },
      value,
    );
  }
}
