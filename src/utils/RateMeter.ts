// RateMeter.ts
export class RateMeter {
  private total = 0;
  private lastTotal = 0;
  private lastT = performance.now();
  private ema = 0;
  private primed = false;

  constructor(private tauMs = 5000) {} // time constant: "memory" of ~5s

  add(n: number) {
    this.total += n;
  } // hot path: one addition, nothing else ⚡

  sample(now = performance.now()) {
    // called by ONE shared clock
    const dt = now - this.lastT;
    if (dt <= 0) return;
    const inst = ((this.total - this.lastTotal) / dt) * 1000;
    this.lastTotal = this.total;
    this.lastT = now;

    if (!this.primed) {
      this.ema = inst;
      this.primed = true;
    } else {
      const alpha = 1 - Math.exp(-dt / this.tauMs);
      this.ema += alpha * (inst - this.ema);
    }
  }

  get rate() {
    return this.ema;
  } // bytes/sec, pure getter ✅
  get bytes() {
    return this.total;
  } // lifetime total
}
