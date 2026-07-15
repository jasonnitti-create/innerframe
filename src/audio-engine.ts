const FADE_MS = 110;

export class AudioEngine {
  readonly element: HTMLAudioElement;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;

  constructor(src: string) {
    this.element = new Audio(src);
    this.element.preload = "auto";
  }

  /** Must run inside a user-gesture handler to satisfy autoplay policy. */
  unlock(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    const source = this.ctx.createMediaElementSource(this.element);
    source.connect(this.gain).connect(this.ctx.destination);
  }

  get currentTime(): number {
    return this.element.currentTime;
  }

  get duration(): number {
    return Number.isFinite(this.element.duration) ? this.element.duration : 0;
  }

  onEnded(cb: () => void): void {
    this.element.addEventListener("ended", cb);
  }

  async start(): Promise<void> {
    if (!this.ctx || !this.gain) throw new Error("AudioEngine.unlock() not called");
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    await this.element.play();
    this.rampTo(1);
  }

  async resumeSoft(): Promise<void> {
    if (!this.ctx || !this.gain) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    await this.element.play();
    this.rampTo(1);
  }

  pauseSoft(): void {
    if (!this.ctx || !this.gain) return;
    this.rampTo(0);
    window.setTimeout(() => this.element.pause(), FADE_MS);
  }

  private rampTo(value: number): void {
    if (!this.ctx || !this.gain) return;
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(value, now + FADE_MS / 1000);
  }
}
