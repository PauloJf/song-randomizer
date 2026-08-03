/**
 * Web Audio tick scheduler. `unlock()` must be called from inside a user
 * gesture (touch/click) — iOS Safari otherwise silently rejects sound.
 * `tick()` plays a very short click; safe to call many times per second.
 */
export class Ticker {
  private ctx: AudioContext | null = null;
  private ready = false;

  unlock(): void {
    if (this.ctx) return;
    type AudioCtor = typeof AudioContext;
    const Ctor: AudioCtor | undefined =
      (window as unknown as { AudioContext?: AudioCtor }).AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    // Play a silent buffer to satisfy the iOS unlock heuristic.
    const buf = this.ctx.createBuffer(1, 1, 22050);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start(0);
    this.ready = true;
  }

  tick(volume = 0.35): void {
    if (!this.ctx || !this.ready) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(700, t + 0.03);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }
}
