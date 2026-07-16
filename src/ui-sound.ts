/**
 * Minimal UI sound grammar: short, quiet, machine-coded. One shared
 * AudioContext, lazily unlocked on the first real user gesture (autoplay
 * policy: wheel events don't count, so scroll-only visitors get silence
 * until their first click/keypress/touch — sounds are an enhancement,
 * never load-bearing).
 */
class UiSound {
  private ctx: AudioContext | null = null;
  private unlockInstalled = false;

  installUnlock(): void {
    if (this.unlockInstalled) return;
    this.unlockInstalled = true;
    const unlock = (): void => {
      this.ensureCtx();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    window.addEventListener("touchstart", unlock, { passive: true });
  }

  /** Filtered noise burst, ~4ms — the tick of a tuning detent. */
  tick(): void {
    const ctx = this.liveCtx();
    if (!ctx) return;
    const len = Math.floor(ctx.sampleRate * 0.004);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 3200;
    band.Q.value = 2.5;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start();
  }

  /** Short square blip — a key registering. */
  click(): void {
    this.tone(1150, 0.028, 0.05, "square");
  }

  /** Two rising notes — signal locked. */
  confirm(): void {
    this.tone(620, 0.05, 0.055, "sine");
    window.setTimeout(() => this.tone(930, 0.07, 0.055, "sine"), 65);
  }

  private tone(freq: number, durSec: number, gainValue: number, type: OscillatorType): void {
    const ctx = this.liveCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.004);
    gain.gain.linearRampToValueAtTime(0, now + durSec);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durSec + 0.02);
  }

  private ensureCtx(): void {
    if (this.ctx) return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
  }

  private liveCtx(): AudioContext | null {
    if (!this.ctx) return null;
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }
}

export const uiSound = new UiSound();
