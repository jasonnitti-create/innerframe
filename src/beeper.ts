/** Tiny UI-tone generator for calibration feedback, separate from the track's AudioEngine. */
export class Beeper {
  private ctx: AudioContext | null = null;

  /** Must run inside a user-gesture handler to satisfy autoplay policy. */
  unlock(): void {
    if (this.ctx) return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
  }

  async beep(freq: number, durMs = 90, gainValue = 0.16): Promise<void> {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;

    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + durMs / 1000);

    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + durMs / 1000 + 0.02);
  }
}
