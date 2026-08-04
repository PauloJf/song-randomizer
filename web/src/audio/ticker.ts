/**
 * Web Audio tick scheduler. `unlock()` must be called from inside a user
 * gesture (touch/click) — iOS Safari otherwise silently rejects sound.
 *
 * iOS home-screen PWAs are stricter than Safari tabs: the context is often
 * created in the "suspended" state even inside a gesture, and it gets
 * suspended again whenever the app is backgrounded. So `unlock()` is called
 * on every spin tap and always tries `resume()`, and a visibilitychange
 * listener resumes after returning to the app.
 */
export class Ticker {
  private ctx: AudioContext | null = null;

  unlock(): void {
    if (!this.ctx) {
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
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.resume();
      });
    }
    this.resume();
  }

  private resume(): void {
    if (this.ctx && this.ctx.state !== "running") {
      void this.ctx.resume().catch(() => {
        /* next gesture will retry */
      });
    }
  }

  tick(volume = 0.35): void {
    if (!this.ctx) return;
    if (this.ctx.state !== "running") {
      this.resume();
      return;
    }
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

  /** Deeper thump for the moment the winner locks in. */
  land(volume = 0.5): void {
    if (!this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.18);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);

    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }
}
