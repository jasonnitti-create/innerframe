/**
 * A restrained cymatic figure for a circular vibrating membrane — approximated,
 * not a literal Bessel-function solution. The shape is a radius-per-angle
 * function: a base ring deformed by cos(m*theta), cross-fading between
 * integer mode counts (m) as progress increases so the curve never develops
 * a seam at theta=2pi. Reads the same way real Chladni figures do — ring,
 * then lobes, then nodal rings and interference — without needing to solve
 * for actual nodal-line zero-crossings.
 */
export class CymaticRing {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private handleResize: () => void;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "cymatic-canvas";
    this.canvas.setAttribute("aria-hidden", "true");
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext("2d")!;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.handleResize = () => this.resize();
    this.resize();
    window.addEventListener("resize", this.handleResize);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  draw(progress: number, t: number): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.34;
    // The ring keeps contracting with progress, same as the plain circle
    // it replaces — the cymatic detail rides on top of that shrink.
    const outerR = maxR * lerp(1.15, 0.34, progress);

    const collapse = clamp01((progress - 0.9) / 0.1);
    const bodyAlpha = 1 - collapse;

    ctx.save();
    ctx.translate(cx, cy);

    if (bodyAlpha > 0.01) {
      this.drawMembrane(ctx, outerR, progress, t, bodyAlpha);
    }
    if (collapse > 0.01) {
      this.drawCollapse(ctx, outerR, collapse);
    }

    ctx.restore();
  }

  private drawMembrane(
    ctx: CanvasRenderingContext2D,
    outerR: number,
    progress: number,
    t: number,
    bodyAlpha: number,
  ): void {
    // Continuous "mode" value: 0 (plain ring) -> 2 (four lobes) -> 3 (finer
    // interference). Blended between the floor/ceil integer mode so the
    // contour stays perfectly periodic at every point in the transition.
    const modeF =
      lerp(0, 2, clamp01((progress - 0.32) / 0.28)) +
      lerp(0, 1, clamp01((progress - 0.6) / 0.35));
    const m0 = Math.floor(modeF);
    const m1 = m0 + 1;
    const mixM = modeF - m0;

    const amp = lerp(0.006, 0.09, clamp01(progress / 0.55)) * outerR;
    const wobbleAmp = outerR * 0.012;
    const rot = t * 0.02;

    const ringCount = progress < 0.55 ? 1 : progress < 0.82 ? 2 : 3;
    const ringFracs =
      ringCount === 1 ? [0.74] : ringCount === 2 ? [0.46, 0.76] : [0.32, 0.56, 0.8];

    ctx.lineWidth = lerp(1.7, 1.0, clamp01(progress)) * this.dpr;
    ctx.strokeStyle = `rgba(232,232,224,${(lerp(0.09, 0.24, progress) * bodyAlpha).toFixed(3)})`;

    const steps = 160;
    for (const frac of ringFracs) {
      const baseR = outerR * frac;
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        const shape0 = Math.cos(m0 * theta + rot);
        const shape1 = Math.cos(m1 * theta + rot);
        const shape = lerp(shape0, shape1, mixM);
        const wobble = Math.sin(theta * 3.0 + t * 1.3 + frac * 10.0) * wobbleAmp;
        const r = baseR + amp * shape * (0.5 + 0.5 * frac) + wobble;
        const x = Math.cos(theta) * r;
        const y = Math.sin(theta) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    if (progress > 0.6) {
      const lineAlpha = lerp(0, 0.11, clamp01((progress - 0.6) / 0.35)) * bodyAlpha;
      ctx.strokeStyle = `rgba(232,232,224,${lineAlpha.toFixed(3)})`;
      ctx.lineWidth = 0.6 * this.dpr;
      const spokes = 5 + Math.round(mixM);
      for (let s = 0; s < spokes; s++) {
        const a = (s / spokes) * Math.PI * 2 + rot * 0.6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * outerR * 0.16, Math.sin(a) * outerR * 0.16);
        ctx.lineTo(Math.cos(a) * outerR * 0.94, Math.sin(a) * outerR * 0.94);
        ctx.stroke();
      }
    }
  }

  private drawCollapse(ctx: CanvasRenderingContext2D, outerR: number, collapse: number): void {
    const alpha = collapse * 0.5;
    ctx.strokeStyle = `rgba(232,232,224,${alpha.toFixed(3)})`;
    ctx.lineWidth = 1 * this.dpr;
    for (let i = 0; i < 4; i++) {
      const y = (Math.random() - 0.5) * outerR * 1.1;
      const x0 = -outerR * (0.3 + Math.random() * 0.6);
      const x1 = outerR * (0.3 + Math.random() * 0.6);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(232,232,224,${(alpha * 0.8).toFixed(3)})`;
    const dots = Math.floor(24 * collapse);
    for (let i = 0; i < dots; i++) {
      const x = (Math.random() - 0.5) * outerR * 1.6;
      const y = (Math.random() - 0.5) * outerR * 1.6;
      ctx.fillRect(x, y, 1.4, 1.4);
    }
  }

  dispose(): void {
    window.removeEventListener("resize", this.handleResize);
    this.canvas.remove();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
